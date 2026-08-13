const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { requireAuth, requireOrgOwner } = require('../../middleware/auth');
const { sendEmail } = require('../../utils/mailer');
const { getReviewerEmails } = require('../../utils/reviewers');
const multer = require('multer');

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));


// Studio Management Routes
// Organization Dashboard
router.get('/manage/org/:id', requireAuth, requireOrgOwner(), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  // Get stats
  const stats = await db.get(`
    SELECT 
      COUNT(DISTINCT a.studio_id) as total_studios,
      COUNT(a.id) as total_awards
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ?
  `, [org.id]);

  // Determine rank by total awards
  const rankQuery = await db.all(`
    SELECT o.id, COUNT(a.id) as total_awards
    FROM organizations o
    JOIN events e ON o.id = e.org_id
    JOIN awards a ON e.id = a.event_id
    GROUP BY o.id
    ORDER BY total_awards DESC
  `);

  let rank = -1;
  for (let i = 0; i < rankQuery.length; i++) {
    if (rankQuery[i].id === org.id) {
      rank = i + 1;
      break;
    }
  }

  // Get events
  const events = await db.all('SELECT * FROM events WHERE org_id = ? ORDER BY year DESC, date_string DESC', [org.id]);

  // Get top dancer for this org (mock example)
  const topDancer = await db.get(`
    SELECT d.id, d.unique_id, d.name, COUNT(a.id) as award_count
    FROM dancers d
    JOIN award_dancers ad ON d.id = ad.dancer_id
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ? AND length(d.name) > 5 AND a.place IN ('1', '1st', 'Winner')
    GROUP BY d.id
    ORDER BY award_count DESC
    LIMIT 1
  `, [org.id]);

  // Get top studio for this org (mock example)
  const topStudio = await db.get(`
    SELECT s.id, s.name, COUNT(a.id) as award_count
    FROM studios s
    JOIN awards a ON s.id = a.studio_id
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ? AND length(s.name) > 5 AND s.name NOT LIKE '%Independent%'
    GROUP BY s.id
    ORDER BY award_count DESC
    LIMIT 1
  `, [org.id]);

  // Get org uploads
  const uploads = await db.all('SELECT * FROM org_uploads WHERE org_id = ? ORDER BY created_at DESC', [org.id]);

  res.render('manage_org', { org, stats, rank, events, uploads, topDancer, topStudio, user: req.session.user });
});


// Configure multer for org uploads. Rejections surface as 400s via the
// central error handler (err.status = 400). Nothing in the app ever
// executes or parses these files — they are processed manually by the
// team — so the format list can be generous (database dumps included).
// SQL dumps must only ever be restored into a throwaway local database,
// never against live (see docs/db_operations.md).
const orgUpload = multer({
  dest: 'tobeprocessed/org_uploads/',
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.(csv|xlsx|xls|pdf|sql|sqlite|sqlite3|db|mdb|accdb|zip)$/i.test(file.originalname || '')) return cb(null, true);
    const err = new Error('Accepted result formats: .csv, .xlsx, .xls, .pdf, .sql, .sqlite, .db, .mdb, .accdb, or a .zip of these.');
    err.status = 400;
    cb(err);
  },
});

// Branding images land in the publicly served uploads dir. Multer's random
// extension-less filenames mean they can never be served as HTML/JS, but we
// still restrict to raster image types — SVG is excluded (scriptable), and
// both the extension and the client-declared MIME type must look like an image.
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const brandingUpload = multer({
  dest: 'public/uploads/org_branding/',
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIMES.has(file.mimetype) && /\.(png|jpe?g|webp|gif|avif)$/i.test(file.originalname || '')) {
      return cb(null, true);
    }
    const err = new Error('Only PNG, JPG, WebP, GIF, or AVIF images are accepted.');
    err.status = 400;
    cb(err);
  },
});

router.post('/manage/org/:id/upload', requireAuth, requireOrgOwner(), orgUpload.single('results_file'), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const { event_name, event_date, event_location } = req.body;
  const filePath = req.file.path;

  await db.run(`
    INSERT INTO org_uploads (org_id, event_name, event_date, event_location, file_path)
    VALUES (?, ?, ?, ?, ?)
  `, [org.id, event_name, event_date, event_location, filePath]);

  // Nothing processes org_uploads automatically — ping the reviewers
  // (managed at /admin/reviewers, env fallback) so the file doesn't sit
  // unnoticed. Fire-and-forget; sendEmail never throws.
  getReviewerEmails().then(recipients => {
    if (!recipients.length) return;
    return sendEmail({
      to: recipients.join(', '),
      subject: `New organizer results upload: ${org.name} — ${event_name}`,
      html: `<p><strong>${escapeHtml(org.name)}</strong> uploaded results for ` +
        `<strong>${escapeHtml(event_name)}</strong> (${escapeHtml(event_date)}, ${escapeHtml(event_location)}).</p>` +
        `<p>File: <code>${escapeHtml(filePath)}</code><br>` +
        `Original name: ${escapeHtml(req.file.originalname)} (${Math.round(req.file.size / 1024)} KB)</p>`,
    });
  }).catch(err => console.error('[OrgUpload] notification failed:', err));

  res.redirect('/manage/org/' + org.id);
});


router.get('/manage/org/:id/branding', requireAuth, requireOrgOwner({ allowAdmin: false }), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  // Get distinct award types (or categories if award_type is empty) for this org's events, ranked by frequency
  const awardTypes = await db.all(`
    SELECT COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category)) as award_type, COUNT(a.id) as freq
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ? AND COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category)) IS NOT NULL AND COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category)) != ''
    GROUP BY COALESCE(NULLIF(TRIM(a.award_type), ''), TRIM(a.category))
    ORDER BY freq DESC
  `, [org.id]);

  let customIcons = {};
  try {
    if (org.custom_icons) customIcons = JSON.parse(org.custom_icons);
  } catch (e) { }

  res.render('manage_org_branding', { org, awardTypes, customIcons, user: req.session.user });
});


router.post('/manage/org/:id/marketing', requireAuth, requireOrgOwner({ allowAdmin: false }), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  const { description, slogan, website } = req.body;

  await db.run('UPDATE organizations SET description = ?, slogan = ?, website = ? WHERE id = ?', [description, slogan, website, org.id]);

  res.redirect('/manage/org/' + org.id);
});


router.post('/manage/org/:id/branding/logo', requireAuth, requireOrgOwner({ allowAdmin: false }), brandingUpload.single('logo'), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  if (!req.file) return res.redirect('/manage/org/' + org.id + '/branding');

  const logoUrl = '/uploads/org_branding/' + req.file.filename;
  await db.run('UPDATE organizations SET logo_url = ? WHERE id = ?', [logoUrl, org.id]);

  res.redirect('/manage/org/' + org.id + '/branding');
});


router.post('/manage/org/:id/branding/logo-settings', requireAuth, requireOrgOwner({ allowAdmin: false }), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  let customIcons = {};
  if (org.custom_icons) {
    try { customIcons = JSON.parse(org.custom_icons); } catch (e) { }
  }

  customIcons.hide_logo = req.body.show_logo !== 'on'; // Checkbox is 'on' when checked
  customIcons.logo_size = parseInt(req.body.logo_size) || 24;
  customIcons.logo_opacity = parseFloat(req.body.logo_opacity);
  if (isNaN(customIcons.logo_opacity)) customIcons.logo_opacity = 0.6;

  // Position/rotation are deliberately superadmin-only fine-tuning (design
  // consistency: owners get size/opacity, we adjust the rest per logo as
  // needed). Owner submissions simply don't carry these fields, and even a
  // crafted POST is ignored here.
  if (req.session.user.role === 'superadmin') {
    const clampInt = (v, lo, hi) => {
      v = parseInt(v);
      return isNaN(v) ? 0 : Math.max(lo, Math.min(hi, v));
    };
    customIcons.logo_offset_x = clampInt(req.body.logo_offset_x, -24, 24);
    customIcons.logo_offset_y = clampInt(req.body.logo_offset_y, -24, 24);
    customIcons.logo_rotation = clampInt(req.body.logo_rotation, -180, 180);
    // Public cards show the logo only after this approval (concierge
    // default-off: we fit every logo into the coin before it goes live).
    customIcons.logo_approved = req.body.logo_approved === 'on';
  }

  await db.run('UPDATE organizations SET custom_icons = ? WHERE id = ?', [JSON.stringify(customIcons), org.id]);

  res.redirect('/manage/org/' + org.id + '/branding');
});


router.post('/manage/org/:id/branding/icon', requireAuth, requireOrgOwner({ allowAdmin: false }), brandingUpload.single('icon'), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  const { icon_class, icon_key } = req.body;
  if (!icon_class) return res.status(400).send('Icon class required');

  let customIcons = {};
  try {
    if (org.custom_icons) customIcons = JSON.parse(org.custom_icons);
  } catch (e) { }

  if (!customIcons[icon_class]) customIcons[icon_class] = {};

  if (req.file) {
    const filePath = '/uploads/org_branding/' + req.file.filename;
    if (icon_class === 'scholarship') {
      customIcons.scholarship.default = filePath;
    } else if (icon_class === 'special' && icon_key === 'default') {
      customIcons.special.default = filePath;
    } else if (icon_class === 'special') {
      if (!customIcons.special.custom) customIcons.special.custom = {};
      customIcons.special.custom[icon_key] = filePath;
    } else {
      customIcons[icon_class][icon_key] = filePath;
    }
    await db.run('UPDATE organizations SET custom_icons = ? WHERE id = ?', [JSON.stringify(customIcons), org.id]);
  }

  res.redirect('/manage/org/' + org.id + '/branding');
});


router.post('/manage/org/:id/branding/icon/delete', requireAuth, requireOrgOwner({ allowAdmin: false }), async (req, res) => {
  const db = await openDb();
  const org = req.org;

  const { icon_class, icon_key } = req.body;
  let customIcons = {};
  try {
    if (org.custom_icons) customIcons = JSON.parse(org.custom_icons);
  } catch (e) { }

  if (customIcons[icon_class]) {
    if (icon_class === 'scholarship') {
      delete customIcons.scholarship.default;
    } else if (icon_class === 'special' && icon_key === 'default') {
      delete customIcons.special.default;
    } else if (icon_class === 'special' && customIcons.special.custom) {
      delete customIcons.special.custom[icon_key];
    } else {
      delete customIcons[icon_class][icon_key];
    }
    await db.run('UPDATE organizations SET custom_icons = ? WHERE id = ?', [JSON.stringify(customIcons), org.id]);
  }

  res.redirect('/manage/org/' + org.id + '/branding');
});

module.exports = router;
