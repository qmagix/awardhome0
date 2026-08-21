const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { logStudioActivity } = require('../../utils/activity');
const { requireAuth } = require('../../middleware/auth');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { generateDancerId } = require('../../utils.js');
const { validateVanityTag } = require('../../utils/vanity');
const { flagOn } = require('../../utils/featureFlags');
const { moderateNote, getModerationMode } = require('../../utils/moderation');

// ---- Flip-book card extras (photo + thank-you lines) ----

// Same raster-only rules as org branding uploads: multer's random
// extension-less filenames can't be served as HTML/JS, SVG excluded.
const CARD_PHOTO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const cardPhotoUpload = multer({
  dest: 'public/uploads/dancer_photos/',
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (CARD_PHOTO_MIMES.has(file.mimetype) && /\.(png|jpe?g|webp|gif|avif)$/i.test(file.originalname || '')) {
      return cb(null, true);
    }
    const err = new Error('Only PNG, JPG, WebP, GIF, or AVIF images are accepted.');
    err.status = 400;
    cb(err);
  },
});

// Card extras may be managed by the dancer owner, an owner of a studio the
// dancer is actively affiliated with, or an admin. Returns the dancer row
// or null when not permitted.
async function getDancerIfCardManager(db, user, dancerId) {
  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [dancerId]);
  if (!dancer) return null;
  if (user.role === 'admin' || user.role === 'superadmin') return dancer;
  if (dancer.claimed_by_user_id === user.id) return dancer;
  const viaStudio = await db.get(`
    SELECT 1 FROM dancer_studios ds
    JOIN studios s ON ds.studio_id = s.id
    WHERE ds.dancer_id = ? AND ds.status = 'active' AND s.owner_id = ?
  `, [dancerId, user.id]);
  return viaStudio ? dancer : null;
}

// Other awards won by the same routine at the same event that this dancer
// is also linked to (the Smart Auto-Backfill matching rule). Used to
// propagate a freshly saved note/photo across the set.
async function sameRoutineAwards(db, awardId, dancerId) {
  const target = await db.get('SELECT event_id, performance_name FROM awards WHERE id = ?', [awardId]);
  if (!target || !target.event_id || !target.performance_name || !target.performance_name.trim()) return [];
  return db.all(`
    SELECT a.id FROM awards a
    JOIN award_dancers ad ON ad.award_id = a.id
    WHERE ad.dancer_id = ? AND a.event_id = ? AND a.performance_name = ? AND a.id != ?
  `, [dancerId, target.event_id, target.performance_name, awardId]);
}

// New tables: created defensively so the routes work before `node database.js`
// has been re-run (same pattern as some admin routes).
async function ensureCardTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS award_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id INTEGER NOT NULL REFERENCES awards(id),
      dancer_id INTEGER NOT NULL REFERENCES dancers(id),
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(award_id, dancer_id)
    );
    CREATE TABLE IF NOT EXISTS award_card_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id INTEGER NOT NULL REFERENCES awards(id),
      dancer_id INTEGER NOT NULL REFERENCES dancers(id),
      photo_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      uploaded_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(award_id, dancer_id)
    );
    CREATE TABLE IF NOT EXISTS card_photo_consents (
      user_id INTEGER NOT NULL REFERENCES users(id),
      dancer_id INTEGER NOT NULL REFERENCES dancers(id),
      consented_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, dancer_id)
    );
  `);
}

// One-time consent: the first upload for a dancer must carry the checkbox
// and records the affirmation; every later upload by the same account for
// the same dancer skips it. Returns null when OK to proceed, or an error
// string when the (first-time) checkbox is missing.
async function ensurePhotoConsent(db, userId, dancerId, body) {
  const existing = await db.get(
    'SELECT 1 FROM card_photo_consents WHERE user_id = ? AND dancer_id = ?', [userId, dancerId]);
  if (existing) return null;
  if (body.consent !== 'on') {
    return 'Photo not saved: the one-time photo permission box must be checked.';
  }
  await db.run(
    'INSERT OR IGNORE INTO card_photo_consents (user_id, dancer_id) VALUES (?, ?)', [userId, dancerId]);
  return null;
}

// WYSIWYG card editor: renders the dancer's actual flipbook cards with
// pages materialized as inline-editable placeholders (cardEditMode in the
// card partial). Sorted incomplete-first so the remaining work leads.
router.get('/manage/dancer/:id/card', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await getDancerIfCardManager(db, req.session.user, req.params.id);
  if (!dancer) return res.status(403).send('Forbidden: Not the owner');
  await ensureCardTables(db);

  const awards = await db.all(`
    SELECT a.*, e.name as event_name, e.year as event_year, o.name as org_name, o.logo_url, o.custom_icons,
      (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) as dancer_count
    FROM awards a
    JOIN award_dancers ad ON a.id = ad.award_id
    JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE ad.dancer_id = ?
    ORDER BY e.year DESC
  `, [dancer.id]);

  const ackRows = await db.all(
    'SELECT award_id, message, status FROM award_acknowledgements WHERE dancer_id = ?', [dancer.id]);
  const ackMap = {};
  ackRows.forEach(r => { ackMap[r.award_id] = r; });

  const photoRows = await db.all(
    'SELECT award_id, photo_url, status FROM award_card_photos WHERE dancer_id = ?', [dancer.id]);
  const photoMap = {};
  photoRows.forEach(r => { photoMap[r.award_id] = r; });

  // Teammates' approved lines, shown read-only on group cards' ack page
  const mateMap = {};
  const ids = awards.map(a => a.id);
  if (ids.length) {
    const mates = await db.all(`
      SELECT aa.award_id, aa.dancer_id, aa.message, d.name as dancer_name
      FROM award_acknowledgements aa
      JOIN dancers d ON aa.dancer_id = d.id
      WHERE aa.status = 'approved' AND aa.dancer_id != ? AND aa.award_id IN (${ids.map(() => '?').join(',')})
      ORDER BY d.name
    `, [dancer.id, ...ids]);
    mates.forEach(m => { (mateMap[m.award_id] = mateMap[m.award_id] || []).push(m); });
  }

  // Feature flags: the editor only offers what's released (or in beta for
  // this user); completion states count only the enabled features.
  const [featureNotes, featurePhotos] = await Promise.all([
    flagOn('thank_you_notes', req), flagOn('award_photos', req)]);

  awards.forEach(a => {
    if (a.custom_icons) { try { a.customIconsObj = JSON.parse(a.custom_icons); } catch (e) { } }
    a.ownAck = ackMap[a.id] || null;
    a.ownPhoto = photoMap[a.id] || null;
    a.acks = mateMap[a.id] || [];
    const slots = [];
    if (featurePhotos) slots.push(!!(a.ownPhoto && a.ownPhoto.status !== 'rejected'));
    if (featureNotes) slots.push(!!(a.ownAck && a.ownAck.status !== 'rejected'));
    a.editMissing = slots.filter(s => !s).length;
    a.editState = slots.length === 0 || a.editMissing === 0 ? 'done'
      : (a.editMissing === slots.length ? 'waiting' : 'partial');
  });
  const rank = { waiting: 0, partial: 1, done: 2 };
  awards.sort((x, y) => rank[x.editState] - rank[y.editState]); // stable: keeps year DESC within groups

  const consentRow = await db.get(
    'SELECT consented_at FROM card_photo_consents WHERE user_id = ? AND dancer_id = ?',
    [req.session.user.id, dancer.id]);

  res.render('manage_dancer_card', {
    dancer, awards, consent: consentRow || null, cardDesign: 'flipbook',
    featureNotes, featurePhotos,
  });
});


// The WYSIWYG editor saves via fetch with ?json=1 (JSON responses, no
// redirect); the bare form flow keeps redirects.
router.post('/manage/dancer/:id/card/award-photo', requireAuth, cardPhotoUpload.single('photo'), async (req, res) => {
  const db = await openDb();
  const dancer = await getDancerIfCardManager(db, req.session.user, req.params.id);
  if (!dancer) return res.status(403).send('Forbidden');
  await ensureCardTables(db);
  const back = `/manage/dancer/${req.params.id}/card`;
  const wantsJson = req.query.json === '1';
  const fail = (msg) => wantsJson
    ? res.status(400).json({ error: msg })
    : res.send(`<script>alert(${JSON.stringify(msg)}); window.location.href=${JSON.stringify(back)};</script>`);

  if (!await flagOn('award_photos', req)) return fail('This feature is not available yet.');
  const awardId = parseInt(req.body.award_id);
  if (!awardId) return fail('Missing award');
  if (!req.file) return fail('Please choose an image file.');
  // Same one-time consent gate as the default card photo (the affirmation
  // wording covers everyone pictured, so it spans both upload kinds).
  const consentErr = await ensurePhotoConsent(db, req.session.user.id, dancer.id, req.body);
  if (consentErr) return fail(consentErr);

  const linked = await db.get(
    'SELECT 1 FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [awardId, dancer.id]);
  if (!linked) return fail('That award is not linked to this dancer.');

  // Any replacement goes back to pending — every public photo was reviewed
  const photoUrl = '/uploads/dancer_photos/' + req.file.filename;
  await db.run(`
    INSERT INTO award_card_photos (award_id, dancer_id, photo_url, status, uploaded_by)
    VALUES (?, ?, ?, 'pending', ?)
    ON CONFLICT(award_id, dancer_id) DO UPDATE SET
      photo_url = excluded.photo_url, status = 'pending',
      uploaded_by = excluded.uploaded_by, updated_at = CURRENT_TIMESTAMP
  `, [awardId, dancer.id, photoUrl, req.session.user.id]);
  // Same routine, same event → same performance shot: fill the sibling
  // awards too (INSERT OR IGNORE — awards with their own photo keep it).
  let propagated = 0;
  for (const s of await sameRoutineAwards(db, awardId, dancer.id)) {
    const r = await db.run(`
      INSERT OR IGNORE INTO award_card_photos (award_id, dancer_id, photo_url, status, uploaded_by)
      VALUES (?, ?, ?, 'pending', ?)
    `, [s.id, dancer.id, photoUrl, req.session.user.id]);
    if (r.changes > 0) propagated++;
  }
  if (wantsJson) return res.json({ success: true, photo_url: photoUrl, propagated });
  res.redirect(back);
});


router.post('/manage/dancer/:id/card/award-photo/remove', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await getDancerIfCardManager(db, req.session.user, req.params.id);
  if (!dancer) return res.status(403).send('Forbidden');
  await ensureCardTables(db);

  const awardId = parseInt(req.body.award_id);
  if (awardId) {
    await db.run('DELETE FROM award_card_photos WHERE award_id = ? AND dancer_id = ?', [awardId, dancer.id]);
  }
  if (req.query.json === '1') return res.json({ success: true });
  res.redirect(`/manage/dancer/${req.params.id}/card`);
});


router.post('/manage/dancer/:id/card/photo', requireAuth, cardPhotoUpload.single('photo'), async (req, res) => {
  const db = await openDb();
  const dancer = await getDancerIfCardManager(db, req.session.user, req.params.id);
  if (!dancer) return res.status(403).send('Forbidden');
  await ensureCardTables(db);
  const back = `/manage/dancer/${req.params.id}`;

  if (!await flagOn('award_photos', req)) return res.status(403).send('This feature is not available yet.');
  if (!req.file) {
    return res.send(`<script>alert("Please choose an image file."); window.location.href=${JSON.stringify(back)};</script>`);
  }
  // Consent is a hard gate (most dancers are minors, photos render on
  // publicly shareable cards) but asked once per uploader per dancer.
  const consentErr = await ensurePhotoConsent(db, req.session.user.id, dancer.id, req.body);
  if (consentErr) {
    return res.send(`<script>alert(${JSON.stringify(consentErr)}); window.location.href=${JSON.stringify(back)};</script>`);
  }

  await db.run(
    "UPDATE dancers SET card_photo_url = ?, card_photo_status = 'pending', card_photo_uploaded_by = ? WHERE id = ?",
    ['/uploads/dancer_photos/' + req.file.filename, req.session.user.id, dancer.id]);
  // The default-photo form lives on the Manage Profile page
  res.redirect(`/manage/dancer/${req.params.id}`);
});


router.post('/manage/dancer/:id/card/photo/remove', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await getDancerIfCardManager(db, req.session.user, req.params.id);
  if (!dancer) return res.status(403).send('Forbidden');

  await db.run(
    "UPDATE dancers SET card_photo_url = NULL, card_photo_status = 'none', card_photo_uploaded_by = NULL WHERE id = ?",
    [dancer.id]);
  res.redirect(`/manage/dancer/${req.params.id}`);
});


router.post('/manage/dancer/:id/card/ack', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await getDancerIfCardManager(db, req.session.user, req.params.id);
  if (!dancer) return res.status(403).send('Forbidden');
  await ensureCardTables(db);
  const back = `/manage/dancer/${req.params.id}/card`;
  const wantsJson = req.query.json === '1';
  const fail = (msg) => wantsJson
    ? res.status(400).json({ error: msg })
    : res.send(`<script>alert(${JSON.stringify(msg)}); window.location.href=${JSON.stringify(back)};</script>`);

  if (!await flagOn('thank_you_notes', req)) return fail('This feature is not available yet.');
  const awardId = parseInt(req.body.award_id);
  const message = String(req.body.message || '').trim().slice(0, 280);
  if (!awardId) return fail('Missing award');

  // The line must belong to an award this dancer is actually linked to
  const linked = await db.get(
    'SELECT 1 FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [awardId, dancer.id]);
  if (!linked) return fail('That award is not linked to this dancer.');

  let propagated = 0;
  let status = 'pending';
  let modNote = null;
  if (!message) {
    // Clearing removes only THIS award's line — siblings keep theirs
    await db.run('DELETE FROM award_acknowledgements WHERE award_id = ? AND dancer_id = ?', [awardId, dancer.id]);
  } else {
    // Machine moderation (utils/moderation.js): in 'auto' mode a clean
    // verdict goes live immediately; 'assisted' just annotates the queue;
    // any flag/failure leaves the note pending exactly as before.
    if (await flagOn('auto_moderation', req)) {
      const mode = await getModerationMode(db);
      if (mode !== 'manual') {
        const m = await moderateNote(message, req.session.user.id);
        modNote = m.note;
        if (mode === 'auto' && m.verdict === 'approve') {
          status = 'approved';
          modNote = 'auto-approved';
        }
      }
    }
    await db.run(`
      INSERT INTO award_acknowledgements (award_id, dancer_id, message, status, created_by, moderation_note)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(award_id, dancer_id) DO UPDATE SET
        message = excluded.message, status = excluded.status,
        created_by = excluded.created_by, moderation_note = excluded.moderation_note,
        updated_at = CURRENT_TIMESTAMP
    `, [awardId, dancer.id, message, status, req.session.user.id, modNote]);
    // One routine often wins several awards at the same event; fill the
    // siblings too so families type the note once. INSERT OR IGNORE:
    // awards that already have a line keep it — later edits stay per-award.
    for (const s of await sameRoutineAwards(db, awardId, dancer.id)) {
      const r = await db.run(`
        INSERT OR IGNORE INTO award_acknowledgements (award_id, dancer_id, message, status, created_by, moderation_note)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [s.id, dancer.id, message, status, req.session.user.id, modNote]);
      if (r.changes > 0) propagated++;
    }
  }
  if (wantsJson) return res.json({ success: true, cleared: !message, propagated, status });
  res.redirect(back);
});

// Legacy single-dancer entry point → the dashboard
router.get('/my-dancer', requireAuth, (req, res) => res.redirect('/my-dancers'));


// Parent/dancer dashboard: every dancer this account owns (a parent may
// manage several kids) plus the status of claims still in flight — the
// answer to "I logged in, where's my dancer?".
router.get('/my-dancers', requireAuth, async (req, res) => {
  const db = await openDb();
  const userId = req.session.user.id;

  const dancers = await db.all(`
    SELECT d.*, (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) as award_count
    FROM dancers d
    WHERE d.claimed_by_user_id = ?
    ORDER BY d.name
  `, [userId]);

  // Claims not yet reflected above: pending review or rejected. Approved
  // claims become owned dancers, so they'd be duplicates here.
  let claims = [];
  try {
    claims = await db.all(`
      SELECT dc.id, dc.status, dc.code_valid, dc.created_at,
             d.name as dancer_name, d.unique_id, s.name as studio_name
      FROM dancer_claims dc
      JOIN dancers d ON dc.dancer_id = d.id
      LEFT JOIN studios s ON dc.studio_id = s.id
      WHERE dc.user_id = ? AND dc.status != 'approved'
      ORDER BY dc.created_at DESC
    `, [userId]);
  } catch (e) { /* studio_id/code_valid columns missing until migrate */ }

  // Studio claims in review: a claimant who lands here (via nav) should
  // see "approval pending", not be pushed into the parent/dancer flow.
  let studioClaims = [];
  try {
    studioClaims = await db.all(`
      SELECT sc.status, sc.created_at, s.id as studio_id, s.name as studio_name
      FROM studio_claims sc
      JOIN studios s ON sc.studio_id = s.id
      WHERE sc.user_id = ? AND sc.status = 'pending'
      ORDER BY sc.created_at DESC
    `, [userId]);
  } catch (e) { /* table missing before first migrate */ }

  res.render('my_dancers', { dancers, claims, studioClaims });
});


router.get('/manage/dancer/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);

  if (!dancer) return res.status(404).send('Dancer not found');
  if (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden: Not the owner');
  }

  const studios = await db.all(`
    SELECT s.name, s.unique_id, ds.status, ds.id as link_id
    FROM dancer_studios ds
    JOIN studios s ON ds.studio_id = s.id
    WHERE ds.dancer_id = ?
  `, [dancer.id]);

  const awards = await db.all(`
    SELECT a.*, e.name as event_name, e.year, s.name as studio_name, o.name as org_name
    FROM awards a
    JOIN award_dancers ad ON a.id = ad.award_id
    JOIN events e ON a.event_id = e.id
    LEFT JOIN studios s ON a.studio_id = s.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE ad.dancer_id = ?
    ORDER BY e.year DESC
  `, [dancer.id]);

  // Default card photo + one-time consent live on this page's Profile section
  await ensureCardTables(db);
  const consentRow = await db.get(
    'SELECT consented_at FROM card_photo_consents WHERE user_id = ? AND dancer_id = ?',
    [req.session.user.id, dancer.id]);
  const featurePhotos = await flagOn('award_photos', req);

  res.render('manage_dancer', { dancer, studios, awards, consent: consentRow || null, featurePhotos });
});


router.post('/manage/dancer/:id/update', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);

  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) {
    return res.status(403).send('Forbidden');
  }

  const { name, birthday, headshot_url, graduation_year, instagram_handle, tiktok_handle, vanity_tag } = req.body;

  const vanity = validateVanityTag(vanity_tag);
  if (!vanity.ok) {
    return res.send(`<script>alert(${JSON.stringify('Vanity tag not saved: ' + vanity.error)}); window.location.href="/manage/dancer/${req.params.id}";</script>`);
  }

  await db.run(`
    UPDATE dancers
    SET name = ?, birthday = ?, headshot_url = ?, graduation_year = ?, instagram_handle = ?, tiktok_handle = ?, vanity_tag = ?
    WHERE id = ?
  `, [name, birthday || null, headshot_url || null, graduation_year || null, instagram_handle || null, tiktok_handle || null, vanity.tag, req.params.id]);

  res.redirect(`/manage/dancer/${req.params.id}`);
});


router.post('/manage/dancer/:id/join-studio', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);

  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) {
    return res.status(403).send('Forbidden');
  }

  const { studio_unique_id } = req.body;
  const studio = await db.get('SELECT id FROM studios WHERE unique_id = ?', [studio_unique_id.trim()]);

  if (!studio) {
    return res.send(`<script>alert("Studio not found with that Unique ID."); window.location.href="/manage/dancer/${req.params.id}";</script>`);
  }

  try {
    await db.run('INSERT INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, ?)', [req.params.id, studio.id, 'pending']);
    res.send(`<script>alert("Request sent successfully! The studio director must approve it."); window.location.href="/manage/dancer/${req.params.id}";</script>`);
  } catch (err) {
    // Unique constraint violation
    res.send(`<script>alert("You are already linked or have a pending request for this studio."); window.location.href="/manage/dancer/${req.params.id}";</script>`);
  }
});


// API: Search Missing Awards
router.get('/api/dancer/:id/search-missing-awards', requireAuth, async (req, res) => {
  const db = await openDb();

  // Verify ownership
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let { q, studio } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json([]);
  }

  q = q.trim();
  const nameQuery = `%${q}%`;

  try {
    let sql = `
      SELECT 
        a.id, a.performance_name, a.category, a.place, a.award_type,
        e.name as event_name, e.year, o.name as org_name,
        s.name as studio_name, d.name as dancer_name_on_award
      FROM awards a
      JOIN events e ON a.event_id = e.id
      LEFT JOIN organizations o ON e.org_id = o.id
      LEFT JOIN studios s ON a.studio_id = s.id
      JOIN award_dancers ad ON a.id = ad.award_id
      JOIN dancers d ON ad.dancer_id = d.id
      WHERE d.name LIKE ? COLLATE NOCASE
      AND a.id NOT IN (
        SELECT award_id FROM award_dancers WHERE dancer_id = ?
      )
    `;
    const params = [nameQuery, req.params.id];

    if (studio && studio.trim().length > 0) {
      sql += ` AND s.name LIKE ? COLLATE NOCASE`;
      params.push(`${studio.trim()}%`);
    }

    sql += ` ORDER BY e.year DESC, e.name ASC LIMIT 50`;

    const results = await db.all(sql, params);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});


// API: Claim Missing Award (Smart Auto-Backfill)
router.post('/manage/dancer/:id/claim-missing-award', requireAuth, async (req, res) => {
  const db = await openDb();

  // Verify ownership
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { award_id } = req.body;
  if (!award_id) return res.status(400).json({ error: 'Missing award ID' });

  try {
    // Check if already linked
    const existing = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [req.params.id, award_id]);
    if (existing) {
      return res.status(400).json({ error: 'Already claimed this award.' });
    }

    // Insert pending claim for the main award
    await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [award_id, req.params.id]);

    // Smart Auto-Backfill
    const targetAward = await db.get('SELECT event_id, performance_name, studio_id FROM awards WHERE id = ?', [award_id]);
    let backfilledCount = 0;

    if (targetAward && targetAward.performance_name && targetAward.event_id) {
      // Find other awards for the same routine at the same event
      const relatedAwards = await db.all(
        'SELECT id FROM awards WHERE event_id = ? AND performance_name = ? AND id != ?',
        [targetAward.event_id, targetAward.performance_name, award_id]
      );

      for (let rel of relatedAwards) {
        const exist = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [req.params.id, rel.id]);
        if (!exist) {
          await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [rel.id, req.params.id]);
          backfilledCount++;
        }
      }
    }

    res.json({ success: true, backfilledCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});


router.get('/api/check-dancer-studio', async (req, res) => {
  const { unique_id, studio_id } = req.query;
  const db = await openDb();

  if (!unique_id || !studio_id) return res.json({ linked: false });

  const dancer = await db.get('SELECT id FROM dancers WHERE unique_id = ?', [unique_id]);
  if (!dancer) return res.json({ linked: false });

  const link = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [dancer.id, studio_id]);
  return res.json({ linked: !!link });
});


const claimAwardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many claims submitted from this IP, please try again after 15 minutes' }
});

router.post('/api/claim-award', claimAwardLimiter, async (req, res) => {
  const { award_id, studio_id, join_code, unique_id, name, birthday } = req.body;
  const db = await openDb();

  try {
    let dancerId = null;
    let isLinked = false;
    let generatedUniqueId = null;
    let dancerName = name;
    let finalUniqueId = null;

    if (unique_id) {
      const dancer = await db.get('SELECT id, name, unique_id FROM dancers WHERE unique_id = ?', [unique_id]);
      if (!dancer) return res.status(404).json({ error: 'Dancer with that Unique ID not found.' });
      dancerId = dancer.id;
      dancerName = dancer.name;
      finalUniqueId = dancer.unique_id;
      const link = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [dancerId, studio_id]);
      if (link) isLinked = true;
    } else if (name) {
      // Create new unverified dancer
      generatedUniqueId = generateDancerId(name);
      const result = await db.run(
        'INSERT INTO dancers (unique_id, name, birthday, needs_investigation) VALUES (?, ?, ?, 1)',
        [generatedUniqueId, name, birthday || null]
      );
      dancerId = result.lastID;
    } else {
      return res.status(400).json({ error: 'Must provide Unique ID or Name.' });
    }

    // If not already linked to the studio, they MUST provide the correct join_code
    if (!isLinked) {
      const studio = await db.get('SELECT id, join_code FROM studios WHERE id = ?', [studio_id]);
      if (!studio || studio.join_code !== join_code) {
        return res.status(400).json({ error: 'The Studio Secret Code you entered is incorrect. Please double check with your Studio Director.' });
      }
      // Insert dancer_studios pending
      await db.run("INSERT INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, 'pending')", [dancerId, studio_id]);
    }

    // Fetch target award to get performance_name and event_id
    const targetAward = await db.get('SELECT event_id, performance_name FROM awards WHERE id = ?', [award_id]);

    // Insert award_dancers pending for the main award
    const existingAwardLink = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [dancerId, award_id]);
    if (!existingAwardLink) {
      await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [award_id, dancerId]);
    } else {
      return res.status(400).json({ error: 'You are already linked to this award.' });
    }

    let backfilledAwards = [parseInt(award_id)];

    // Backfill other awards with the same performance_name at the same event
    if (targetAward && targetAward.performance_name && targetAward.event_id) {
      const relatedAwards = await db.all(
        'SELECT id FROM awards WHERE event_id = ? AND performance_name = ? AND studio_id = ? AND id != ?',
        [targetAward.event_id, targetAward.performance_name, studio_id, award_id]
      );

      for (let rel of relatedAwards) {
        const exist = await db.get('SELECT id FROM award_dancers WHERE dancer_id = ? AND award_id = ?', [dancerId, rel.id]);
        if (!exist) {
          await db.run("INSERT INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, 'pending')", [rel.id, dancerId]);
          backfilledAwards.push(rel.id);
        }
      }
    }

    if (name && !unique_id) {
      finalUniqueId = generatedUniqueId;
    }

    if (studio_id) logStudioActivity(studio_id, 'award_claim');
    res.json({ success: true, newUniqueId: generatedUniqueId, dancerName, dancerUniqueId: finalUniqueId, backfilledAwards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
