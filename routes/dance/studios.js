const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { requireAuth, requireStudioOwner } = require('../../middleware/auth');
const { logStudioActivity } = require('../../utils/activity');
const { approveDancerClaim, rejectDancerClaim, notifyRosterAttach } = require('../../utils/claims');
const { ensureMergeRequestTable } = require('../../utils/studioMerge');
const { sendEmail } = require('../../utils/mailer');
const multer = require('multer');
// CSV imports only (roster + awards). Rejections surface as 400s via the
// central error handler (err.status = 400).
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const isCsv = /\.csv$/i.test(file.originalname || '') ||
      ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.mimetype);
    if (isCsv) return cb(null, true);
    const err = new Error('Only .csv files are accepted.');
    err.status = 400;
    cb(err);
  },
});
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { generateDancerId } = require('../../utils.js');
const { parse } = require('csv-parse/sync');

// Same-name studios the owner might want to merge, enriched with enough
// award context (counts, years, orgs, dancer names) for them to judge
// "is this actually my studio?" — a bare name isn't evidence; shared
// dancers are (the same rule our own dedup scripts use).
async function findPotentialDuplicates(db, studio) {
  const baseName = studio.name.split(',')[0].trim();
  const searchName = `%${baseName}%`;
  const rejectedArray = studio.rejected_merges ? studio.rejected_merges.split(',') : [];

  const similarStudios = await db.all(`
    SELECT id, unique_id, name, aka, status
    FROM studios
    WHERE (name LIKE ? OR aka LIKE ?)
      AND id != ?
      AND status != 'merged'
    LIMIT 15
  `, [searchName, searchName, studio.id]);

  const dups = similarStudios.filter(s => !rejectedArray.includes(s.id.toString()));
  for (const dup of dups) {
    const stats = await db.get(`
      SELECT COUNT(a.id) AS award_count, MIN(e.year) AS first_year, MAX(e.year) AS last_year,
             GROUP_CONCAT(DISTINCT o.name) AS org_names
      FROM awards a
      JOIN events e ON a.event_id = e.id
      JOIN organizations o ON e.org_id = o.id
      WHERE a.studio_id = ?
    `, [dup.id]);
    const dancers = await db.all(`
      SELECT d.name, COUNT(*) AS n
      FROM award_dancers ad
      JOIN dancers d ON ad.dancer_id = d.id
      JOIN awards a ON ad.award_id = a.id
      WHERE a.studio_id = ?
      GROUP BY d.id ORDER BY n DESC LIMIT 4
    `, [dup.id]);
    const dancerTotal = await db.get(`
      SELECT COUNT(DISTINCT ad.dancer_id) AS n
      FROM award_dancers ad JOIN awards a ON ad.award_id = a.id
      WHERE a.studio_id = ?
    `, [dup.id]);
    dup.award_count = stats ? stats.award_count : 0;
    dup.first_year = stats && stats.first_year;
    dup.last_year = stats && stats.last_year;
    dup.org_names = (stats && stats.org_names) ? stats.org_names.split(',') : [];
    dup.dancer_names = dancers.map(d => d.name);
    dup.dancer_total = dancerTotal ? dancerTotal.n : 0;
  }
  return dups;
}
const fs = require('fs');


router.get('/manage/studio/:id', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  let studio = req.studio;

  if (!studio.join_code) {
    const crypto = require('crypto');
    const newCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    await db.run('UPDATE studios SET join_code = ? WHERE id = ?', [newCode, studio.id]);
    studio.join_code = newCode;
  }

  await ensureMergeRequestTable(db);
  const allMergeRequests = await db.all(`
    SELECT mr.id, mr.status, mr.created_at, mr.dismissed_at, s.name AS source_name, s.unique_id AS source_uid
    FROM studio_merge_requests mr
    JOIN studios s ON mr.source_studio_id = s.id
    WHERE mr.target_studio_id = ?
    ORDER BY mr.created_at DESC
  `, [studio.id]);
  // A studio with a request on file (any status, dismissed included) leaves
  // the suggestion list: pending/approved live in the requests panel,
  // rejected shouldn't be re-asked. The dashboard panel itself shows only
  // undismissed rows — decided ones can be moved to the history page.
  const requestedIds = new Set(allMergeRequests.map(r => r.source_uid));
  const mergeRequests = allMergeRequests.filter(r => !r.dismissed_at);
  const potentialDuplicates = (await findPotentialDuplicates(db, studio))
    .filter(d => !requestedIds.has(d.unique_id));

  let prefs = {};
  if (studio.public_preferences) {
    try { prefs = JSON.parse(studio.public_preferences); } catch (e) { }
  }
  if (Object.keys(prefs).length === 0) {
    prefs = { show_total_awards: true, show_events_attended: true, show_1st_place_finishes: true, show_1st_place_this_year: true, show_past_5_years: true, show_this_year: true };
  }
  studio.prefs = prefs;

  const onboarding = await buildOnboarding(db, studio);
  res.render('manage_studio', { studio, potentialDuplicates, mergeRequests, onboarding });
});


// Owner asks us to merge a suggested duplicate into their studio. Never a
// direct write — absorbing another record's awards is the rogue-studio
// attack surface, so every request waits for admin review (see
// /admin/duplicates). The owner sees it as Pending on their dashboard.
router.post('/manage/studio/:id/merge-request', requireAuth, requireStudioOwner, express.json(), async (req, res) => {
  const db = await openDb();
  const studio = req.studio;
  const sourceId = parseInt(req.body && req.body.sourceId, 10);
  if (!sourceId || sourceId === studio.id) return res.status(400).json({ error: 'Invalid studio.' });

  const source = await db.get('SELECT id, name, status, is_claimed, owner_id FROM studios WHERE id = ?', [sourceId]);
  if (!source || source.status === 'merged') return res.status(404).json({ error: 'That studio record no longer exists.' });
  if (source.owner_id) {
    return res.status(400).json({ error: "That studio is claimed by another account, so we can't merge it automatically — email hello@awardhome.com and we'll help sort it out." });
  }

  await ensureMergeRequestTable(db);
  const existing = await db.get(
    `SELECT id, status FROM studio_merge_requests WHERE target_studio_id = ? AND source_studio_id = ? AND status = 'pending'`,
    [studio.id, sourceId]);
  if (existing) return res.json({ success: true, alreadyPending: true });

  await db.run(
    `INSERT INTO studio_merge_requests (target_studio_id, source_studio_id, requested_by) VALUES (?, ?, ?)`,
    [studio.id, sourceId, req.session.user.id]);
  logStudioActivity(studio.id, 'merge_requested');

  // Heads-up to the review inbox — fire-and-forget.
  sendEmail({
    to: 'hello@awardhome.com',
    subject: `Merge request: "${source.name}" → "${studio.name}"`,
    html: `<p>${req.session.user.email} asked to merge studio #${sourceId} ("${source.name}") into #${studio.id} ("${studio.name}").</p>
      <p>Review at ${require('../../config').BASE_URL}/admin/duplicates</p>`,
  }).catch((err) => console.error('merge-request admin email failed:', err));

  res.json({ success: true });
});


// Dismiss decided merge requests from the dashboard panel — they remain
// on the Action History page. Pending rows can't be dismissed (an open
// request should stay visible until it's decided).
router.post('/manage/studio/:id/merge-requests/dismiss', requireAuth, requireStudioOwner, express.json(), async (req, res) => {
  const db = await openDb();
  await ensureMergeRequestTable(db);
  const result = await db.run(
    `UPDATE studio_merge_requests SET dismissed_at = CURRENT_TIMESTAMP
     WHERE target_studio_id = ? AND status != 'pending' AND dismissed_at IS NULL`,
    [req.studio.id]);
  res.json({ success: true, dismissed: result.changes || 0 });
});


// Action History: the studio's full merge-request record (including
// dismissed rows) plus the activity log — the durable home for anything
// cleared off the dashboard. Lives at /activity: /history is taken by
// the Organization History page (competition breakdown by org).
const ACTIVITY_LABELS = {
  claim_approved: 'Studio claim approved',
  merge_requested: 'Merge request sent',
  verification_action: 'Award verification decided',
  award_claim: 'Award claimed onto roster',
  award_self_report: 'Award self-reported',
  awards_csv_commit: 'Awards imported from CSV',
  roster_csv_commit: 'Roster imported from CSV',
  group_cast_added: 'Dancers linked to a group routine',
  profile_update: 'Studio profile updated',
  widget_embed: 'Awards widget embedded',
  ai_summary: 'AI studio summary generated',
};
router.get('/manage/studio/:id/activity', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  await ensureMergeRequestTable(db);
  const mergeHistory = await db.all(`
    SELECT mr.status, mr.created_at, mr.decided_at, s.name AS source_name
    FROM studio_merge_requests mr
    JOIN studios s ON mr.source_studio_id = s.id
    WHERE mr.target_studio_id = ?
    ORDER BY mr.created_at DESC
  `, [req.studio.id]);
  const activity = await db.all(
    `SELECT action, created_at FROM studio_activity WHERE studio_id = ? ORDER BY created_at DESC LIMIT 200`,
    [req.studio.id]);
  for (const a of activity) a.label = ACTIVITY_LABELS[a.action] || a.action.replace(/_/g, ' ');
  res.render('manage_studio_activity', {
    studio: req.studio, mergeHistory, activity,
    pageTitle: `${req.studio.name} — Action History`,
  });
});


// Owner-side "Not My Studio": hides the suggestion for this studio only.
// (The old flow pointed at an admin-gated API, which silently 403'd.)
router.post('/manage/studio/:id/merge-reject', requireAuth, requireStudioOwner, express.json(), async (req, res) => {
  const db = await openDb();
  const studio = req.studio;
  const sourceId = parseInt(req.body && req.body.sourceId, 10);
  if (!sourceId) return res.status(400).json({ error: 'Invalid studio.' });

  const rejected = studio.rejected_merges ? studio.rejected_merges.split(',') : [];
  if (!rejected.includes(String(sourceId))) {
    rejected.push(String(sourceId));
    await db.run('UPDATE studios SET rejected_merges = ? WHERE id = ?', [rejected.join(','), studio.id]);
  }
  res.json({ success: true });
});


// Post-claim onboarding checklist: every step is auto-detected from real
// data, no manual check-off. Logo + bio double as featured-eligibility.
async function buildOnboarding(db, studio) {
  if (studio.onboarding_dismissed) return null;
  const acted = async (...actions) => !!(await db.get(
    `SELECT 1 FROM studio_activity WHERE studio_id = ? AND action IN (${actions.map(() => '?').join(',')}) LIMIT 1`,
    [studio.id, ...actions]
  ));
  const steps = [
    { key: 'claim', label: 'Claim your studio', done: true, href: null },
    { key: 'logo', label: 'Add your logo', done: !!(studio.logo_url && studio.logo_url.trim()), href: '#branding',
      hint: 'A direct image link — it appears on your public page and the homepage.' },
    { key: 'bio', label: 'Write your studio bio', done: !!(studio.bio && studio.bio.trim()), href: '#branding',
      hint: 'A few sentences about what makes your studio special.' },
    { key: 'awards', label: 'Review & add awards', done: await acted('award_self_report', 'awards_csv_commit', 'verification_action'), href: `/manage/studio/${studio.id}/awards`,
      hint: 'Check what our detectives found; add anything missing.' },
    { key: 'group_cast', label: 'Add dancers to your group routines', done: await acted('group_cast_added'), href: `/manage/studio/${studio.id}/group-dancers`,
      hint: 'Competitions rarely publish group casts — paste each routine\'s dancer list so every dancer gets their wins.' },
    { key: 'widget', label: 'Embed your trophy widget', done: await acted('widget_embed'), href: `/manage/studio/${studio.id}/widget`,
      hint: 'A live award counter for your own website.' },
    { key: 'dancers', label: 'Invite dancers with your claim code', done: await acted('award_claim'), href: '#claim-code',
      hint: 'Dancers use the code to claim their awards on their own profiles.' },
  ];
  const doneCount = steps.filter(s => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length };
}


router.post('/manage/studio/:id/onboarding/dismiss', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  await db.run('UPDATE studios SET onboarding_dismissed = 1 WHERE id = ?', [req.params.id]);
  res.redirect(`/manage/studio/${req.params.id}`);
});


router.post('/manage/studio/:id/reset-code', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();

  // Generate new 6-character code
  const crypto = require('crypto');
  const newCode = crypto.randomBytes(3).toString('hex').toUpperCase();

  await db.run('UPDATE studios SET join_code = ? WHERE id = ?', [newCode, req.params.id]);
  res.redirect(`/manage/studio/${req.params.id}`);
});


router.post('/manage/studio/:id/profile', requireAuth, requireStudioOwner, async (req, res) => {
  const { name, website_url, email, phone, logo_url, bio, instagram_handle, tiktok_handle } = req.body;
  const db = await openDb();

  const studio = req.studio;

  const prefs = {
    show_total_awards: req.body.show_total_awards === 'on',
    show_events_attended: req.body.show_events_attended === 'on',
    show_1st_place_finishes: req.body.show_1st_place_finishes === 'on',
    show_1st_place_this_year: req.body.show_1st_place_this_year === 'on',
    show_past_5_years: req.body.show_past_5_years === 'on',
    show_this_year: req.body.show_this_year === 'on',
    show_org_history: req.body.show_org_history === 'on'
  };

  await db.run(`
    UPDATE studios 
    SET name = ?, website_url = ?, email = ?, phone = ?, logo_url = ?, bio = ?, instagram_handle = ?, tiktok_handle = ?, public_preferences = ?
    WHERE id = ?
  `, [name, website_url, email, phone, logo_url, bio, instagram_handle, tiktok_handle, JSON.stringify(prefs), req.params.id]);
  logStudioActivity(req.params.id, 'profile_update', { dedupMinutes: 1440 });

  const updatedStudio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  
  let parsedPrefs = {};
  if (updatedStudio.public_preferences) {
    try { parsedPrefs = JSON.parse(updatedStudio.public_preferences); } catch (e) { }
  }
  updatedStudio.prefs = parsedPrefs;

  const potentialDuplicates = await findPotentialDuplicates(db, updatedStudio);

  const onboarding = await buildOnboarding(db, updatedStudio);
  res.render('manage_studio', { studio: updatedStudio, potentialDuplicates, onboarding, success: 'Profile updated successfully!' });
});


router.get('/manage/studio/:id/roster/export', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const roster = await db.all(`
    SELECT d.name, d.unique_id, d.birthday, ds.status, ds.graduation_year,
           (SELECT COUNT(DISTINCT a.id) FROM awards a
              LEFT JOIN award_dancers ad ON ad.award_id = a.id AND ad.dancer_id = d.id
             WHERE a.studio_id = ds.studio_id AND (ad.dancer_id = d.id OR a.dancer_id = d.id)) as total_awards
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ? AND ds.status != 'alumni'
    ORDER BY d.name ASC
  `, [req.params.id]);

  let csvContent = "Name,Unique ID,Birthday,Status,Graduation Year,Total Awards\n";
  for (const row of roster) {
    const name = `"${row.name.replace(/"/g, '""')}"`;
    const dob = row.birthday || "";
    const status = row.status || "active";
    const grad = row.graduation_year || "";
    csvContent += `${name},${row.unique_id},${dob},${status},${grad},${row.total_awards}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="studio_${studio.id}_active_roster.csv"`);
  res.send(csvContent);
});


router.get('/manage/studio/:id/roster', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const roster = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.birthday, ds.status, ds.headshot_url, ds.graduation_year, ds.label,
           (SELECT COUNT(DISTINCT a.id) FROM awards a
              LEFT JOIN award_dancers ad ON ad.award_id = a.id AND ad.dancer_id = d.id
             WHERE a.studio_id = ds.studio_id AND (ad.dancer_id = d.id OR a.dancer_id = d.id)) as total_awards
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
    ORDER BY d.name ASC
  `, [req.params.id]);

  // Junction links first, legacy awards.dancer_id as fallback — scraped solo
  // awards often carry only the legacy column (dancer page rule: ad OR a.dancer_id).
  const studioAwardsRaw = await db.all(`
    SELECT COALESCE(ad.dancer_id, a.dancer_id) AS dancer_id, a.place, a.category, a.performance_name, e.year, e.name as event_name
    FROM awards a
    LEFT JOIN award_dancers ad ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ? AND (ad.dancer_id IS NOT NULL OR a.dancer_id IS NOT NULL)
    ORDER BY e.year DESC, a.id DESC
  `, [req.params.id]);

  const awardsByDancer = {};
  for (const award of studioAwardsRaw) {
    if (!awardsByDancer[award.dancer_id]) awardsByDancer[award.dancer_id] = [];
    if (awardsByDancer[award.dancer_id].length < 3) {
      awardsByDancer[award.dancer_id].push(award);
    }
  }

  roster.forEach(d => {
    d.recent_awards = awardsByDancer[d.id] || [];
  });

  const suspectedDuplicatesRaw = await db.all(`
    SELECT d.name, d.id, d.unique_id, d.birthday, d.claimed_by_user_id,
           (SELECT COUNT(DISTINCT a.id) FROM awards a
              LEFT JOIN award_dancers ad ON ad.award_id = a.id AND ad.dancer_id = d.id
             WHERE a.studio_id = ds.studio_id AND (ad.dancer_id = d.id OR a.dancer_id = d.id)) as total_awards
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
      AND LOWER(d.name) IN (
        SELECT LOWER(d2.name)
        FROM dancers d2
        JOIN dancer_studios ds2 ON d2.id = ds2.dancer_id
        WHERE ds2.studio_id = ?
        GROUP BY LOWER(d2.name)
        HAVING COUNT(*) > 1
      )
      AND LOWER(d.name) NOT IN (
        SELECT LOWER(dancer_name) FROM studio_duplicate_exceptions WHERE studio_id = ?
      )
    ORDER BY d.name ASC, total_awards DESC
  `, [req.params.id, req.params.id, req.params.id]);

  const duplicateSets = {};
  suspectedDuplicatesRaw.forEach(row => {
    const key = row.name.toLowerCase();
    if (!duplicateSets[key]) duplicateSets[key] = { name: row.name, profiles: [] };
    duplicateSets[key].profiles.push(row);
  });

  res.render('manage_studio_roster', { studio, roster, duplicateSets });
});


router.post('/manage/studio/:id/roster/:dancerId/update', requireAuth, requireStudioOwner, async (req, res) => {
  const { headshot_url, graduation_year, status, birthday } = req.body;
  const db = await openDb();

  const studio = req.studio;

  await db.run(`
    UPDATE dancer_studios 
    SET headshot_url = ?, graduation_year = ?, status = ?
    WHERE studio_id = ? AND dancer_id = ?
  `, [headshot_url || null, graduation_year || null, status || 'active', req.params.id, req.params.dancerId]);

  if (birthday !== undefined) {
    await db.run(`UPDATE dancers SET birthday = ? WHERE id = ?`, [birthday || null, req.params.dancerId]);
  }

  res.redirect(`/manage/studio/${req.params.id}/roster`);
});


router.post('/manage/studio/:id/roster/:dancerId/toggle-status', requireAuth, requireStudioOwner, async (req, res) => {
  const { new_status } = req.body;
  const db = await openDb();

  const studio = req.studio;

  if (new_status !== 'active' && new_status !== 'alumni') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    await db.run(`
      UPDATE dancer_studios 
      SET status = ?
      WHERE studio_id = ? AND dancer_id = ?
    `, [new_status, req.params.id, req.params.dancerId]);

    res.json({ success: true, status: new_status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.post('/manage/studio/:id/awards/self-report', requireAuth, requireStudioOwner, async (req, res) => {
  const { event_name, year, category, age_division, performance_name, place, dancer_ids } = req.body;
  const db = await openDb();

  const studio = req.studio;

  // Create a dummy event for self-reported awards if we don't have a structured one
  await db.run('INSERT INTO events (name, year, org_id) VALUES (?, ?, NULL)', [event_name, year]);
  const event = await db.get('SELECT id FROM events ORDER BY id DESC LIMIT 1');

  await db.run(`
    INSERT INTO awards (event_id, place, performance_name, category, age_division, studio_id, is_self_added, verification_status) 
    VALUES (?, ?, ?, ?, ?, ?, 1, 'unverified')
  `, [event.id, place, performance_name, category, age_division, req.params.id]);

  const award = await db.get('SELECT id FROM awards ORDER BY id DESC LIMIT 1');

  if (dancer_ids) {
    const ids = Array.isArray(dancer_ids) ? dancer_ids : [dancer_ids];
    for (const dId of ids) {
      await db.run("INSERT INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')", [award.id, dId]);
    }
  }

  logStudioActivity(req.params.id, 'award_self_report', { dedupMinutes: 60 });
  res.redirect(`/manage/studio/${req.params.id}/awards?year=${year}`);
});


router.post('/manage/studio/:id/awards/csv-preview', requireAuth, requireStudioOwner, upload.single('csvFile'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  const db = await openDb();

  const studio = req.studio;

  try {
    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

    const previewData = [];
    const roster = await db.all(`
      SELECT d.id, d.name 
      FROM dancer_studios ds
      JOIN dancers d ON ds.dancer_id = d.id
      WHERE ds.studio_id = ?
    `, [req.params.id]);

    for (const row of records) {
      const findKey = (search) => Object.keys(row).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(search));

      const eventName = row[findKey('competition')] || row[findKey('event')] || '';
      const year = row[findKey('year')] || '';
      const performanceName = row[findKey('routine')] || row[findKey('performance')] || '';
      const place = row[findKey('place')] || row[findKey('result')] || '';
      const category = row[findKey('category')] || '';
      const ageDivision = row[findKey('agedivision')] || row[findKey('division')] || row[findKey('age')] || '';
      const dancersStr = row[findKey('dancer')] || '';

      const missing = [];
      if (!eventName) missing.push('Competition Name');
      if (!year) missing.push('Year');
      if (!performanceName) missing.push('Routine Name');
      if (!place) missing.push('Place');

      const matchedDancers = [];
      if (dancersStr) {
        const names = dancersStr.split(',').map(n => n.trim()).filter(n => n);
        for (const name of names) {
          const match = roster.find(r => r.name.toLowerCase() === name.toLowerCase());
          if (match) {
            matchedDancers.push({ id: match.id, name: match.name, matched: true });
          } else {
            matchedDancers.push({ name: name, matched: false });
          }
        }
      }

      previewData.push({
        event_name: eventName,
        year: year,
        performance_name: performanceName,
        place: place,
        category: category,
        age_division: ageDivision,
        dancers: matchedDancers,
        isValid: missing.length === 0,
        missing: missing
      });
    }

    fs.unlinkSync(req.file.path);
    res.render('manage_studio_awards_csv', { studio, previewData });
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error(err);
    res.status(500).send('Error parsing CSV. Please ensure you are using the correct template format.');
  }
});


router.post('/manage/studio/:id/awards/csv-commit', requireAuth, requireStudioOwner, async (req, res) => {
  const { preview_data } = req.body;
  const db = await openDb();

  const studio = req.studio;

  if (preview_data) {
    let rows = [];
    try {
      rows = JSON.parse(preview_data);
    } catch (e) {
      return res.status(400).send('Invalid data format received.');
    }

    for (const row of rows) {
      if (!row.isValid) continue;

      let event = await db.get('SELECT id FROM events WHERE name = ? AND year = ? AND org_id IS NULL', [row.event_name, row.year]);
      if (!event) {
        await db.run('INSERT INTO events (name, year, org_id) VALUES (?, ?, NULL)', [row.event_name, row.year]);
        event = await db.get('SELECT id FROM events ORDER BY id DESC LIMIT 1');
      }

      await db.run(`
        INSERT INTO awards (event_id, place, performance_name, category, age_division, studio_id, is_self_added, verification_status)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'unverified')
      `, [event.id, row.place, row.performance_name, row.category, row.age_division, req.params.id]);

      const award = await db.get('SELECT id FROM awards ORDER BY id DESC LIMIT 1');

      for (const d of row.dancers) {
        if (d.matched && d.id) {
          await db.run("INSERT INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')", [award.id, d.id]);
        } else if (!d.matched && d.name) {
          await db.run('INSERT INTO dancers (name) VALUES (?)', [d.name]);
          const newDancer = await db.get('SELECT id FROM dancers ORDER BY id DESC LIMIT 1');
          await db.run("INSERT INTO dancer_studios (dancer_id, studio_id, source) VALUES (?, ?, 'studio_owner')", [newDancer.id, req.params.id]);
          await db.run("INSERT INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')", [award.id, newDancer.id]);
        }
      }
    }
  }

  logStudioActivity(req.params.id, 'awards_csv_commit', { dedupMinutes: 60 });
  res.redirect(`/manage/studio/${req.params.id}/awards`);
});


router.get('/api/dancers/search', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { q, studio } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const db = await openDb();

  let query = `
    SELECT d.id, d.name, d.unique_id,
           (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) as award_count,
           (SELECT GROUP_CONCAT(s.name, ', ') 
            FROM dancer_studios ds 
            JOIN studios s ON ds.studio_id = s.id 
            WHERE ds.dancer_id = d.id) as studio_names
    FROM dancers d
    WHERE d.name LIKE ?
  `;
  const params = [`%${q}%`];

  const dancersRaw = await db.all(query, params);

  // Filter by studio in JS since it's an alias from a subquery and SQLite is finicky
  let dancers = dancersRaw;
  if (studio && studio.length >= 2) {
    const studioLower = studio.toLowerCase();
    dancers = dancersRaw.filter(d => d.studio_names && d.studio_names.toLowerCase().includes(studioLower));
  }

  // Sort and limit
  dancers = dancers.sort((a, b) => b.award_count - a.award_count).slice(0, 20);

  for (let dancer of dancers) {
    dancer.recent_routines = await db.all(`
      SELECT a.performance_name, e.year, o.name as comp_name
      FROM awards a
      JOIN award_dancers ad ON a.id = ad.award_id
      JOIN events e ON a.event_id = e.id
      LEFT JOIN organizations o ON e.org_id = o.id
      WHERE ad.dancer_id = ?
      ORDER BY e.year DESC
      LIMIT 3
    `, [dancer.id]);
  }

  res.json(dancers);
});


router.post('/manage/studio/:id/roster/merge', requireAuth, requireStudioOwner, async (req, res) => {
  const { primary_id, duplicate_id } = req.body;
  const db = await openDb();

  const studio = req.studio;

  if (!primary_id || !duplicate_id || primary_id === duplicate_id) {
    return res.status(400).send('Invalid merge parameters');
  }

  // Verify both dancers belong to this studio
  const d1 = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [primary_id, req.params.id]);
  const d2 = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [duplicate_id, req.params.id]);

  if (!d1 || !d2) {
    return res.status(403).send('Both dancers must be on your roster to merge them.');
  }

  try {
    await db.run('BEGIN TRANSACTION');

    // 1. Move all awards from duplicate to primary (use INSERT OR IGNORE to prevent UNIQUE constraint errors if they somehow both won the exact same award record)
    await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status, source, created_at) SELECT award_id, ?, status, source, created_at FROM award_dancers WHERE dancer_id = ?', [primary_id, duplicate_id]);
    await db.run('DELETE FROM award_dancers WHERE dancer_id = ?', [duplicate_id]);
    // Legacy solo attribution rides awards.dancer_id — repoint it too, or the
    // duplicate's solo awards end up stranded on a deleted dancer id.
    await db.run('UPDATE awards SET dancer_id = ? WHERE dancer_id = ?', [primary_id, duplicate_id]);

    // 2. Move any OTHER studio affiliations the duplicate might have had (that aren't this studio)
    await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status, source) SELECT ?, studio_id, status, source FROM dancer_studios WHERE dancer_id = ?', [primary_id, duplicate_id]);
    await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [duplicate_id]);

    // 3. Delete the duplicate dancer record
    await db.run('DELETE FROM dancers WHERE id = ?', [duplicate_id]);

    await db.run('COMMIT');
    res.redirect(`/manage/studio/${req.params.id}/roster?success=Merge+completed`);
  } catch (err) {
    await db.run('ROLLBACK');
    console.error(err);
    res.status(500).send('Merge failed');
  }
});


// Clean Duplicate Set (1-Click Merge)
router.post('/manage/studio/:id/roster/clean-duplicate-set', requireAuth, requireStudioOwner, async (req, res) => {
  const { duplicate_name, merge_ids } = req.body;
  const db = await openDb();

  const studio = req.studio;

  if (!duplicate_name) return res.status(400).json({ error: 'Missing name' });

  try {
    // Fetch all profiles for this exact name in this studio
    let profiles = await db.all(`
      SELECT d.id, d.claimed_by_user_id,
             (SELECT COUNT(DISTINCT a.id) FROM awards a
                LEFT JOIN award_dancers ad ON ad.award_id = a.id AND ad.dancer_id = d.id
               WHERE a.studio_id = ds.studio_id AND (ad.dancer_id = d.id OR a.dancer_id = d.id)) as total_awards
      FROM dancers d
      JOIN dancer_studios ds ON d.id = ds.dancer_id
      WHERE ds.studio_id = ? AND LOWER(d.name) = ?
    `, [req.params.id, duplicate_name.trim().toLowerCase()]);

    // Optional subset merge: only the ticked profiles are merged; unticked
    // ones are left untouched (the widget re-renders with them, so twins
    // can be merged pair-by-pair, then marked as different people).
    // Filtering the name-scoped list also validates the ids belong here.
    if (Array.isArray(merge_ids) && merge_ids.length > 0) {
      const wanted = new Set(merge_ids.map(Number));
      profiles = profiles.filter(p => wanted.has(p.id));
    }
    if (profiles.length < 2) return res.status(400).json({ error: 'Select at least two profiles of this name to merge.' });

    // Determine Primary
    // Priority 1: Claimed
    // Priority 2: Most awards
    profiles.sort((a, b) => {
      if (a.claimed_by_user_id && !b.claimed_by_user_id) return -1;
      if (!a.claimed_by_user_id && b.claimed_by_user_id) return 1;
      return b.total_awards - a.total_awards;
    });

    const primaryId = profiles[0].id;
    const duplicatesToMerge = profiles.slice(1).map(p => p.id);

    await db.run('BEGIN TRANSACTION');

    for (let dupId of duplicatesToMerge) {
      await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status, source, created_at) SELECT award_id, ?, status, source, created_at FROM award_dancers WHERE dancer_id = ?', [primaryId, dupId]);
      await db.run('DELETE FROM award_dancers WHERE dancer_id = ?', [dupId]);
      // Legacy solo attribution (awards.dancer_id) must follow the merge too.
      await db.run('UPDATE awards SET dancer_id = ? WHERE dancer_id = ?', [primaryId, dupId]);

      await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status, source) SELECT ?, studio_id, status, source FROM dancer_studios WHERE dancer_id = ?', [primaryId, dupId]);
      await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [dupId]);

      await db.run('DELETE FROM dancers WHERE id = ?', [dupId]);
    }

    await db.run('COMMIT');
    res.json({ success: true, merged: duplicatesToMerge.length });
  } catch (err) {
    await db.run('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});


// Ignore Duplicate Set
router.post('/manage/studio/:id/roster/ignore-duplicate-set', requireAuth, requireStudioOwner, async (req, res) => {
  const { duplicate_name } = req.body;
  const db = await openDb();

  const studio = req.studio;

  if (!duplicate_name) return res.status(400).json({ error: 'Missing name' });

  try {
    await db.run('INSERT OR IGNORE INTO studio_duplicate_exceptions (studio_id, dancer_name) VALUES (?, ?)', [req.params.id, duplicate_name.trim().toLowerCase()]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});


router.post('/manage/studio/:id/roster/csv-preview', requireAuth, requireStudioOwner, upload.single('roster_csv'), async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  if (!req.file) return res.status(400).send('No file uploaded');

  try {
    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

    // We need 'name' at minimum
    if (records.length > 0 && !records[0].name) {
      // maybe they capitalized Name? Let's lowercase all keys
      records.forEach(r => {
        Object.keys(r).forEach(k => {
          if (k.toLowerCase() !== k) {
            r[k.toLowerCase()] = r[k];
            delete r[k];
          }
        });
      });

      if (!records[0].name) {
        fs.unlinkSync(req.file.path);
        return res.status(400).send('CSV must have a "name" column.');
      }
    }

    // Prepare resolution data
    const previewData = [];
    for (const row of records) {
      if (!row.name) continue;

      // Global search for this exact or partial name
      const matches = await db.all(`
        SELECT id, name, birthday, 
        (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = dancers.id) as award_count
        FROM dancers 
        WHERE name LIKE ?
        ORDER BY award_count DESC LIMIT 5
      `, [`%${row.name}%`]);

      previewData.push({
        csv_row: row,
        matches: matches
      });
    }

    // Keep the file path so the commit phase can re-read it or we can pass JSON via form
    // Since we have the previewData array, we will just render a resolution UI and pass the array back as JSON hidden input
    fs.unlinkSync(req.file.path);

    res.render('manage_studio_roster_csv', { studio, previewData });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error(error);
    res.status(500).send('Error parsing CSV. Please ensure it is a valid CSV file.');
  }
});


router.post('/manage/studio/:id/roster/csv-commit', requireAuth, requireStudioOwner, async (req, res) => {
  const { resolution_data } = req.body;
  // resolution_data will be an array of { action: 'create'|'link'|'skip', dancer_id: ID_if_link, csv_row: {name, birthday, graduation_year, status} }

  const db = await openDb();
  const studio = req.studio;

  let parsedData;
  try {
    parsedData = JSON.parse(resolution_data);
  } catch (e) {
    return res.status(400).send('Invalid resolution data');
  }

  const crypto = require('crypto');

  try {
    await db.run('BEGIN TRANSACTION');

    for (const item of parsedData) {
      if (item.action === 'skip') continue;

      let dancerId = item.dancer_id;

      if (item.action === 'create') {
        const uniqueId = generateDancerId(item.csv_row.name);
        await db.run('INSERT INTO dancers (unique_id, name, birthday) VALUES (?, ?, ?)', [uniqueId, item.csv_row.name, item.csv_row.birthday || null]);
        const newDancer = await db.get('SELECT id FROM dancers ORDER BY id DESC LIMIT 1');
        dancerId = newDancer.id;
      }

      if (dancerId) {
        // Link to studio with pivot data
        const status = 'active';
        const gradYear = null;

        const priorLink = await db.get('SELECT 1 FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [dancerId, req.params.id]);
        await db.run(`
          INSERT INTO dancer_studios (dancer_id, studio_id, status, graduation_year, source) 
          VALUES (?, ?, ?, ?, 'studio_owner')
          ON CONFLICT(dancer_id, studio_id) DO UPDATE SET 
            status = excluded.status,
            graduation_year = excluded.graduation_year
        `, [dancerId, req.params.id, status, gradYear]);
        if (!priorLink) notifyRosterAttach(db, dancerId, req.params.id);
      }
    }

    await db.run('COMMIT');
    logStudioActivity(req.params.id, 'roster_csv_commit', { dedupMinutes: 60 });
    res.redirect(`/manage/studio/${req.params.id}/roster?success=CSV+Import+Completed`);
  } catch (err) {
    await db.run('ROLLBACK');
    console.error(err);
    res.status(500).send('Import failed');
  }
});


router.post('/manage/studio/:id/roster/claim', requireAuth, requireStudioOwner, async (req, res) => {
  const { claim_unique_id, new_dancer_name, birthday } = req.body;
  const db = await openDb();

  const studio = req.studio;

  let finalDancerId = null;

  if (claim_unique_id) {
    const existingDancer = await db.get('SELECT id FROM dancers WHERE unique_id = ?', [claim_unique_id.trim()]);
    if (!existingDancer) {
      return res.status(404).send('Dancer not found with that Unique ID.');
    }
    finalDancerId = existingDancer.id;
  } else if (new_dancer_name) {
    // Create new dancer
    const uniqueId = generateDancerId(new_dancer_name);
    await db.run('INSERT INTO dancers (unique_id, name, birthday) VALUES (?, ?, ?)', [uniqueId, new_dancer_name, birthday || null]);
    const newDancer = await db.get('SELECT id FROM dancers ORDER BY id DESC LIMIT 1');
    finalDancerId = newDancer.id;
  }

  if (finalDancerId) {
    const addRes = await db.run("INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status, source) VALUES (?, ?, 'active', 'studio_owner')", [finalDancerId, req.params.id]);
    if (addRes.changes > 0) notifyRosterAttach(db, finalDancerId, req.params.id);
  }

  res.redirect(`/manage/studio/${req.params.id}/roster`);
});


router.get('/manage/studio/:id/verifications', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const pendingAwards = await db.all(`
    SELECT ad.id as link_id, ad.award_id, d.name as dancer_name, d.unique_id, a.performance_name, a.award_type, e.name as event_name, e.year
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE ad.status = 'pending' AND a.studio_id = ?
  `, [studio.id]);

  const pendingRoster = await db.all(`
    SELECT ds.id as link_id, d.name as dancer_name, d.unique_id, ds.created_at
    FROM dancer_studios ds
    JOIN dancers d ON ds.dancer_id = d.id
    WHERE ds.status = 'pending' AND ds.studio_id = ?
  `, [studio.id]);

  // Profile claims routed here by a valid studio claim code: the claimant
  // proved community membership with the code; the director confirms the
  // family identity. Approval finalizes the claim — no system-admin step.
  let pendingProfileClaims = [];
  try {
    pendingProfileClaims = await db.all(`
      SELECT dc.id, dc.proof_text, dc.created_at, u.email as user_email,
             d.name as dancer_name, d.unique_id
      FROM dancer_claims dc
      JOIN users u ON dc.user_id = u.id
      JOIN dancers d ON dc.dancer_id = d.id
      WHERE dc.status = 'pending' AND dc.code_valid = 1 AND dc.studio_id = ?
      ORDER BY dc.created_at ASC
    `, [studio.id]);
  } catch (e) { /* columns missing until `node database.js` runs */ }

  res.render('manage_studio_verifications', { studio, pendingAwards, pendingRoster, pendingProfileClaims });
});


router.post('/manage/studio/:id/verifications/profile/:claim_id/approve', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  // Only claims code-routed to THIS studio are the director's to decide
  const claim = await db.get(
    "SELECT * FROM dancer_claims WHERE id = ? AND status = 'pending' AND code_valid = 1 AND studio_id = ?",
    [req.params.claim_id, studio.id]);
  if (claim) {
    await approveDancerClaim(db, claim);
    logStudioActivity(studio.id, 'verification_action', { dedupMinutes: 60 });
  }
  res.redirect(`/manage/studio/${studio.id}/verifications`);
});


router.post('/manage/studio/:id/verifications/profile/:claim_id/deny', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const claim = await db.get(
    "SELECT id FROM dancer_claims WHERE id = ? AND status = 'pending' AND code_valid = 1 AND studio_id = ?",
    [req.params.claim_id, studio.id]);
  if (claim) await rejectDancerClaim(db, claim.id);
  res.redirect(`/manage/studio/${studio.id}/verifications`);
});


router.post('/manage/studio/:id/verifications/award/:link_id/approve', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const link = await db.get('SELECT dancer_id FROM award_dancers WHERE id = ?', [req.params.link_id]);
  if (link) {
    await db.run("UPDATE award_dancers SET status = 'verified' WHERE id = ?", [req.params.link_id]);
    await db.run("UPDATE dancer_studios SET status = 'active' WHERE dancer_id = ? AND studio_id = ?", [link.dancer_id, studio.id]);
    logStudioActivity(studio.id, 'verification_action', { dedupMinutes: 60 });
  }

  res.redirect(`/manage/studio/${studio.id}/verifications`);
});


router.post('/manage/studio/:id/verifications/award/:link_id/deny', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  // Director's denial is a negative assertion: tombstone it so automated
  // re-add paths (auto-backfill, future imports) don't resurrect the link.
  const link = await db.get('SELECT award_id, dancer_id FROM award_dancers WHERE id = ?', [req.params.link_id]);
  if (link) {
    await db.run("INSERT OR REPLACE INTO award_dancer_removals (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')",
      [link.award_id, link.dancer_id]).catch(() => {});
  }
  await db.run("DELETE FROM award_dancers WHERE id = ?", [req.params.link_id]);
  res.redirect(`/manage/studio/${studio.id}/verifications`);
});


router.post('/manage/studio/:id/verifications/roster/:link_id/approve', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  await db.run('UPDATE dancer_studios SET status = "active" WHERE id = ?', [req.params.link_id]);

  res.redirect(`/manage/studio/${req.params.id}/verifications`);
});


router.post('/manage/studio/:id/verifications/roster/:link_id/deny', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  await db.run('DELETE FROM dancer_studios WHERE id = ?', [req.params.link_id]);

  res.redirect(`/manage/studio/${req.params.id}/verifications`);
});


router.post('/api/studios/:id/verifications/bulk', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const { type, action, linkIds } = req.body;
  if (!Array.isArray(linkIds) || linkIds.length === 0) return res.status(400).json({ error: 'Invalid linkIds' });

  try {
    if (type === 'award') {
      if (action === 'approve') {
        for (const link_id of linkIds) {
          const link = await db.get('SELECT dancer_id FROM award_dancers WHERE id = ?', [link_id]);
          if (link) {
            await db.run("UPDATE award_dancers SET status = 'verified' WHERE id = ?", [link_id]);
            await db.run("UPDATE dancer_studios SET status = 'active' WHERE dancer_id = ? AND studio_id = ?", [link.dancer_id, studio.id]);
          }
        }
      } else if (action === 'deny') {
        for (const link_id of linkIds) {
          const link = await db.get('SELECT award_id, dancer_id FROM award_dancers WHERE id = ?', [link_id]);
          if (link) {
            await db.run("INSERT OR REPLACE INTO award_dancer_removals (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')",
              [link.award_id, link.dancer_id]).catch(() => {});
          }
          await db.run("DELETE FROM award_dancers WHERE id = ?", [link_id]);
        }
      }
    } else if (type === 'roster') {
      if (action === 'approve') {
        for (const link_id of linkIds) {
          await db.run("UPDATE dancer_studios SET status = 'active' WHERE id = ?", [link_id]);
        }
      } else if (action === 'deny') {
        for (const link_id of linkIds) {
          await db.run("DELETE FROM dancer_studios WHERE id = ?", [link_id]);
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    logStudioActivity(studio.id, 'verification_action', { dedupMinutes: 60 });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/manage/studio/:id/history', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();

  const studio = req.studio;

  const awards = await db.all(`
    SELECT a.*, e.name as event_name, e.year as event_year, o.id as org_id, o.name as org_name, o.logo_url as org_logo_url, o.custom_icons
    FROM awards a
    JOIN events e ON a.event_id = e.id
    JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ?
  `, [req.params.id]);

  const awardIds = awards.map(a => a.id);
  let awardDancersMap = {};
  if (awardIds.length > 0) {
    const placeholders = awardIds.map(() => '?').join(',');
    const dancersData = await db.all(`
      SELECT ad.award_id, d.name
      FROM award_dancers ad
      JOIN dancers d ON ad.dancer_id = d.id
      WHERE ad.award_id IN (${placeholders})
    `, awardIds);
    
    dancersData.forEach(row => {
      if (!awardDancersMap[row.award_id]) awardDancersMap[row.award_id] = [];
      awardDancersMap[row.award_id].push(row.name);
    });
  }

  awards.forEach(a => {
    a.dancers = awardDancersMap[a.id] || [];
    if (a.custom_icons) {
      try { a.customIconsObj = JSON.parse(a.custom_icons); } catch (e) { }
    }
  });

  const orgsMap = {};

  for (const award of awards) {
    if (!orgsMap[award.org_id]) {
      orgsMap[award.org_id] = {
        id: award.org_id,
        name: award.org_name,
        logo_url: award.org_logo_url,
        years: {},
        total_awards_all_time: 0,
        first_places_all_time: 0,
        major_awards_all_time: 0
      };
    }
    const org = orgsMap[award.org_id];
    org.total_awards_all_time++;
    if (award.is_first_place) org.first_places_all_time++;

    const premiumDetails = req.app.locals.getPremiumDetails(award);
    let isMajor = false;
    if (award.is_first_place && premiumDetails.isPremium) {
      const nameLower = (award.award_type || award.category || '').toLowerCase();
      const eventNameLower = (award.event_name || '').toLowerCase();
      if (nameLower.includes('national') || nameLower.includes('final') || nameLower.includes('grand') || nameLower.includes('title') || eventNameLower.includes('national') || eventNameLower.includes('final')) {
        isMajor = true;
        org.major_awards_all_time++;
      }
    }

    if (!org.years[award.event_year]) {
      org.years[award.event_year] = {
        total_awards: 0,
        first_places: 0,
        major_awards: 0,
        eventsMap: {}
      };
    }
    const yr = org.years[award.event_year];
    yr.total_awards++;
    if (award.is_first_place) yr.first_places++;
    if (isMajor) yr.major_awards++;

    if (!yr.eventsMap[award.event_id]) {
      yr.eventsMap[award.event_id] = {
        name: award.event_name,
        total_awards: 0,
        first_places: 0,
        major_awards: 0,
        awards: []
      };
    }
    const evt = yr.eventsMap[award.event_id];
    evt.total_awards++;
    if (award.is_first_place) evt.first_places++;
    if (isMajor) evt.major_awards++;
    evt.awards.push(award);
  }

  // Format map into array
  const orgs = Object.values(orgsMap).map(org => {
    Object.keys(org.years).forEach(year => {
      org.years[year].events = Object.values(org.years[year].eventsMap).sort((a, b) => a.name.localeCompare(b.name));
      delete org.years[year].eventsMap;
    });
    return org;
  });

  orgs.sort((a, b) => a.name.localeCompare(b.name));

  res.render('manage_studio_history', { studio, orgs });
});


router.get('/manage/studio/:id/ai-summaries', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const summaries = await db.all(`
    SELECT a.*, o.name as org_name, o.logo_url as org_logo
    FROM ai_summaries a
    JOIN organizations o ON a.org_id = o.id
    WHERE a.studio_id = ?
    ORDER BY a.created_at DESC
  `, [studio.id]);

  // Group by organization
  const groupedSummaries = {};
  for (const s of summaries) {
    if (!groupedSummaries[s.org_name]) {
      groupedSummaries[s.org_name] = {
        org_name: s.org_name,
        org_logo: s.org_logo,
        items: []
      };
    }
    groupedSummaries[s.org_name].items.push(s);
  }

  res.render('manage_studio_ai_summaries', { 
    studio, 
    groupedSummaries: Object.values(groupedSummaries).sort((a,b) => a.org_name.localeCompare(b.org_name))
  });
});


router.get('/api/studio/:id/history/org/:org_id/summary', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studioId = req.params.id;
  const orgId = req.params.org_id;

  const studio = req.studio;

  const org = await db.get('SELECT name FROM organizations WHERE id = ?', [orgId]);
  if (!org) return res.status(404).send('Org not found');
  const isYagp = org.name.toLowerCase().includes('yagp');

  const awards = await db.all(`
    SELECT a.*, e.name as event_name, e.year as event_year
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ? AND e.org_id = ?
    ORDER BY e.year ASC, a.age_division ASC, a.place ASC
  `, [studioId, orgId]);

  if (awards.length === 0) return res.json({ summary: "No awards found for this organization." });

  const awardIds = awards.map(a => a.id);
  const awardDancersMap = {};
  if (awardIds.length > 0) {
    const placeholders = awardIds.map(() => '?').join(',');
    const dancersData = await db.all(`
      SELECT ad.award_id, d.name
      FROM award_dancers ad
      JOIN dancers d ON ad.dancer_id = d.id
      WHERE ad.award_id IN (${placeholders})
    `, awardIds);
    dancersData.forEach(row => {
      if (!awardDancersMap[row.award_id]) awardDancersMap[row.award_id] = [];
      awardDancersMap[row.award_id].push(row.name);
    });
  }

  const groups = {};

  for (const award of awards) {
    let groupKey = String(award.event_year);
    if (award.event_name.toLowerCase().includes('final')) {
      groupKey = `${award.event_year} Final`;
    }
    
    if (!groups[groupKey]) groups[groupKey] = {};

    let ageDiv = award.age_division || 'Others';
    ageDiv = ageDiv.replace(/ AGE DIVISION/i, '').trim();
    ageDiv = ageDiv.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    if (ageDiv === 'Others' && isYagp && (award.category || '').toLowerCase().includes('ensemble')) {
       ageDiv = 'Ensembles';
    }

    if (!groups[groupKey][ageDiv]) groups[groupKey][ageDiv] = [];

    const placeLower = String(award.place || '').toLowerCase();
    let emoji = '';
    if (placeLower.includes('hope') || placeLower.includes('youth grand prix') || placeLower.includes('grand prix')) emoji = '👑 ';
    else if (placeLower.includes('1st')) emoji = '🥇';
    else if (placeLower.includes('2nd')) emoji = '🥈';
    else if (placeLower.includes('3rd')) emoji = '🥉';
    else if (placeLower.includes('top')) emoji = '🎖';

    let cleanedCategory = award.category || award.award_type || '';
    cleanedCategory = cleanedCategory.replace(/-?\s*DANCE CATEGORY\s*-?/i, ' ').trim();
    cleanedCategory = cleanedCategory.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    const dancers = awardDancersMap[award.id] ? awardDancersMap[award.id].join(', ') : '';
    let suffix = award.event_name.toLowerCase().includes('final') ? '' : ', Regional';

    let formattedPlace = award.place ? award.place : 'Award';
    let agePrefix = (ageDiv !== 'Others' && ageDiv !== 'Ensembles') ? `${ageDiv} ` : '';
    
    let lineStr = `${emoji}${formattedPlace}, ${agePrefix}${cleanedCategory}`;
    if (dancers) lineStr += ` (${dancers})`;
    else if (award.performance_name) lineStr += ` [${award.performance_name}]`;
    if (suffix) lineStr += suffix;

    const autoCheck = placeLower.includes('1st') || placeLower.includes('2nd') || placeLower.includes('3rd') || placeLower.includes('hope') || placeLower.includes('grand prix');

    groups[groupKey][ageDiv].push({
      id: award.id,
      text: lineStr,
      autoCheck: autoCheck
    });
  }

  res.json({ orgName: org.name, groups });
});


router.post('/api/studio/:id/history/org/:org_id/ai-summary', requireAuth, requireStudioOwner, async (req, res) => {
  try {
    const db = await openDb();
    const studioId = req.params.id;
    const orgId = req.params.org_id;
    const { tone, awardsList, orgName } = req.body;

    const studio = req.studio;

    const awardsText = awardsList.join('\n');
    let systemPrompt = `You are an expert marketing copywriter for a competitive dance studio. Write a concise, inspiring social media caption celebrating the studio's achievements at ${orgName} based on the provided list of awards.`;
    
    if (tone === 'Professional') {
      systemPrompt = `You are a professional PR specialist for a competitive dance studio. Write a formal, concise press release blurb celebrating the studio's achievements at ${orgName} based on the provided list of awards. Avoid overly casual language or excessive emojis.`;
    } else if (tone === 'Enthusiastic') {
      systemPrompt = `You are an extremely enthusiastic marketing copywriter for a competitive dance studio. Write a highly energetic, inspiring social media caption celebrating the studio's achievements at ${orgName} based on the provided list of awards. Use emojis generously and make it sound exciting!`;
    }

    const prompt = `Awards List:\n${awardsText}\n\nWrite the marketing summary. Keep it under 150 words. Do not hallucinate any awards. Focus on podium placements (1st, 2nd, 3rd) and major awards.`;

    const modelSetting = await db.get(`SELECT value FROM system_settings WHERE key = 'openai_model'`);
    const aiModel = modelSetting ? modelSetting.value : 'gpt-4o-mini';

    const response = await openai.chat.completions.create({
      model: aiModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]
    });

    const aiResponseText = response.choices[0].message.content.trim();

    const result = await db.run(`
      INSERT INTO ai_summaries (studio_id, org_id, tone, prompt, raw_awards_json, original_ai_response, user_edited_response)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [studioId, orgId, tone, prompt, JSON.stringify(awardsList), aiResponseText, aiResponseText]);

    logStudioActivity(studioId, 'ai_summary', { dedupMinutes: 60 });
    res.json({ id: result.lastID, text: aiResponseText });
  } catch (error) {
    console.error('OpenAI Error:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});


router.put('/api/studio/ai-summary/:id', requireAuth, async (req, res) => {
  try {
    const db = await openDb();
    const { text } = req.body;

    const summary = await db.get(`
      SELECT ai.id, s.owner_id
      FROM ai_summaries ai
      JOIN studios s ON ai.studio_id = s.id
      WHERE ai.id = ?
    `, [req.params.id]);
    if (!summary) return res.status(404).json({ error: 'Summary not found' });

    const { id: userId, role } = req.session.user;
    if (summary.owner_id !== userId && role !== 'admin' && role !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden: Not the owner' });
    }

    await db.run(`
      UPDATE ai_summaries
      SET user_edited_response = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [text, req.params.id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('DB Update Error:', error);
    res.status(500).json({ error: 'Failed to save edits' });
  }
});


router.get('/manage/studio/:id/awards', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const yearsResult = await db.all(`
    SELECT DISTINCT e.year
    FROM awards a
    JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ?
    ORDER BY e.year DESC
  `, [req.params.id]);
  const availableYears = yearsResult.map(r => r.year);

  let selectedYear = req.query.year || null;
  if (!selectedYear && availableYears.length > 0) {
    selectedYear = availableYears[0];
  } else if (selectedYear !== 'all') {
    selectedYear = parseInt(selectedYear);
  }

  let awards = [];
  if (selectedYear) {
    let yearClause = selectedYear === 'all' ? '' : 'AND e.year = ?';
    let params = selectedYear === 'all' ? [req.params.id] : [req.params.id, selectedYear];
    
    awards = await db.all(`
      SELECT a.*, d.name as dancer_name, e.name as event_name, e.year as event_year 
      FROM awards a
      LEFT JOIN dancers d ON a.dancer_id = d.id
      LEFT JOIN events e ON a.event_id = e.id
      WHERE a.studio_id = ? ${yearClause}
      ORDER BY e.date_string DESC
    `, params);
  }

  const studioDancers = await db.all(`
    SELECT d.id, d.name 
    FROM dancers d
    JOIN dancer_studios ds ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
    ORDER BY d.name ASC
  `, [req.params.id]);

  let awardDancers = [];
  if (selectedYear) {
    let yearClause = selectedYear === 'all' ? '' : 'AND e.year = ?';
    let params = selectedYear === 'all' ? [req.params.id] : [req.params.id, selectedYear];

    awardDancers = await db.all(`
      SELECT ad.award_id, d.id as dancer_id, d.name 
      FROM award_dancers ad
      JOIN dancers d ON ad.dancer_id = d.id
      JOIN awards a ON ad.award_id = a.id
      JOIN events e ON a.event_id = e.id
      WHERE a.studio_id = ? ${yearClause}
    `, params);
  }

  const groupedDancers = {};
  for (const row of awardDancers) {
    if (!groupedDancers[row.award_id]) groupedDancers[row.award_id] = [];
    groupedDancers[row.award_id].push({ id: row.dancer_id, name: row.name });
  }

  const currentView = req.query.view || 'events';
  const currentSort = req.query.sort || 'name';

  res.render('manage_studio_awards', { 
    studio, 
    awards, 
    studioDancers, 
    groupedDancers, 
    availableYears, 
    selectedYear, 
    currentView, 
    currentSort 
  });
});


router.post('/manage/studio/:id/awards/:awardId/update', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const award = await db.get('SELECT * FROM awards WHERE id = ? AND studio_id = ?', [req.params.awardId, req.params.id]);
  if (!award) return res.status(404).send('Award not found');

  const { performance_name, place, award_type, category, age_division } = req.body;

  if (performance_name && !award.performance_name) {
    await db.run('UPDATE awards SET performance_name = ? WHERE id = ?', [performance_name, award.id]);
  }
  if (place && !award.place) {
    await db.run('UPDATE awards SET place = ? WHERE id = ?', [place, award.id]);
  }
  if (award_type && !award.award_type) {
    await db.run('UPDATE awards SET award_type = ? WHERE id = ?', [award_type, award.id]);
  }
  if (category !== undefined) {
    await db.run('UPDATE awards SET category = ? WHERE id = ?', [category, award.id]);
  }
  if (age_division !== undefined) {
    await db.run('UPDATE awards SET age_division = ? WHERE id = ?', [age_division, award.id]);
  }

  const yearQuery = req.query.year ? `?year=${req.query.year}` : '';
  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});


router.post('/api/studio/:id/awards/:awardId/hall-of-fame', express.json(), requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const { status } = req.body; // expected: 1, -1, or 0
  if (![1, 0, -1].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const result = await db.run('UPDATE awards SET is_hall_of_fame = ? WHERE id = ? AND studio_id = ?', [status, req.params.awardId, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Award not found' });
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});


router.post('/manage/studio/:id/awards/:awardId/dancers', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const yearQuery = req.query.year ? `?year=${req.query.year}` : '';
  let { dancer_name } = req.body;
  if (!dancer_name) return res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
  dancer_name = dancer_name.trim();

  try {
    let dancer = await db.get(`
      SELECT d.id FROM dancers d 
      JOIN dancer_studios ds ON d.id = ds.dancer_id 
      WHERE d.name = ? COLLATE NOCASE AND ds.studio_id = ?
    `, [dancer_name, req.params.id]);

    if (!dancer) {
      const unique_id = generateDancerId(dancer_name);
      const result = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [unique_id, dancer_name]);
      dancer = { id: result.lastID };
    }

    try {
      await db.run("INSERT INTO dancer_studios (dancer_id, studio_id, source) VALUES (?, ?, 'studio_owner')", [dancer.id, req.params.id]);
      notifyRosterAttach(db, dancer.id, req.params.id);
    } catch (e) { }

    // Director re-adding by hand overrides any earlier removal
    await db.run('DELETE FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [req.params.awardId, dancer.id]).catch(() => {});
    await db.run("INSERT INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')", [req.params.awardId, dancer.id]);
  } catch (e) { console.error(e); }

  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});


router.post('/manage/studio/:id/awards/:awardId/dancers/:dancerId/remove', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  await db.run("INSERT OR REPLACE INTO award_dancer_removals (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')",
    [req.params.awardId, req.params.dancerId]).catch(() => {});
  await db.run('DELETE FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [req.params.awardId, req.params.dancerId]);

  const yearQuery = req.query.year ? `?year=${req.query.year}` : '';
  res.redirect(`/manage/studio/${req.params.id}/awards${yearQuery}`);
});


// Widget Builder UI
router.get('/manage/studio/:id/widget', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  res.render('manage_studio_widget', { studio });
});


router.get('/my-studio', requireAuth, async (req, res) => {
  const db = await openDb();
  const ownedStudio = await db.get('SELECT id FROM studios WHERE owner_id = ? LIMIT 1', [req.session.user.id]);
  if (ownedStudio) {
    res.redirect(`/manage/studio/${ownedStudio.id}`);
  } else {
    res.send(`<script>alert("You haven't claimed a studio yet! Please search for your studio in the directory and click 'Claim this Studio' to gain management access."); window.location.href="/studios";</script>`);
  }
});

// --- Group Routine Dancers -------------------------------------------------
// Competitions rarely publish the dancers in group routines, so imported
// group awards usually have no cast. This surface lets a director paste a
// name list per routine, preview how each name resolves against their
// roster (link / ambiguous / create), then apply to every award that
// routine won that year. Preview-then-apply is deliberate: same-name
// dancers are real (two kids named Emma), so nothing links without the
// director seeing what will happen.

// Awards belonging to one routine-year for this studio (solo-typed awards
// excluded — solos come with dancer names from the source).
const GROUP_AWARD_FILTER = `
  a.studio_id = ? AND TRIM(IFNULL(a.performance_name, '')) = ?
  AND LOWER(IFNULL(a.award_type, '')) NOT LIKE '%solo%'
  AND LOWER(IFNULL(a.category, '')) NOT LIKE '%solo%'`;

async function routineAwardIds(db, studioId, routine, year) {
  const yearCond = year === 'Undated' ? 'e.year IS NULL' : 'e.year = ?';
  const params = year === 'Undated' ? [studioId, routine.trim()] : [studioId, routine.trim(), year];
  const rows = await db.all(`
    SELECT a.id FROM awards a LEFT JOIN events e ON a.event_id = e.id
    WHERE ${GROUP_AWARD_FILTER} AND ${yearCond}`, params);
  return rows.map(r => r.id);
}

router.get('/manage/studio/:id/group-dancers', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const studio = req.studio;

  const routines = await db.all(`
    SELECT TRIM(a.performance_name) AS routine, IFNULL(e.year, 'Undated') AS year,
           COUNT(DISTINCT a.id) AS award_count,
           GROUP_CONCAT(DISTINCT IFNULL(e.name, 'Self-reported')) AS event_names
    FROM awards a LEFT JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ? AND TRIM(IFNULL(a.performance_name, '')) != ''
      AND LOWER(IFNULL(a.award_type, '')) NOT LIKE '%solo%'
      AND LOWER(IFNULL(a.category, '')) NOT LIKE '%solo%'
    GROUP BY TRIM(a.performance_name), e.year
    ORDER BY (e.year IS NULL), e.year DESC, TRIM(a.performance_name)
  `, [studio.id]);

  // Current cast per routine-year, one query for the whole page. Source
  // and status aggregates drive the provenance styling on the chips: the
  // director should SEE where each link came from (import vs their own
  // entry vs a dancer's claim awaiting their verification).
  const casts = await db.all(`
    SELECT TRIM(a.performance_name) AS routine, IFNULL(e.year, 'Undated') AS year,
           d.id AS dancer_id, d.name AS dancer_name, MAX(ds.label) AS label,
           GROUP_CONCAT(DISTINCT IFNULL(ad.source, 'import')) AS sources,
           GROUP_CONCAT(DISTINCT IFNULL(ad.status, 'imported')) AS statuses
    FROM awards a LEFT JOIN events e ON a.event_id = e.id
    JOIN award_dancers ad ON ad.award_id = a.id
    JOIN dancers d ON d.id = ad.dancer_id
    LEFT JOIN dancer_studios ds ON ds.dancer_id = d.id AND ds.studio_id = a.studio_id
    WHERE a.studio_id = ? AND TRIM(IFNULL(a.performance_name, '')) != ''
      AND LOWER(IFNULL(a.award_type, '')) NOT LIKE '%solo%'
      AND LOWER(IFNULL(a.category, '')) NOT LIKE '%solo%'
    GROUP BY TRIM(a.performance_name), e.year, d.id
    ORDER BY d.name
  `, [studio.id]);
  const castMap = {};
  for (const c of casts) {
    const key = c.routine + '|||' + c.year;
    const sources = (c.sources || '').split(',');
    const statuses = (c.statuses || '').split(',');
    // Most-authoritative source wins the label; a claim still entirely
    // pending (no verified/imported link) renders as pending.
    const source = sources.includes('studio_owner') ? 'studio_owner'
      : sources.includes('admin') ? 'admin'
      : sources.includes('dancer_claim') ? 'dancer_claim' : 'import';
    const pending = statuses.length > 0 && statuses.every(s => s === 'pending');
    (castMap[key] = castMap[key] || []).push({ id: c.dancer_id, name: c.dancer_name, label: c.label, source, pending });
  }
  routines.forEach(r => { r.cast = castMap[r.routine + '|||' + r.year] || []; });

  // Routines missing a cast first — that's the work to be done
  routines.sort((a, b) => (a.cast.length > 0) - (b.cast.length > 0));
  const doneCount = routines.filter(r => r.cast.length > 0).length;

  res.render('manage_studio_group_dancers', {
    studio, routines, doneCount,
    pageTitle: 'Group Routine Dancers'
  });
});

// Director's private tag for a roster dancer ("Senior Mia") — the
// human-readable disambiguator for same-name dancers on manage surfaces.
router.post('/manage/studio/:id/roster/:dancerId/label', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const label = String((req.body && req.body.label) || '').trim().slice(0, 40) || null;
  const r = await db.run('UPDATE dancer_studios SET label = ? WHERE dancer_id = ? AND studio_id = ?',
    [label, parseInt(req.params.dancerId, 10), req.studio.id]);
  if (!r.changes) return res.status(404).json({ error: 'Dancer is not on your roster' });
  res.json({ success: true, label });
});

// Phase 1: classify each pasted name against the roster — NO writes.
router.post('/manage/studio/:id/group-dancers/preview', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const { routine, year, names } = req.body || {};
  if (!routine || !year || typeof names !== 'string') return res.status(400).json({ error: 'Missing routine, year, or names' });

  const awardIds = await routineAwardIds(db, req.studio.id, routine, year);
  if (!awardIds.length) return res.status(404).json({ error: 'No awards found for this routine' });

  // Accept one-per-line, commas, or semicolons; dedupe case-insensitively
  const seen = new Set();
  const parsed = names.split(/[\n,;]+/).map(n => n.trim().replace(/\s+/g, ' ')).filter(Boolean)
    .filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 60);

  const results = [];
  for (const name of parsed) {
    const candidates = await db.all(`
      SELECT d.id, d.name, d.graduation_year, ds.label,
             (SELECT COUNT(DISTINCT a.id) FROM awards a
              LEFT JOIN award_dancers ad ON ad.award_id = a.id AND ad.dancer_id = d.id
              WHERE a.studio_id = ds.studio_id AND (ad.dancer_id = d.id OR a.dancer_id = d.id)) AS award_count,
             (SELECT IFNULL(MIN(e.year), '') || '–' || IFNULL(MAX(e.year), '')
              FROM awards a
              LEFT JOIN award_dancers ad ON ad.award_id = a.id AND ad.dancer_id = d.id
              JOIN events e ON a.event_id = e.id
              WHERE a.studio_id = ds.studio_id AND (ad.dancer_id = d.id OR a.dancer_id = d.id)) AS years
      FROM dancers d JOIN dancer_studios ds ON ds.dancer_id = d.id
      WHERE ds.studio_id = ? AND LOWER(d.name) = LOWER(?)
    `, [req.studio.id, name]);
    // Their recent routines — the detail a director actually recognizes
    // when award counts and years happen to coincide.
    for (const c of candidates) {
      const routines = await db.all(`
        SELECT a.performance_name AS pn
        FROM award_dancers ad JOIN awards a ON ad.award_id = a.id
        WHERE ad.dancer_id = ? AND a.studio_id = ? AND TRIM(IFNULL(a.performance_name, '')) != ''
        GROUP BY a.performance_name ORDER BY MAX(a.id) DESC LIMIT 3
      `, [c.id, req.studio.id]);
      c.recent_routines = routines.map(r => r.pn).join(' · ');
    }
    let status = 'new';
    if (candidates.length === 1) status = 'matched';
    else if (candidates.length > 1) status = 'ambiguous';
    results.push({ input: name, status, candidates });
  }

  res.json({ routine, year, awardCount: awardIds.length, results });
});

// Phase 2: apply the confirmed cast to every award of the routine-year.
router.post('/manage/studio/:id/group-dancers/apply', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const { routine, year, entries } = req.body || {};
  if (!routine || !year || !Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'Nothing to apply' });
  if (entries.length > 60) return res.status(400).json({ error: 'Too many dancers in one routine' });

  const awardIds = await routineAwardIds(db, req.studio.id, routine, year);
  if (!awardIds.length) return res.status(404).json({ error: 'No awards found for this routine' });

  let created = 0, linked = 0;
  for (const entry of entries) {
    const name = String(entry.name || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    let dancerId;
    if (entry.dancer_id === 'new') {
      const r = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [generateDancerId(name), name]);
      dancerId = r.lastID;
      await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [dancerId, req.studio.id]);
      created++;
    } else {
      // The chosen dancer must be on THIS studio's roster with this name —
      // an owner can never link someone else's dancer record.
      const ok = await db.get(`
        SELECT d.id FROM dancers d JOIN dancer_studios ds ON ds.dancer_id = d.id
        WHERE d.id = ? AND ds.studio_id = ? AND LOWER(d.name) = LOWER(?)
      `, [parseInt(entry.dancer_id, 10), req.studio.id, name]);
      if (!ok) return res.status(400).json({ error: `"${name}" doesn't match a dancer on your roster — refresh and try again.` });
      dancerId = ok.id;
    }
    for (const awardId of awardIds) {
      // Director re-adding overrides any earlier tombstoned removal
      await db.run('DELETE FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [awardId, dancerId]).catch(() => {});
      const r = await db.run("INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')", [awardId, dancerId]);
      linked += r.changes || 0;
    }
  }

  logStudioActivity(req.studio.id, 'group_cast_added', { dedupMinutes: 60 });
  res.json({ success: true, created, linked, awardCount: awardIds.length });
});

// Remove one dancer from a routine-year (links only — never dancer records).
router.post('/manage/studio/:id/group-dancers/remove', requireAuth, requireStudioOwner, async (req, res) => {
  const db = await openDb();
  const { routine, year, dancer_id } = req.body || {};
  if (!routine || !year || !dancer_id) return res.status(400).json({ error: 'Missing routine, year, or dancer' });
  const awardIds = await routineAwardIds(db, req.studio.id, routine, year);
  if (!awardIds.length) return res.status(404).json({ error: 'No awards found for this routine' });
  // Tombstone each removed pair so automated paths can't re-add them
  for (const awardId of awardIds) {
    await db.run("INSERT OR REPLACE INTO award_dancer_removals (award_id, dancer_id, source) VALUES (?, ?, 'studio_owner')",
      [awardId, parseInt(dancer_id, 10)]).catch(() => {});
  }
  const r = await db.run(
    `DELETE FROM award_dancers WHERE dancer_id = ? AND award_id IN (${awardIds.map(() => '?').join(',')})`,
    [parseInt(dancer_id, 10), ...awardIds]);
  res.json({ success: true, removed: r.changes || 0 });
});

// Navbar "Public View": the owner's studio page as visitors see it
router.get('/my-studio/public', requireAuth, async (req, res) => {
  const db = await openDb();
  const ownedStudio = await db.get('SELECT unique_id FROM studios WHERE owner_id = ? LIMIT 1', [req.session.user.id]);
  if (ownedStudio) {
    res.redirect(`/dance/studio/${ownedStudio.unique_id}`);
  } else {
    res.redirect('/dance');
  }
});

module.exports = router;
