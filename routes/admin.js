const express = require('express');
const router = express.Router();
const { openDb } = require('../database');
const { logStudioActivity } = require('../utils/activity');
const { computeFeaturedStudios } = require('../utils/featured');
const { sendStudioInvite, buildStudioInvite, buildOrgInviteTemplate, sendOrgInvite } = require('../utils/invites');
const { refresh } = require('../utils/cache');
const { requireAdmin, requireSuperadmin } = require('../middleware/auth');
const { approveDancerClaim, rejectDancerClaim } = require('../utils/claims');
const { FLAG_DEFS, VALID_STATES, refreshFlags } = require('../utils/featureFlags');
const bcrypt = require('bcrypt');
const { runBackfillForEvent } = require('../backfill_utils');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---- Weekly-import review state (written by scripts/weekly_update.js when a
// staged run is held; cleared on successful --promote or admin dismiss). ----
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const PENDING_REVIEW_PATH = path.join(REPORTS_DIR, 'PENDING_REVIEW.json');
function readPendingReview() {
  try { return JSON.parse(fs.readFileSync(PENDING_REVIEW_PATH, 'utf8')); }
  catch (e) { return null; }
}


router.post('/api/studios/:id/investigate', requireAdmin, express.json(), async (req, res) => {
  const db = await openDb();
  const { investigate } = req.body;
  await db.run(`UPDATE studios SET needs_investigation = ? WHERE id = ?`, [investigate ? 1 : 0, req.params.id]);
  res.json({ success: true });
});


router.post('/api/studios/:id/feature', requireAdmin, express.json(), async (req, res) => {
  const db = await openDb();
  const { feature } = req.body;
  await db.run(`UPDATE studios SET is_featured = ? WHERE id = ?`, [feature ? 1 : 0, req.params.id]);
  // Background refresh: the change shows up within seconds without any
  // visitor paying the homepage recompute (invalidate would cause that).
  refresh('dance-home');
  res.json({ success: true });
});


router.post('/admin/impersonate/generate', requireSuperadmin, async (req, res) => {
  const { user_id, target_url } = req.body;
  if (!user_id || !target_url) return res.status(400).json({ error: 'Missing parameters' });

  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');

  const db = await openDb();
  await db.run('INSERT INTO impersonation_tokens (token, target_user_id, target_url) VALUES (?, ?, ?)', [token, user_id, target_url]);

  // Return the one-time login link
  const link = `${req.protocol}://${req.get('host')}/login/impersonate/${token}`;
  res.json({ success: true, link });
});


router.get('/admin/accounts', requireSuperadmin, async (req, res) => {
  const db = await openDb();

  const orgs = await db.all(`
    SELECT o.id, o.name, o.owner_id, u.email as owner_email, COUNT(e.id) as event_count
    FROM organizations o
    JOIN users u ON o.owner_id = u.id
    LEFT JOIN events e ON o.id = e.org_id
    GROUP BY o.id
  `);

  const studios = await db.all(`
    SELECT s.id, s.unique_id, s.name, s.owner_id, u.email as owner_email, COUNT(a.id) as award_count
    FROM studios s
    JOIN users u ON s.owner_id = u.id
    LEFT JOIN awards a ON s.id = a.studio_id
    GROUP BY s.id
  `);

  res.render('admin_accounts', { orgs, studios, user: req.session.user });
});


router.get('/admin/settings', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  
  // Create table if it didn't exist (in case initDb wasn't run)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  // Ensure default model is there
  await db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('openai_model', 'gpt-4o-mini')`);

  const settings = await db.all('SELECT * FROM system_settings');
  const settingsMap = {};
  settings.forEach(s => settingsMap[s.key] = s.value);

  res.render('admin_settings', { user: req.session.user, settings: settingsMap });
});


router.post('/api/admin/settings', requireSuperadmin, async (req, res) => {
  try {
    const db = await openDb();
    const { key, value } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'Missing key or value' });

    await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ---- Feature flags (deploy ≠ release): superadmin release console ----
router.get('/admin/features', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  // Same defensive pattern as /admin/settings, in case initDb wasn't re-run
  await db.exec(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'off',
      flip_at DATETIME,
      notes TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const def of FLAG_DEFS) {
    await db.run("INSERT OR IGNORE INTO feature_flags (key, state) VALUES (?, 'off')", [def.key]);
  }
  const rows = await db.all('SELECT * FROM feature_flags');
  const rowMap = {};
  rows.forEach(r => { rowMap[r.key] = r; });
  const flags = FLAG_DEFS.map(def => ({ ...def, ...(rowMap[def.key] || { state: 'off' }) }));
  res.render('admin_features', { user: req.session.user, flags });
});


router.post('/api/admin/features', requireSuperadmin, express.json(), async (req, res) => {
  const { key, state, flip_at, notes } = req.body || {};
  if (!FLAG_DEFS.some(d => d.key === key)) return res.status(400).json({ error: 'Unknown flag' });
  if (!VALID_STATES.includes(state)) return res.status(400).json({ error: 'Invalid state' });
  // Scheduled flips only make sense for a not-yet-on flag
  let flipAt = null;
  if (flip_at && state !== 'on') {
    const d = new Date(flip_at);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid flip date' });
    flipAt = d.toISOString();
  }
  const db = await openDb();
  await db.run(
    'UPDATE feature_flags SET state = ?, flip_at = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [state, flipAt, String(notes || '').slice(0, 300) || null, key]);
  refreshFlags(); // live within the cache TTL
  res.json({ success: true });
});


// ---- Flip-book card content moderation (photos + thank-you lines) ----
// Concierge gate, same philosophy as logo-coin approval: nothing owner-
// submitted reaches a public card until a superadmin has seen it (authors
// are often minors; group acks surface on teammates' pages too).

// Resolve open community flags when a moderation decision lands.
async function resolveFlags(db, contentType, contentId, approved) {
  try {
    await db.run(
      "UPDATE content_flags SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE content_type = ? AND content_id = ? AND status = 'open'",
      [approved ? 'resolved_reinstated' : 'resolved_removed', contentType, contentId]);
  } catch (e) { /* table missing until migrate */ }
}

router.get('/admin/card-content', requireSuperadmin, async (req, res) => {
  const db = await openDb();

  let pendingPhotos = [];
  try {
    pendingPhotos = await db.all(`
      SELECT d.id, d.name, d.unique_id, d.card_photo_url, u.email as uploader_email
      FROM dancers d
      LEFT JOIN users u ON d.card_photo_uploaded_by = u.id
      WHERE d.card_photo_status = 'pending'
      ORDER BY d.name
    `);
  } catch (e) { /* columns missing until `node database.js` runs */ }

  let pendingAcks = [];
  try {
    pendingAcks = await db.all(`
      SELECT aa.id, aa.message, aa.created_at, aa.moderation_note, d.name as dancer_name, d.unique_id,
             a.performance_name, a.award_type, a.place, e.name as event_name, e.year
      FROM award_acknowledgements aa
      JOIN dancers d ON aa.dancer_id = d.id
      JOIN awards a ON aa.award_id = a.id
      LEFT JOIN events e ON a.event_id = e.id
      WHERE aa.status = 'pending'
      ORDER BY aa.created_at ASC
    `);
  } catch (e) { /* table missing until `node database.js` runs */ }

  // Trust-but-verify feed for auto mode: what the machine put live
  // recently, with one-click revoke.
  let autoApproved = [];
  try {
    autoApproved = await db.all(`
      SELECT aa.id, aa.message, aa.updated_at, d.name as dancer_name, d.unique_id,
             a.performance_name, a.award_type, e.name as event_name, e.year
      FROM award_acknowledgements aa
      JOIN dancers d ON aa.dancer_id = d.id
      JOIN awards a ON aa.award_id = a.id
      LEFT JOIN events e ON a.event_id = e.id
      WHERE aa.status = 'approved' AND aa.moderation_note = 'auto-approved'
      ORDER BY aa.updated_at DESC
      LIMIT 30
    `);
  } catch (e) { /* moderation_note column missing until migrate */ }

  let pendingAwardPhotos = [];
  try {
    pendingAwardPhotos = await db.all(`
      SELECT ap.id, ap.photo_url, ap.created_at, d.name as dancer_name, d.unique_id,
             a.performance_name, a.award_type, a.place, e.name as event_name, e.year,
             u.email as uploader_email
      FROM award_card_photos ap
      JOIN dancers d ON ap.dancer_id = d.id
      JOIN awards a ON ap.award_id = a.id
      LEFT JOIN events e ON a.event_id = e.id
      LEFT JOIN users u ON ap.uploaded_by = u.id
      WHERE ap.status = 'pending'
      ORDER BY ap.created_at ASC
    `);
  } catch (e) { /* table missing until `node database.js` runs */ }

  // Community flags on content that is still LIVE (previously human-
  // reinstated, so new flags no longer auto-dark — a human decides here).
  let flaggedLive = [];
  try {
    flaggedLive = await db.all(`
      SELECT cf.id as flag_id, cf.content_type, cf.content_id, cf.created_at,
             COUNT(*) OVER (PARTITION BY cf.content_type, cf.content_id) as flag_count,
             CASE cf.content_type
               WHEN 'ack' THEN (SELECT aa.message FROM award_acknowledgements aa WHERE aa.id = cf.content_id AND aa.status = 'approved')
               WHEN 'award_photo' THEN (SELECT ap.photo_url FROM award_card_photos ap WHERE ap.id = cf.content_id AND ap.status = 'approved')
               WHEN 'default_photo' THEN (SELECT d2.card_photo_url FROM dancers d2 WHERE d2.id = cf.content_id AND d2.card_photo_status = 'approved')
             END as content_preview
      FROM content_flags cf
      WHERE cf.status = 'open'
      GROUP BY cf.content_type, cf.content_id
      HAVING content_preview IS NOT NULL
      ORDER BY cf.created_at DESC LIMIT 50
    `);
  } catch (e) { /* table missing until migrate */ }

  res.render('admin_card_content', { user: req.session.user, pendingPhotos, pendingAcks, pendingAwardPhotos, autoApproved, flaggedLive });
});


// Revoke an auto-approved (or any approved) note: same-content copies by
// the same dancer are pulled together, mirroring approve propagation.
router.post('/api/admin/card-ack/:id/revoke', requireSuperadmin, express.json(), async (req, res) => {
  const db = await openDb();
  const row = await db.get("SELECT dancer_id, message FROM award_acknowledgements WHERE id = ? AND status = 'approved'", [req.params.id]);
  if (row) {
    await resolveFlags(db, 'ack', parseInt(req.params.id), false);
    await db.run(`
      UPDATE award_acknowledgements SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
      WHERE dancer_id = ? AND message = ? AND status = 'approved'
    `, [row.dancer_id, row.message]);
  }
  res.json({ success: true });
});


// Owner saves propagate identical copies across a routine's sibling
// awards, so one decision settles every pending copy with the same
// content from the same dancer — the reviewer judges the content once.
router.post('/api/admin/card-award-photo/:id', requireSuperadmin, express.json(), async (req, res) => {
  const db = await openDb();
  const status = req.body.action === 'approve' ? 'approved' : 'rejected';
  const row = await db.get("SELECT dancer_id, photo_url FROM award_card_photos WHERE id = ? AND status = 'pending'", [req.params.id]);
  if (row) {
    await db.run(`
      UPDATE award_card_photos SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE dancer_id = ? AND photo_url = ? AND status = 'pending'
    `, [status, row.dancer_id, row.photo_url]);
    await resolveFlags(db, 'award_photo', parseInt(req.params.id), status === 'approved');
  }
  res.json({ success: true });
});


router.post('/api/admin/card-photo/:dancerId', requireSuperadmin, express.json(), async (req, res) => {
  const db = await openDb();
  const status = req.body.action === 'approve' ? 'approved' : 'rejected';
  await db.run("UPDATE dancers SET card_photo_status = ? WHERE id = ? AND card_photo_status = 'pending'",
    [status, req.params.dancerId]);
  await resolveFlags(db, 'default_photo', parseInt(req.params.dancerId), status === 'approved');
  res.json({ success: true });
});


router.post('/api/admin/card-ack/:id', requireSuperadmin, express.json(), async (req, res) => {
  const db = await openDb();
  const status = req.body.action === 'approve' ? 'approved' : 'rejected';
  // Same-content propagation as card-award-photo: one decision settles
  // every pending copy of this exact line by this dancer.
  const row = await db.get("SELECT dancer_id, message FROM award_acknowledgements WHERE id = ? AND status = 'pending'", [req.params.id]);
  if (row) {
    await db.run(`
      UPDATE award_acknowledgements SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE dancer_id = ? AND message = ? AND status = 'pending'
    `, [status, row.dancer_id, row.message]);
    await resolveFlags(db, 'ack', parseInt(req.params.id), status === 'approved');
  }
  res.json({ success: true });
});


// Decide a flag on still-live content: keep (dismiss flags) or remove.
router.post('/api/admin/flag-resolve', requireSuperadmin, express.json(), async (req, res) => {
  const db = await openDb();
  const { content_type, content_id, action } = req.body || {};
  const keep = action === 'keep';
  if (!['ack', 'award_photo', 'default_photo'].includes(content_type) || !parseInt(content_id)) {
    return res.status(400).json({ error: 'Bad request' });
  }
  // Remove propagates to identical same-dancer copies (the platform's
  // one-decision-settles-every-copy convention), and flags across the
  // whole copy group resolve together so none are stranded open.
  let groupIds = [parseInt(content_id)];
  if (!keep) {
    if (content_type === 'ack') {
      const row = await db.get('SELECT dancer_id, message FROM award_acknowledgements WHERE id = ?', [content_id]);
      if (row) {
        groupIds = (await db.all('SELECT id FROM award_acknowledgements WHERE dancer_id = ? AND message = ?', [row.dancer_id, row.message])).map(r => r.id);
        await db.run("UPDATE award_acknowledgements SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE dancer_id = ? AND message = ? AND status != 'rejected'", [row.dancer_id, row.message]);
      }
    }
    if (content_type === 'award_photo') {
      const row = await db.get('SELECT dancer_id, photo_url FROM award_card_photos WHERE id = ?', [content_id]);
      if (row) {
        groupIds = (await db.all('SELECT id FROM award_card_photos WHERE dancer_id = ? AND photo_url = ?', [row.dancer_id, row.photo_url])).map(r => r.id);
        await db.run("UPDATE award_card_photos SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE dancer_id = ? AND photo_url = ? AND status != 'rejected'", [row.dancer_id, row.photo_url]);
      }
    }
    if (content_type === 'default_photo') await db.run("UPDATE dancers SET card_photo_status = 'rejected' WHERE id = ?", [content_id]);
  }
  for (const gid of groupIds) await resolveFlags(db, content_type, gid, keep);
  res.json({ success: true });
});

router.get('/admin', requireAdmin, async (req, res) => {
  const db = await openDb();

  // Parallelize the stats queries for performance
  const [
    totalOrgs, totalEvents, totalStudios, totalDancers, totalAwards,
    claimedStudios, claimedDancers, pendingClaims,
    studiosWithManyAwards, studiosWithEmail, marketingStudiosCount
  ] = await Promise.all([
    db.get(`SELECT COUNT(*) as count FROM organizations`),
    db.get(`SELECT COUNT(*) as count FROM events`),
    db.get(`SELECT COUNT(*) as count FROM studios`),
    db.get(`SELECT COUNT(*) as count FROM dancers`),
    db.get(`SELECT COUNT(*) as count FROM awards`),
    db.get(`SELECT COUNT(*) as count FROM studios WHERE is_claimed = 1`),
    db.get(`SELECT COUNT(DISTINCT dancer_id) as count FROM award_dancers WHERE status IN ('pending', 'approved')`),
    db.get(`SELECT COUNT(*) as count FROM studio_claims WHERE status = 'pending'`),
    db.get(`SELECT COUNT(*) as count FROM (SELECT studio_id FROM awards GROUP BY studio_id HAVING COUNT(*) > 15)`),
    db.get(`SELECT COUNT(*) as count FROM studios WHERE email IS NOT NULL AND email != ''`),
    db.get(`SELECT COUNT(*) as count FROM (SELECT s.id FROM studios s JOIN awards a ON s.id = a.studio_id WHERE s.email IS NOT NULL AND s.email != '' GROUP BY s.id HAVING COUNT(a.id) > 15)`)
  ]);

  // Invitation funnel for the marketing panel (tables exist post-migrate;
  // defensively zero if not)
  let invitesSent = 0, orgInvitesSent = 0;
  try { invitesSent = (await db.get('SELECT COUNT(*) as count FROM studio_invites')).count; } catch (e) {}
  try { orgInvitesSent = (await db.get('SELECT COUNT(*) as count FROM org_invites')).count; } catch (e) {}

  const stats = {
    orgs: totalOrgs.count,
    events: totalEvents.count,
    studios: totalStudios.count,
    dancers: totalDancers.count,
    awards: totalAwards.count,
    claimedStudios: claimedStudios.count,
    claimedDancers: claimedDancers.count,
    pendingClaims: pendingClaims.count,
    studiosWithManyAwards: studiosWithManyAwards ? studiosWithManyAwards.count : 0,
    studiosWithEmail: studiosWithEmail ? studiosWithEmail.count : 0,
    marketingStudiosCount: marketingStudiosCount ? marketingStudiosCount.count : 0,
    invitesSent, orgInvitesSent
  };

  const flaggedStudios = await db.all(`SELECT id, unique_id, name FROM studios WHERE needs_investigation = 1 ORDER BY name`);
  const flaggedDancers = await db.all(`SELECT id, name, unique_id FROM dancers WHERE needs_investigation = 1 ORDER BY name`);
  const allStudios = await db.all(`SELECT id, name FROM studios ORDER BY name`);

  const pendingImportReview = req.session.user.role === 'superadmin' ? readPendingReview() : null;
  res.render('admin', { flaggedStudios, flaggedDancers, allStudios, stats, pendingImportReview });
});

// ---- Weekly import review (superadmin) ----
router.get('/admin/import-review', requireSuperadmin, (req, res) => {
  const pending = readPendingReview();
  let report = null;
  if (pending && pending.reportPath && fs.existsSync(pending.reportPath)) {
    report = fs.readFileSync(pending.reportPath, 'utf8');
  }
  let pastReports = [];
  if (fs.existsSync(REPORTS_DIR)) {
    pastReports = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.startsWith('import_review_') && f.endsWith('.md'))
      .sort().reverse().slice(0, 10);
  }
  res.render('admin_import_review', { pending, report, pastReports, user: req.session.user });
});

router.get('/admin/import-review/report/:file', requireSuperadmin, (req, res) => {
  const file = path.basename(req.params.file); // no traversal
  const p = path.join(REPORTS_DIR, file);
  if (!file.startsWith('import_review_') || !file.endsWith('.md') || !fs.existsSync(p)) {
    return res.status(404).send('Not found');
  }
  res.type('text/plain').send(fs.readFileSync(p, 'utf8'));
});

router.post('/admin/import-review/promote', requireSuperadmin, (req, res) => {
  const pending = readPendingReview();
  if (!pending) return res.redirect('/admin/import-review');
  if (pending.status === 'promoting') return res.redirect('/admin/import-review');
  // Promotion replays cached pages against live and can take minutes — run
  // detached; weekly_update.js deletes PENDING_REVIEW.json on success.
  pending.status = 'promoting';
  pending.promoteStartedAt = new Date().toISOString();
  fs.writeFileSync(PENDING_REVIEW_PATH, JSON.stringify(pending, null, 1));
  const logPath = path.join(REPORTS_DIR, 'promote.log');
  const out = fs.openSync(logPath, 'a');
  const child = spawn('node', [path.join(__dirname, '..', 'scripts', 'weekly_update.js'), '--promote', ...(pending.promoteArgs || [])],
    { cwd: path.join(__dirname, '..'), detached: true, stdio: ['ignore', out, out] });
  child.unref();
  res.redirect('/admin/import-review');
});

router.post('/admin/import-review/dismiss', requireSuperadmin, (req, res) => {
  // Discard the staged import: live was never touched; next weekly run
  // re-stages from scratch. The report file is kept for the archive.
  if (fs.existsSync(PENDING_REVIEW_PATH)) fs.unlinkSync(PENDING_REVIEW_PATH);
  const staging = path.join(__dirname, '..', 'staging_import.sqlite');
  for (const s of ['', '-wal', '-shm']) if (fs.existsSync(staging + s)) fs.unlinkSync(staging + s);
  res.redirect('/admin/import-review');
});


// Admin: Marketing Studios
router.get('/admin/marketing/studios', requireAdmin, async (req, res) => {
  const db = await openDb();
  const minAwards = parseInt(req.query.min) || 15;
  const maxAwards = parseInt(req.query.max) || 0; // 0 = no cap

  // Global rank over all active studios by award count (invite copy uses it)
  const ranked = await db.all(`
    SELECT a.studio_id, COUNT(*) AS c FROM awards a
    JOIN studios st ON st.id = a.studio_id AND st.status = 'active'
    GROUP BY a.studio_id ORDER BY c DESC
  `);
  const rankMap = new Map(ranked.map((r, i) => [r.studio_id, i + 1]));

  const studios = await db.all(`
    SELECT s.id, s.unique_id, s.name, s.email, s.phone, s.is_claimed, COUNT(a.id) as award_count,
      (SELECT MAX(sent_at) FROM studio_invites si WHERE si.studio_id = s.id) AS invited_at,
      (SELECT 1 FROM email_suppressions es WHERE es.email = LOWER(TRIM(s.email))) AS suppressed
    FROM studios s
    JOIN awards a ON s.id = a.studio_id
    WHERE s.email IS NOT NULL AND s.email != '' AND s.status = 'active' AND s.is_claimed = 0
    GROUP BY s.id
    HAVING award_count >= ? ${'AND award_count <= ?'.repeat(maxAwards > 0 ? 1 : 0)}
    ORDER BY award_count DESC
  `, maxAwards > 0 ? [minAwards, maxAwards] : [minAwards]);

  studios.forEach(s2 => { s2.rank = rankMap.get(s2.id) || null; });
  res.render('admin_marketing_studios', { studios, minAwards, maxAwards, pageTitle: 'Invite Studios' });
});

// Send a studio invite (records to studio_invites; refuses repeats/unsubscribed)
router.post('/admin/marketing/studios/:id/send-invite', requireAdmin, async (req, res) => {
  try {
    const result = await sendStudioInvite(parseInt(req.params.id), { sentBy: req.session.user.id });
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error('Invite send failed:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// Inline email correction from the invite cockpit (empty clears the email)
router.post('/admin/marketing/studios/:id/update-email', requireAdmin, async (req, res) => {
  const email = (req.body.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }
  const db = await openDb();
  const studio = await db.get('SELECT id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).json({ success: false, error: 'Studio not found' });
  await db.run('UPDATE studios SET email = ? WHERE id = ?', [email || null, req.params.id]);
  res.json({ success: true, email });
});

// Inline phone correction from the invite cockpit (empty clears it)
router.post('/admin/marketing/studios/:id/update-phone', requireAdmin, async (req, res) => {
  const phone = (req.body.phone || '').trim();
  if (phone && !/^[0-9+()\-.\s]{7,30}$/.test(phone)) {
    return res.status(400).json({ success: false, error: 'Invalid phone format' });
  }
  const db = await openDb();
  const studio = await db.get('SELECT id FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).json({ success: false, error: 'Studio not found' });
  await db.run('UPDATE studios SET phone = ? WHERE id = ?', [phone || null, req.params.id]);
  res.json({ success: true, phone });
});

// Render the exact email HTML for eyeballing before sending
router.get('/admin/marketing/studios/:id/invite-preview', requireAdmin, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  const stats = await db.get('SELECT COUNT(*) AS totalAwards, SUM(CASE WHEN is_first_place = 1 THEN 1 ELSE 0 END) AS firstPlaces FROM awards WHERE studio_id = ?', [studio.id]);
  const rankRow = await db.get(`SELECT COUNT(*) + 1 AS rank FROM (
    SELECT a.studio_id, COUNT(*) AS c FROM awards a
    JOIN studios st ON st.id = a.studio_id AND st.status = 'active'
    GROUP BY a.studio_id HAVING c > ?)`, [stats.totalAwards]);
  const { subject, html } = buildStudioInvite({ studio, totalAwards: stats.totalAwards || 0, firstPlaces: stats.firstPlaces || 0, rank: rankRow.rank });
  res.send(`<div style="background:#f4f4f4;padding:16px;font-family:Arial;">Subject: <strong>${subject}</strong></div>` + html);
});


// Ensure org_invites/org_claim_tokens exist even if `node database.js`
// hasn't been re-run (same defensive pattern as /admin/settings).
const { ensureOrgInviteTables } = require('../utils/invites');

// Admin: Manage Orgs
router.get('/admin/orgs', requireAdmin, async (req, res) => {
  const db = await openDb();
  await ensureOrgInviteTables(db);
  const orgs = await db.all(`
    SELECT o.*, COUNT(e.id) as event_count,
      (SELECT u.email FROM users u WHERE u.id = o.owner_id) AS owner_email,
      (SELECT MAX(oi.sent_at) FROM org_invites oi WHERE oi.org_id = o.id) AS last_invited_at
    FROM organizations o
    LEFT JOIN events e ON o.id = e.org_id
    GROUP BY o.id
    ORDER BY o.name ASC
  `);
  // Logo pipeline state per org: uploaded logos are hidden from public cards
  // until a superadmin fits + approves them on /manage/org/:id/branding.
  for (const o of orgs) {
    let ci = {};
    try { ci = JSON.parse(o.custom_icons || '{}'); } catch (e) { }
    o.logo_state = !o.logo_url ? 'none' : (ci.logo_approved ? 'live' : 'pending');
  }

  // Homepage org-card demand telemetry (cards are deliberately unlinked;
  // clicks are outreach ammunition — "X% of visitors tried to open your
  // page"). Tables may not exist before the first migrate.
  let impressions = { last30: 0, all_time: 0 };
  try {
    const clickRows = await db.all(`
      SELECT org_id, COUNT(*) AS total,
             SUM(CASE WHEN clicked_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS last30
      FROM org_card_clicks GROUP BY org_id
    `);
    const clickMap = {};
    clickRows.forEach(r => { clickMap[r.org_id] = r; });
    for (const o of orgs) {
      o.card_clicks = clickMap[o.id] ? clickMap[o.id].total : 0;
      o.card_clicks_30d = clickMap[o.id] ? clickMap[o.id].last30 : 0;
    }
    const imp = await db.get(`
      SELECT COALESCE(SUM(count), 0) AS all_time,
             COALESCE(SUM(CASE WHEN day >= date('now', '-30 days') THEN count ELSE 0 END), 0) AS last30
      FROM daily_counters WHERE key = 'dance_home_views'
    `);
    if (imp) impressions = imp;
  } catch (e) {
    for (const o of orgs) { o.card_clicks = 0; o.card_clicks_30d = 0; }
  }

  res.render('admin_orgs', { orgs, impressions, user: req.session.user });
});


// Organizer-objection accommodation: superadmin sets org visibility
// (public / unlisted / hidden — see org_invite_draft.md "objection
// response" for the strategy and database.js for state semantics).
router.post('/admin/orgs/:id/visibility', requireSuperadmin, express.json(), async (req, res) => {
  const { visibility, note } = req.body || {};
  if (!['public', 'unlisted', 'hidden'].includes(visibility)) return res.status(400).json({ error: 'Bad visibility value' });
  const db = await openDb();
  try { await db.exec("ALTER TABLE organizations ADD COLUMN visibility TEXT DEFAULT 'public'"); } catch (e) { }
  try { await db.exec("ALTER TABLE organizations ADD COLUMN visibility_note TEXT"); } catch (e) { }
  const org = await db.get('SELECT id FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  await db.run('UPDATE organizations SET visibility = ?, visibility_note = ? WHERE id = ?',
    [visibility, (note || '').trim() || null, req.params.id]);
  refresh('dance-home'); // homepage circuit cards react immediately
  res.json({ ok: true });
});

// Events-directory analytics: what actually converts on /dance/events —
// register clicks per listing with the gold-vs-standard split (was_gold is
// snapshotted at click time, so the comparison reflects what visitors saw),
// shortlist saves, page views, and calendar exports. The gold numbers are
// the evidence base when gold buttons go paid (see organizer FAQ).
router.get('/admin/events-analytics', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  // Defensive create so the page works before the next migrate runs.
  await db.run(`CREATE TABLE IF NOT EXISTS event_reg_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upcoming_event_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    was_gold INTEGER NOT NULL DEFAULT 0,
    link_type TEXT NOT NULL DEFAULT 'register',
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const events = await db.all(`
    SELECT ue.id, ue.name, ue.city, ue.state, ue.start_date, ue.end_date, ue.gold,
           o.name AS org_name, COALESCE(o.is_sponsor, 0) AS org_sponsored,
           COALESCE(c.total, 0) AS clicks, COALESCE(c.last30, 0) AS clicks_30d,
           COALESCE(c.gold_clicks, 0) AS gold_clicks,
           COALESCE(c.site_clicks, 0) AS site_clicks,
           COALESCE(s.saves, 0) AS saves
    FROM org_upcoming_events ue
    JOIN organizations o ON o.id = ue.org_id
    LEFT JOIN (
      SELECT upcoming_event_id,
             COUNT(*) AS total,
             SUM(CASE WHEN clicked_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS last30,
             SUM(was_gold) AS gold_clicks,
             SUM(CASE WHEN link_type = 'site' THEN 1 ELSE 0 END) AS site_clicks
      FROM event_reg_clicks GROUP BY upcoming_event_id
    ) c ON c.upcoming_event_id = ue.id
    LEFT JOIN (
      SELECT upcoming_event_id, COUNT(*) AS saves
      FROM event_shortlists GROUP BY upcoming_event_id
    ) s ON s.upcoming_event_id = ue.id
    WHERE ue.status = 'active'
    ORDER BY c.total DESC, s.saves DESC, ue.start_date ASC
  `);

  const totals = await db.get(`
    SELECT COUNT(*) AS clicks,
           SUM(CASE WHEN clicked_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS clicks_30d,
           COALESCE(SUM(was_gold), 0) AS gold_clicks,
           COALESCE(SUM(CASE WHEN was_gold = 1 AND clicked_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END), 0) AS gold_clicks_30d
    FROM event_reg_clicks`);

  const counters = {};
  for (const key of ['upcoming_events_views', 'upcoming_events_ics_exports']) {
    counters[key] = await db.get(`
      SELECT COALESCE(SUM(count), 0) AS all_time,
             COALESCE(SUM(CASE WHEN day >= date('now', '-30 days') THEN count ELSE 0 END), 0) AS last30
      FROM daily_counters WHERE key = ?`, [key]);
  }

  // Per-listing fairness context: raw gold clicks mean little without
  // knowing how many gold vs standard listings are competing for them.
  const listings = await db.get(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN gold IS NOT NULL THEN 1 ELSE 0 END), 0) AS gold
    FROM org_upcoming_events
    WHERE status = 'active' AND COALESCE(end_date, start_date) >= date('now')`);

  const savesTotal = await db.get('SELECT COUNT(*) AS n FROM event_shortlists');

  res.render('admin_events_analytics', {
    events, totals, counters, listings,
    savesTotal: savesTotal.n,
    user: req.session.user
  });
});

// First revenue stream: partner organizers' Register buttons render in
// featured gold on /dance/events and their org page (default is the
// ghost style). Emphasis only — sorting stays neutral by design.
router.post('/admin/orgs/:id/sponsor', requireSuperadmin, express.json(), async (req, res) => {
  const on = req.body && req.body.sponsor === true;
  const db = await openDb();
  try { await db.exec("ALTER TABLE organizations ADD COLUMN is_sponsor INTEGER DEFAULT 0"); } catch (e) { }
  const org = await db.get('SELECT id FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  await db.run('UPDATE organizations SET is_sponsor = ? WHERE id = ?', [on ? 1 : 0, req.params.id]);
  res.json({ ok: true, sponsor: on });
});

// ---- Award vocabulary batch editor (superadmin) ----
// The scraped data mixes real awards ("National Grand Champion", titles)
// with adjudication levels ("Diamond") and size categories ("Grand Lines")
// in award_type/category. This surface lets a superadmin batch-rename
// values per org or per event, and mark which values are the org's
// genuinely TOP awards (awards.is_top_award — the hook for marquee picks
// and future top-honor surfaces).

async function ensureTopAwardColumn(db) {
  try { await db.exec("ALTER TABLE awards ADD COLUMN is_top_award INTEGER DEFAULT 0"); } catch (e) { /* exists */ }
}

const VOCAB_FIELDS = ['award_type', 'category'];

router.get('/admin/orgs/:id/award-vocab', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  await ensureTopAwardColumn(db);
  const org = await db.get('SELECT id, name, slug FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).send('Organization not found');

  const events = await db.all(`
    SELECT e.id, e.name, e.year, COUNT(a.id) AS award_count
    FROM events e LEFT JOIN awards a ON a.event_id = e.id
    WHERE e.org_id = ?
    GROUP BY e.id
    ORDER BY CAST(e.year AS INTEGER) DESC, e.name ASC
  `, [org.id]);

  const eventId = parseInt(req.query.event_id, 10) || null;
  const scopeWhere = eventId ? 'e.org_id = ? AND a.event_id = ?' : 'e.org_id = ?';
  const scopeArgs = eventId ? [org.id, eventId] : [org.id];

  const vocab = {};
  for (const field of VOCAB_FIELDS) {
    vocab[field] = await db.all(`
      SELECT COALESCE(NULLIF(TRIM(a.${field}), ''), '(blank)') AS value,
             COUNT(*) AS count,
             SUM(COALESCE(a.is_top_award, 0)) AS top_count
      FROM awards a JOIN events e ON a.event_id = e.id
      WHERE ${scopeWhere}
      GROUP BY value
      ORDER BY count DESC
    `, scopeArgs);
  }

  res.render('admin_award_vocab', {
    org, events, eventId,
    types: vocab.award_type, categories: vocab.category,
    user: req.session.user,
    pageTitle: `Award Vocabulary — ${org.name}`
  });
});

// Batch ops share the matcher: rows of this org (optionally one event)
// whose field value matches. '(blank)' targets NULL/empty values.
function vocabMatchSql(field, eventId) {
  return `
    id IN (
      SELECT a.id FROM awards a JOIN events e ON a.event_id = e.id
      WHERE e.org_id = ? ${eventId ? 'AND a.event_id = ?' : ''}
        AND COALESCE(NULLIF(TRIM(a.${field}), ''), '(blank)') = ?
    )`;
}

router.post('/admin/orgs/:id/award-vocab/rename', requireSuperadmin, express.json(), async (req, res) => {
  const { field, from, to } = req.body || {};
  const eventId = parseInt(req.body && req.body.event_id, 10) || null;
  if (!VOCAB_FIELDS.includes(field)) return res.status(400).json({ error: 'Bad field' });
  if (!from || typeof to !== 'string' || !to.trim()) return res.status(400).json({ error: 'Both current and new value are required' });
  const db = await openDb();
  const org = await db.get('SELECT id FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const args = eventId ? [org.id, eventId, from] : [org.id, from];
  const result = await db.run(
    `UPDATE awards SET ${field} = ? WHERE ${vocabMatchSql(field, eventId)}`,
    [to.trim(), ...args]);
  res.json({ ok: true, changed: result.changes });
});

router.post('/admin/orgs/:id/award-vocab/top', requireSuperadmin, express.json(), async (req, res) => {
  const { field, value } = req.body || {};
  const set = req.body && req.body.set ? 1 : 0;
  const eventId = parseInt(req.body && req.body.event_id, 10) || null;
  if (!VOCAB_FIELDS.includes(field)) return res.status(400).json({ error: 'Bad field' });
  if (!value) return res.status(400).json({ error: 'Value is required' });
  const db = await openDb();
  await ensureTopAwardColumn(db);
  const org = await db.get('SELECT id FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const args = eventId ? [org.id, eventId, value] : [org.id, value];
  const result = await db.run(
    `UPDATE awards SET is_top_award = ? WHERE ${vocabMatchSql(field, eventId)}`,
    [set, ...args]);
  res.json({ ok: true, changed: result.changes });
});

// ---- Organizer invitation letters (superadmin) ----
// Prefill for the compose modal: the letter template personalized with the
// org's live stats, plus the last send (if any) so the admin sees a resend
// warning and gets the previous address prefilled.
router.get('/admin/orgs/:id/invite-template', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (org.owner_id) return res.status(400).json({ error: 'Organization already claimed' });

  const ev = await db.get('SELECT COUNT(*) AS c FROM events WHERE org_id = ?', [org.id]);
  const aw = await db.get('SELECT COUNT(*) AS c FROM awards a JOIN events e ON a.event_id = e.id WHERE e.org_id = ?', [org.id]);
  const lastInvite = await db.get(
    'SELECT email, sent_at FROM org_invites WHERE org_id = ? ORDER BY sent_at DESC, id DESC LIMIT 1', [org.id]);

  const totals = {
    awards: (await db.get('SELECT COUNT(*) c FROM awards')).c,
    events: (await db.get('SELECT COUNT(*) c FROM events')).c,
    orgs: (await db.get('SELECT COUNT(*) c FROM organizations WHERE slug IS NOT NULL')).c,
  };
  const { subject, body } = buildOrgInviteTemplate({ org, eventCount: ev.c, awardCount: aw.c, totals });
  res.json({ orgName: org.name, subject, body, lastInvite: lastInvite || null });
});

router.post('/admin/orgs/:id/invite', requireSuperadmin, express.json(), async (req, res) => {
  try {
    const { email, subject, body } = req.body || {};
    const db = await openDb();
    await ensureOrgInviteTables(db);
    const result = await sendOrgInvite(parseInt(req.params.id), {
      email, subject, body, sentBy: req.session.user.id
    });
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error('Org invite send failed:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// Archive of every letter sent, exactly as it went out.
router.get('/admin/org-invites', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  await ensureOrgInviteTables(db);
  const invites = await db.all(`
    SELECT oi.*, o.name AS org_name, o.owner_id AS org_owner_id, u.email AS sent_by_email,
      t.used_at AS claim_used_at, t.expires_at AS claim_expires_at
    FROM org_invites oi
    JOIN organizations o ON oi.org_id = o.id
    LEFT JOIN users u ON oi.sent_by = u.id
    LEFT JOIN org_claim_tokens t ON t.invite_id = oi.id
    ORDER BY oi.sent_at DESC, oi.id DESC
  `);
  res.render('admin_org_invites', { invites, user: req.session.user });
});


router.post('/admin/orgs', requireAdmin, async (req, res) => {
  const db = await openDb();
  const { name, slug, website } = req.body;

  if (!name || !slug) return res.status(400).send('Name and Slug are required');

  try {
    await db.run('INSERT INTO organizations (name, slug, website) VALUES (?, ?, ?)', [name.trim(), slug.trim(), website ? website.trim() : null]);
    res.redirect('/admin/orgs');
  } catch (e) {
    res.status(400).send('Error creating organization. Slug or Name might already exist.');
  }
});


router.post('/admin/orgs/:id/edit', requireAdmin, async (req, res) => {
  const db = await openDb();
  const { name, slug, website } = req.body;

  if (!name || !slug) return res.status(400).send('Name and Slug are required');

  try {
    await db.run('UPDATE organizations SET name = ?, slug = ?, website = ? WHERE id = ?', [name.trim(), slug.trim(), website ? website.trim() : null, req.params.id]);
    res.redirect('/admin/orgs');
  } catch (e) {
    res.status(400).send('Error updating organization. Slug or Name might already exist.');
  }
});


router.post('/admin/orgs/:id/delete', requireAdmin, async (req, res) => {
  const db = await openDb();
  try {
    // Also delete any orphaned events/awards if necessary, or just rely on CASCADE if set up.
    // Given the user said "some times duplicates got accidentally added", they probably don't have events.
    // But to be safe, let's delete the organization.
    await db.run('DELETE FROM organizations WHERE id = ?', [req.params.id]);
    res.redirect('/admin/orgs');
  } catch (e) {
    res.status(500).send('Error deleting organization. Ensure no events are tied to it before deleting.');
  }
});


// Rogue-studio containment (layer 2): freeze revokes ownership + hides the
// studio from active-only surfaces, and RELEASES exactly what the owner
// created (source='studio_owner' links) — families' own dancer_claim links
// and imported history are untouched. Tombstones block auto-backfill re-adds.
router.post('/api/admin/studio/:id/freeze-release', requireSuperadmin, express.json(), async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).json({ error: 'Studio not found' });

  const ownerLinks = await db.all(`
    SELECT ad.id, ad.award_id, ad.dancer_id FROM award_dancers ad
    JOIN awards a ON a.id = ad.award_id
    WHERE a.studio_id = ? AND ad.source = 'studio_owner'`, [req.params.id]);
  for (const l of ownerLinks) {
    await db.run("INSERT OR REPLACE INTO award_dancer_removals (award_id, dancer_id, source) VALUES (?, ?, 'admin_freeze')",
      [l.award_id, l.dancer_id]).catch(() => {});
    await db.run('DELETE FROM award_dancers WHERE id = ?', [l.id]);
  }
  const roster = await db.run("DELETE FROM dancer_studios WHERE studio_id = ? AND source = 'studio_owner'", [req.params.id]);

  await db.run(`UPDATE studios SET status = 'frozen', frozen_at = CURRENT_TIMESTAMP,
    frozen_prev_owner_id = owner_id, owner_id = NULL, is_claimed = 0 WHERE id = ?`, [req.params.id]);
  res.json({ success: true, awardLinksReleased: ownerLinks.length, rosterLinksReleased: roster.changes });
});

// Unfreeze restores public visibility only — ownership is NOT auto-restored
// (re-claiming goes through the normal verified flow).
router.post('/api/admin/studio/:id/unfreeze', requireSuperadmin, express.json(), async (req, res) => {
  const db = await openDb();
  await db.run("UPDATE studios SET status = 'active' WHERE id = ? AND status = 'frozen'", [req.params.id]);
  res.json({ success: true });
});

router.get('/admin/studios', requireAdmin, async (req, res) => {
  const db = await openDb();

  const page = parseInt(req.query.page) || 1;
  const search = req.query.search || '';
  const limit = 50;
  const offset = (page - 1) * limit;

  let whereClause = '';
  let queryParams = [];

  if (search) {
    whereClause = 'WHERE s.name LIKE ?';
    queryParams.push(`%${search}%`);
  }

  const countRow = await db.get(`SELECT COUNT(*) as count FROM studios s ${whereClause}`, queryParams);
  const totalStudios = countRow.count;
  const totalPages = Math.ceil(totalStudios / limit);

  const queryParams2 = [...queryParams, limit, offset];

  const studios = await db.all(`
    SELECT s.*, 
           COUNT(DISTINCT a.id) as total_awards,
           COUNT(DISTINCT a.event_id) as total_events
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    ${whereClause}
    GROUP BY s.id
    ORDER BY s.name ASC
    LIMIT ? OFFSET ?
  `, queryParams2);

  res.render('admin_studios', { studios, currentPage: page, totalPages, search });
});


router.get('/admin/claims', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claims = await db.all(`
    SELECT sc.*, u.email as user_email, s.name as studio_name, s.unique_id as studio_uid
    FROM studio_claims sc
    JOIN users u ON sc.user_id = u.id
    JOIN studios s ON sc.studio_id = s.id
    WHERE sc.status = 'pending'
    ORDER BY sc.created_at DESC
  `);

  const dancerClaims = await db.all(`
    SELECT dc.*, u.email as user_email, d.name as dancer_name, d.unique_id as dancer_unique_id,
           s.name as code_studio_name
    FROM dancer_claims dc
    JOIN users u ON dc.user_id = u.id
    JOIN dancers d ON dc.dancer_id = d.id
    LEFT JOIN studios s ON dc.studio_id = s.id
    WHERE dc.status = 'pending'
    ORDER BY dc.code_valid DESC, dc.created_at DESC
  `);

  res.render('admin_claims', { claims, dancerClaims });
});


// Recompute the auto-featured studio rotation on demand (also runs nightly)
router.post('/admin/featured/recompute', requireSuperadmin, async (req, res) => {
  try {
    const result = await computeFeaturedStudios();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Featured recompute failed:', err);
    res.status(500).json({ error: 'Recompute failed' });
  }
});

router.post('/admin/claims/:id/approve', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claim = await db.get('SELECT * FROM studio_claims WHERE id = ?', [req.params.id]);
  if (!claim) return res.status(404).send('Claim not found');

  await db.run('UPDATE studios SET is_claimed = 1, owner_id = ? WHERE id = ?', [claim.user_id, claim.studio_id]);
  await db.run('UPDATE studio_claims SET status = "approved" WHERE id = ?', [claim.id]);
  await db.run('UPDATE users SET role = "studio_owner" WHERE id = ? AND role = "user"', [claim.user_id]);
  logStudioActivity(claim.studio_id, 'claim_approved');

  res.redirect('/admin/claims');
});


router.post('/admin/claims/:id/reject', requireAdmin, async (req, res) => {
  const db = await openDb();
  await db.run('UPDATE studio_claims SET status = "rejected" WHERE id = ?', [req.params.id]);
  res.redirect('/admin/claims');
});


// Dancer Claims logic — shared with the studio-director route
// (utils/claims.js): approval also settles competing pending claims, and
// both decisions email the claimant.
router.post('/admin/claims/dancer/:id/approve', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claim = await db.get("SELECT * FROM dancer_claims WHERE id = ? AND status = 'pending'", [req.params.id]);
  if (!claim) return res.status(404).send('Claim not found');

  await approveDancerClaim(db, claim);
  res.redirect('/admin/claims');
});


router.post('/admin/claims/dancer/:id/reject', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claim = await db.get("SELECT id FROM dancer_claims WHERE id = ? AND status = 'pending'", [req.params.id]);
  if (claim) await rejectDancerClaim(db, claim.id);
  res.redirect('/admin/claims');
});


// Admin Studio Drafts (Bootstrapped Info)
router.get('/admin/studio-drafts', requireAdmin, async (req, res) => {
  const db = await openDb();
  const drafts = await db.all(`
    SELECT d.*, s.unique_id as studio_uid, s.name as current_name, s.address as current_address, s.phone as current_phone, s.email as current_email, s.website_url as current_website_url
    FROM studio_info_drafts d
    JOIN studios s ON d.studio_id = s.id
    WHERE d.status = 'pending'
    ORDER BY d.created_at DESC
  `);
  res.render('admin_studio_drafts', { drafts });
});


router.post('/admin/studio-drafts/:id/approve', requireAdmin, async (req, res) => {
  const db = await openDb();
  const draft = await db.get('SELECT * FROM studio_info_drafts WHERE id = ? AND status = "pending"', [req.params.id]);
  if (!draft) return res.status(404).send('Draft not found or already processed');

  // We allow admins to modify the drafted data before saving, so read from req.body
  const { website_url, email, phone, address } = req.body;

  // Update studio with the (potentially modified) scraped data. Only override if field was provided in the form.
  await db.run(`
    UPDATE studios 
    SET 
      website_url = COALESCE(NULLIF(?, ''), website_url),
      email = COALESCE(NULLIF(?, ''), email),
      phone = COALESCE(NULLIF(?, ''), phone),
      address = COALESCE(NULLIF(?, ''), address)
    WHERE id = ?
  `, [website_url, email, phone, address, draft.studio_id]);

  await db.run('UPDATE studio_info_drafts SET status = "approved" WHERE id = ?', [req.params.id]);

  res.redirect('/admin/studio-drafts');
});


router.post('/admin/studio-drafts/:id/reject', requireAdmin, async (req, res) => {
  const db = await openDb();
  await db.run('UPDATE studio_info_drafts SET status = "rejected" WHERE id = ?', [req.params.id]);
  res.redirect('/admin/studio-drafts');
});


// ---- Reviewer management (superadmin) ----
// Who receives review notification emails: weekly-import holds
// (scripts/weekly_update.js) and organizer results uploads
// (routes/dance/orgs.js). While the list is empty, utils/reviewers.js
// falls back to REVIEW_EMAIL then SUPERADMIN_EMAIL from the environment.
router.get('/admin/reviewers', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  // Same defensive pattern as /admin/settings, in case initDb wasn't re-run
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reviewers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      added_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const reviewers = await db.all(`
    SELECT r.*, u.email AS added_by_email
    FROM reviewers r LEFT JOIN users u ON r.added_by = u.id
    ORDER BY r.created_at, r.id
  `);
  const envFallback = process.env.REVIEW_EMAIL || process.env.SUPERADMIN_EMAIL || null;
  res.render('admin_reviewers', { reviewers, envFallback, user: req.session.user });
});

router.post('/admin/reviewers/add', requireSuperadmin, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const name = (req.body.name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).send('Invalid email format');
  }
  const db = await openDb();
  await db.run('INSERT OR IGNORE INTO reviewers (email, name, added_by) VALUES (?, ?, ?)',
    [email, name || null, req.session.user.id]);
  res.redirect('/admin/reviewers');
});

router.post('/admin/reviewers/:id/delete', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  await db.run('DELETE FROM reviewers WHERE id = ?', [req.params.id]);
  res.redirect('/admin/reviewers');
});


// Superadmin User Management
router.get('/admin/users', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const users = await db.all('SELECT id, email, role, is_verified, created_at FROM users ORDER BY created_at DESC');
  res.render('admin_users', { users });
});


router.post('/admin/users/add', requireSuperadmin, async (req, res) => {
  const { email, password, role, is_verified } = req.body;
  const db = await openDb();

  if (!email || !password || !role) {
    return res.status(400).send('Email, password, and role are required');
  }

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    return res.status(400).send('User with this email already exists');
  }

  const hash = await bcrypt.hash(password, 10);
  const isVerifiedInt = is_verified === 'on' ? 1 : 0;

  await db.run(
    'INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, ?)',
    [email, hash, role, isVerifiedInt]
  );

  res.redirect('/admin/users');
});


router.post('/admin/users/:id/toggle-role', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const targetUser = await db.get('SELECT id, role FROM users WHERE id = ?', [req.params.id]);

  if (!targetUser) return res.status(404).send('User not found');
  if (targetUser.role === 'superadmin') return res.status(400).send('Cannot modify superadmin role');

  const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
  await db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, targetUser.id]);

  res.redirect('/admin/users');
});


router.get('/admin/duplicates', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const studios = await db.all("SELECT id, name FROM studios WHERE status = 'active' ORDER BY LOWER(name)");

  const groupedDuplicates = [];
  let currentGroup = null;

  for (let i = 0; i < studios.length - 1; i++) {
    const s1 = studios[i];
    const s2 = studios[i + 1];
    const n1 = s1.name.toLowerCase();
    const n2 = s2.name.toLowerCase();

    if (n2.startsWith(n1) && n1.length > 5) {
      if (!currentGroup) {
        currentGroup = { base: s1, matches: [s2] };
      } else {
        if (n2.startsWith(currentGroup.base.name.toLowerCase())) {
          currentGroup.matches.push(s2);
        } else {
          groupedDuplicates.push(currentGroup);
          currentGroup = { base: s1, matches: [s2] };
        }
      }
    } else {
      if (currentGroup) {
        groupedDuplicates.push(currentGroup);
        currentGroup = null;
      }
    }
  }
  if (currentGroup) groupedDuplicates.push(currentGroup);

  res.render('admin_duplicates', {
    totalStudios: studios.length,
    duplicateGroupsCount: groupedDuplicates.length,
    groupedDuplicates
  });
});


router.get('/admin/compare/studios', requireAdmin, async (req, res) => {
  const db = await openDb();
  const { id1, id2 } = req.query;

  const allStudios = await db.all(`SELECT id, name FROM studios ORDER BY name`);

  let s1 = null, s2 = null;
  let s1Events = [], s2Events = [];
  let s1Dancers = [], s2Dancers = [];

  if (id1) {
    s1 = await db.get(`SELECT * FROM studios WHERE id = ?`, [id1]);
    if (s1) {
      s1Events = await db.all(`
        SELECT DISTINCT e.name, e.year, o.name as org_name 
        FROM awards a
        JOIN events e ON a.event_id = e.id
        JOIN organizations o ON e.org_id = o.id
        WHERE a.studio_id = ?
        ORDER BY e.year DESC, e.name ASC
      `, [id1]);

      s1Dancers = await db.all(`
        SELECT d.name, COUNT(a.id) as award_count
        FROM awards a
        JOIN dancers d ON a.dancer_id = d.id
        WHERE a.studio_id = ?
        GROUP BY d.id
        ORDER BY award_count DESC
        LIMIT 10
      `, [id1]);
    }
  }

  if (id2) {
    s2 = await db.get(`SELECT * FROM studios WHERE id = ?`, [id2]);
    if (s2) {
      s2Events = await db.all(`
        SELECT DISTINCT e.name, e.year, o.name as org_name 
        FROM awards a
        JOIN events e ON a.event_id = e.id
        JOIN organizations o ON e.org_id = o.id
        WHERE a.studio_id = ?
        ORDER BY e.year DESC, e.name ASC
      `, [id2]);

      s2Dancers = await db.all(`
        SELECT d.name, COUNT(a.id) as award_count
        FROM awards a
        JOIN dancers d ON a.dancer_id = d.id
        WHERE a.studio_id = ?
        GROUP BY d.id
        ORDER BY award_count DESC
        LIMIT 10
      `, [id2]);
    }
  }

  res.render('compare_studios', { allStudios, id1, id2, s1, s2, s1Events, s2Events, s1Dancers, s2Dancers });
});


router.post('/api/merge/studios', requireAdmin, express.json(), async (req, res) => {
  const db = await openDb();
  const { sourceId, targetId } = req.body;
  if (!sourceId || !targetId || sourceId === targetId) return res.status(400).json({ error: "Invalid IDs" });

  try {
    await db.run('BEGIN TRANSACTION');

    // Update awards with traceability
    await db.run(`UPDATE awards SET studio_id = ?, merged_from_studio_id = ? WHERE studio_id = ?`, [targetId, sourceId, sourceId]);

    // Transfer dancer associations
    const links = await db.all(`SELECT dancer_id FROM dancer_studios WHERE studio_id = ?`, [sourceId]);
    for (const link of links) {
      const exists = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, targetId]);
      if (!exists) {
        await db.run(`UPDATE dancer_studios SET studio_id = ? WHERE dancer_id = ? AND studio_id = ?`, [targetId, link.dancer_id, sourceId]);
      } else {
        await db.run(`DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, sourceId]);
      }
    }

    // Mark source studio as merged, do NOT delete it
    await db.run(`UPDATE studios SET status = 'merged', merged_into_id = ? WHERE id = ?`, [targetId, sourceId]);

    await db.run('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await db.run('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});


router.post('/api/reject-merge/studios', requireAdmin, express.json(), async (req, res) => {
  const db = await openDb();
  const { sourceId, targetId } = req.body;
  if (!sourceId || !targetId) return res.status(400).json({ error: "Invalid IDs" });

  try {
    const studio = await db.get('SELECT rejected_merges FROM studios WHERE id = ?', [targetId]);
    let rejected = studio.rejected_merges ? studio.rejected_merges.split(',') : [];
    if (!rejected.includes(sourceId.toString())) {
      rejected.push(sourceId.toString());
      await db.run('UPDATE studios SET rejected_merges = ? WHERE id = ?', [rejected.join(','), targetId]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.post('/api/merge/dancers', requireAdmin, express.json(), async (req, res) => {
  const db = await openDb();
  const { sourceId, targetId } = req.body;
  if (!sourceId || !targetId || sourceId === targetId) return res.status(400).json({ error: "Invalid IDs" });

  try {
    await db.run(`UPDATE awards SET dancer_id = ? WHERE dancer_id = ?`, [targetId, sourceId]);
    const links = await db.all(`SELECT studio_id FROM dancer_studios WHERE dancer_id = ?`, [sourceId]);
    for (const link of links) {
      const exists = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [targetId, link.studio_id]);
      if (!exists) {
        await db.run(`UPDATE dancer_studios SET dancer_id = ? WHERE dancer_id = ? AND studio_id = ?`, [targetId, sourceId, link.studio_id]);
      } else {
        await db.run(`DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [sourceId, link.studio_id]);
      }
    }
    await db.run(`DELETE FROM dancers WHERE id = ?`, [sourceId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET organization categories dashboard (Superadmin only)
router.get('/admin/org/:slug/categories', async (req, res) => {
  if (!req.session || !req.session.user || req.session.user.role !== 'superadmin') {
    return res.status(403).send('Forbidden');
  }

  const db = await openDb();
  const org = await db.get('SELECT * FROM organizations WHERE slug = ?', [req.params.slug]);
  if (!org) return res.status(404).send('Organization not found');

  const sortBy = req.query.sort === 'award_type' ? 'a.award_type ASC, a.place ASC' : 'a.place ASC, a.category ASC';

  // marked vs award_count drives the tri-state checkbox: a combo can be
  // fully marked, unmarked, or PARTIAL (e.g. an import or category repair
  // added rows after the combo was toggled, or an event-level toggle
  // diverged). MAX alone hid partials and made a single marked award look
  // like an org-wide setting.
  const categories = await db.all(`
    SELECT
      a.category,
      a.award_type,
      a.place,
      MAX(a.is_first_place) as is_first_place,
      SUM(a.is_first_place) as marked,
      COUNT(*) as award_count
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ?
    GROUP BY a.category, a.award_type, a.place
    ORDER BY ${sortBy}
  `, [org.id]);

  res.render('admin_org_categories', {
    org,
    categories,
    user: req.session.user,
    currentSort: req.query.sort || 'place'
  });
});


// POST toggle first place status via AJAX
router.post('/api/admin/org/:orgId/categories/toggle', express.json(), async (req, res) => {
  if (!req.session || !req.session.user || req.session.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { orgId } = req.params;
  const { category, award_type, place, is_first_place } = req.body;
  const newStatus = is_first_place ? 1 : 0;

  const db = await openDb();

  try {
    const result = await db.run(`
      UPDATE awards 
      SET is_first_place = ? 
      WHERE event_id IN (SELECT id FROM events WHERE org_id = ?) 
        AND category IS ? 
        AND award_type IS ? 
        AND place IS ?
    `, [newStatus, orgId, category || null, award_type || null, place || null]);

    // Persist the decision as an org-level rule so imports can re-apply it
    // to new events (applyOrgFirstPlaceRules). NULLs stored as '' to keep
    // the primary key unique.
    await db.run(`
      INSERT INTO org_first_place_rules (org_id, category, award_type, place, is_first_place, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(org_id, category, award_type, place)
      DO UPDATE SET is_first_place = excluded.is_first_place, updated_at = CURRENT_TIMESTAMP
    `, [orgId, category || '', award_type || '', place || '', newStatus]);

    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('Error toggling is_first_place:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ---- First-place audit (next.md #1) ----
// The leaderboard "1st places" stat is awards.is_first_place, set by
// scripts/mark_first_places.js from place strings + category exclusions,
// then hand-corrected. These pages surface, per event, every distinct
// place/type/category combo with two suspicion heuristics kept in sync
// with the normalizer:
//   missing — place looks like a competitive 1st (and category isn't a
//             special award) but the combo isn't counted;
//   odd     — counted as a 1st although the place string doesn't look
//             like one (usually a manual toggle worth double-checking).
const { FIRSTISH_SQL, NOT_EXCLUDED_SQL } = require('../utils/first_place');

router.get('/admin/first-places', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const events = await db.all(`
    SELECT e.id, e.name, e.year, o.name AS org_name, o.slug AS org_slug,
      COUNT(*) AS total_awards,
      SUM(a.is_first_place) AS first_places,
      SUM(CASE WHEN ${FIRSTISH_SQL} AND ${NOT_EXCLUDED_SQL} AND a.is_first_place = 0 THEN 1 ELSE 0 END) AS missing_firsts,
      SUM(CASE WHEN NOT (${FIRSTISH_SQL}) AND a.is_first_place = 1 THEN 1 ELSE 0 END) AS odd_firsts
    FROM awards a
    JOIN events e ON e.id = a.event_id
    LEFT JOIN organizations o ON o.id = e.org_id
    GROUP BY e.id
    ORDER BY (o.name IS NULL), o.name, CAST(e.year AS INTEGER) DESC, e.name
  `);
  res.render('admin_first_places', { events, user: req.session.user });
});

router.get('/admin/event/:id/categories', requireSuperadmin, async (req, res) => {
  const db = await openDb();
  const event = await db.get(`
    SELECT e.*, o.name AS org_name, o.slug AS org_slug
    FROM events e LEFT JOIN organizations o ON o.id = e.org_id WHERE e.id = ?`, [req.params.id]);
  if (!event) return res.status(404).send('Event not found');

  const categories = await db.all(`
    SELECT a.category, a.award_type, a.place,
      MAX(a.is_first_place) AS is_first_place,
      MIN(a.is_first_place) AS min_first_place,
      COUNT(*) AS award_count,
      CASE
        WHEN ${FIRSTISH_SQL} AND ${NOT_EXCLUDED_SQL} AND MAX(a.is_first_place) = 0 THEN 'missing'
        WHEN NOT (${FIRSTISH_SQL}) AND MAX(a.is_first_place) = 1 THEN 'odd'
        ELSE ''
      END AS flag
    FROM awards a
    WHERE a.event_id = ?
    GROUP BY a.category, a.award_type, a.place
    ORDER BY (flag = ''), a.place ASC, a.category ASC
  `, [req.params.id]);

  res.render('admin_event_categories', { event, categories, user: req.session.user });
});

// Toggle scoped to ONE event (the org-level twin above updates org-wide)
router.post('/api/admin/event/:eventId/categories/toggle', requireSuperadmin, express.json(), async (req, res) => {
  const { category, award_type, place, is_first_place } = req.body || {};
  const db = await openDb();
  try {
    const result = await db.run(`
      UPDATE awards SET is_first_place = ?
      WHERE event_id = ? AND category IS ? AND award_type IS ? AND place IS ?
    `, [is_first_place ? 1 : 0, req.params.eventId, category || null, award_type || null, place || null]);
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('Error toggling is_first_place (event):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/admin/backfill-dancers/:event_id', requireAdmin, async (req, res) => {
  const db = await openDb();
  const eventId = req.params.event_id;

  try {
    const backfilledCount = await runBackfillForEvent(db, eventId);
    res.send(`<script>alert("Successfully backfilled ${backfilledCount} dancer records for this event."); window.location.href='/event/${eventId}';</script>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error running backfill");
  }
});


router.get('/admin/feedback', requireAdmin, async (req, res) => {
  try {
    const db = await openDb();
    const filter = req.query.filter || 'all';
    let query = 'SELECT f.*, u.email as user_email FROM feedback f LEFT JOIN users u ON f.user_id = u.id';
    const params = [];
    
    if (filter !== 'all') {
      query += ' WHERE f.status = ?';
      params.push(filter);
    }
    query += ' ORDER BY f.created_at DESC';
    
    const feedbackList = await db.all(query, params);
    res.render('admin_feedback', { user: req.session.user, feedbackList, filter });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


router.post('/admin/feedback/:id/status', requireAdmin, async (req, res) => {
  try {
    const db = await openDb();
    const { status } = req.body;
    await db.run('UPDATE feedback SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.post('/admin/feedback/:id/reply', requireAdmin, async (req, res) => {
  try {
    const db = await openDb();
    const { reply } = req.body;
    const feedbackId = req.params.id;
    
    // Update DB
    await db.run('UPDATE feedback SET admin_reply = ?, status = ? WHERE id = ?', [reply, 'replied', feedbackId]);
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
