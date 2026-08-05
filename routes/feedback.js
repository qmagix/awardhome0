const express = require('express');
const router = express.Router();
const { openDb } = require('../database');
const { requireAuth } = require('../middleware/auth');


// --- Feedback Routes ---

router.post('/api/feedback', requireAuth, async (req, res) => {
  const { type, message, page_url } = req.body;
  if (!type || !message) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const db = await openDb();
    await db.run(
      'INSERT INTO feedback (user_id, type, message, page_url, status) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, type, message, page_url || '', 'new']
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error inserting feedback:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.get('/my-feedback', requireAuth, async (req, res) => {
  try {
    const db = await openDb();
    const feedbackList = await db.all('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
    res.render('my_feedback', { user: req.session.user, feedbackList });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
