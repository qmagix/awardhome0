const express = require('express');
const router = express.Router();
const { openDb } = require('../database');
const { logStudioActivity } = require('../utils/activity');
const { computeFeaturedStudios } = require('../utils/featured');
const { sendStudioInvite, buildStudioInvite } = require('../utils/invites');
const { invalidate } = require('../utils/cache');
const { requireAdmin, requireSuperadmin } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { runBackfillForEvent } = require('../backfill_utils');


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
  invalidate('dance-home');
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
    SELECT s.id, s.name, s.owner_id, u.email as owner_email, COUNT(a.id) as award_count
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
    marketingStudiosCount: marketingStudiosCount ? marketingStudiosCount.count : 0
  };

  const flaggedStudios = await db.all(`SELECT id, name FROM studios WHERE needs_investigation = 1 ORDER BY name`);
  const flaggedDancers = await db.all(`SELECT id, name, unique_id FROM dancers WHERE needs_investigation = 1 ORDER BY name`);
  const allStudios = await db.all(`SELECT id, name FROM studios ORDER BY name`);

  res.render('admin', { flaggedStudios, flaggedDancers, allStudios, stats });
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
    SELECT s.id, s.name, s.email, s.phone, s.is_claimed, COUNT(a.id) as award_count,
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


// Admin: Manage Orgs
router.get('/admin/orgs', requireAdmin, async (req, res) => {
  const db = await openDb();
  const orgs = await db.all(`
    SELECT o.*, COUNT(e.id) as event_count 
    FROM organizations o 
    LEFT JOIN events e ON o.id = e.org_id 
    GROUP BY o.id 
    ORDER BY o.name ASC
  `);
  res.render('admin_orgs', { orgs });
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
    SELECT sc.*, u.email as user_email, s.name as studio_name 
    FROM studio_claims sc
    JOIN users u ON sc.user_id = u.id
    JOIN studios s ON sc.studio_id = s.id
    WHERE sc.status = 'pending'
    ORDER BY sc.created_at DESC
  `);

  const dancerClaims = await db.all(`
    SELECT dc.*, u.email as user_email, d.name as dancer_name, d.unique_id as dancer_unique_id 
    FROM dancer_claims dc
    JOIN users u ON dc.user_id = u.id
    JOIN dancers d ON dc.dancer_id = d.id
    WHERE dc.status = 'pending'
    ORDER BY dc.created_at DESC
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


// Dancer Claims logic
router.post('/admin/claims/dancer/:id/approve', requireAdmin, async (req, res) => {
  const db = await openDb();
  const claim = await db.get('SELECT * FROM dancer_claims WHERE id = ?', [req.params.id]);
  if (!claim) return res.status(404).send('Claim not found');

  await db.run('UPDATE dancers SET is_claimed = 1, claimed_by_user_id = ? WHERE id = ?', [claim.user_id, claim.dancer_id]);
  await db.run('UPDATE dancer_claims SET status = "approved" WHERE id = ?', [claim.id]);

  const user = await db.get('SELECT role FROM users WHERE id = ?', [claim.user_id]);
  if (user && user.role === 'user') {
    await db.run('UPDATE users SET role = "dancer_owner" WHERE id = ?', [claim.user_id]);
  }

  res.redirect('/admin/claims');
});


router.post('/admin/claims/dancer/:id/reject', requireAdmin, async (req, res) => {
  const db = await openDb();
  await db.run('UPDATE dancer_claims SET status = "rejected" WHERE id = ?', [req.params.id]);
  res.redirect('/admin/claims');
});


// Admin Studio Drafts (Bootstrapped Info)
router.get('/admin/studio-drafts', requireAdmin, async (req, res) => {
  const db = await openDb();
  const drafts = await db.all(`
    SELECT d.*, s.name as current_name, s.address as current_address, s.phone as current_phone, s.email as current_email, s.website_url as current_website_url
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

  const categories = await db.all(`
    SELECT 
      a.category, 
      a.award_type, 
      a.place, 
      MAX(a.is_first_place) as is_first_place, 
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

    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('Error toggling is_first_place:', err);
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
