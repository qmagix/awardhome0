const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { logStudioActivity } = require('../../utils/activity');
const { requireAuth } = require('../../middleware/auth');
const rateLimit = require('express-rate-limit');
const { generateDancerId } = require('../../utils.js');

router.get('/my-dancer', requireAuth, async (req, res) => {
  const db = await openDb();
  const ownedDancer = await db.get('SELECT id FROM dancers WHERE claimed_by_user_id = ? LIMIT 1', [req.session.user.id]);
  if (ownedDancer) {
    res.redirect(`/manage/dancer/${ownedDancer.id}`);
  } else {
    res.send(`<script>alert("You haven't claimed a dancer profile yet!"); window.location.href="/";</script>`);
  }
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

  res.render('manage_dancer', { dancer, studios, awards });
});


router.post('/manage/dancer/:id/update', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [req.params.id]);

  if (!dancer || (dancer.claimed_by_user_id !== req.session.user.id && req.session.user.role !== 'superadmin' && req.session.user.role !== 'admin')) {
    return res.status(403).send('Forbidden');
  }

  const { name, birthday, headshot_url, graduation_year, instagram_handle, tiktok_handle } = req.body;
  await db.run(`
    UPDATE dancers 
    SET name = ?, birthday = ?, headshot_url = ?, graduation_year = ?, instagram_handle = ?, tiktok_handle = ?
    WHERE id = ?
  `, [name, birthday || null, headshot_url || null, graduation_year || null, instagram_handle || null, tiktok_handle || null, req.params.id]);

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
