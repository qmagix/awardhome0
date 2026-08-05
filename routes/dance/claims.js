const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { requireAuth } = require('../../middleware/auth');


router.get('/claim/studio/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT id, name FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  res.render('claim_studio', { studio });
});


router.post('/claim/studio/:id', requireAuth, async (req, res) => {
  const { role, phone, proof } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

  if (studio.is_claimed) {
    return res.render('claim_studio', { studio, error: 'Studio is already claimed.' });
  }

  // Combine proof text
  const proof_text = `Role: ${role}\nPhone: ${phone}\nDetails: ${proof}`;

  // Fast-Track Verification Logic
  const user = req.session.user;
  let autoApproved = false;

  if (studio.website_url) {
    try {
      const studioDomain = new URL(studio.website_url.startsWith('http') ? studio.website_url : `https://${studio.website_url}`).hostname.replace(/^www\./i, '').toLowerCase();
      const userDomain = user.email.split('@')[1].toLowerCase();
      if (studioDomain === userDomain) {
        autoApproved = true;
      }
    } catch (e) {
      console.error("Domain parsing error:", e);
    }
  }

  if (autoApproved) {
    await db.run('UPDATE studios SET is_claimed = 1, owner_id = ? WHERE id = ?', [user.id, studio.id]);
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'approved']);

    // Make user a studio_owner if they are just a user
    if (user.role === 'user') {
      await db.run('UPDATE users SET role = ? WHERE id = ?', ['studio_owner', user.id]);
      req.session.user.role = 'studio_owner';
    }

    return res.send(`<script>alert("Congratulations! Your email domain matched the studio's website. Your claim has been auto-approved."); window.location.href="/studio/${studio.id}";</script>`);
  } else {
    // Normal pending claim
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'pending']);
    return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly."); window.location.href="/studio/${studio.id}";</script>`);
  }
});


router.get('/claim/dancer/:id', requireAuth, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT id, name, unique_id, is_claimed FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) return res.status(404).send('Dancer not found');
  res.render('claim_dancer', { dancer, error: null });
});


router.post('/claim/dancer/:id', requireAuth, async (req, res) => {
  const { relationship, proof } = req.body;
  const db = await openDb();

  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) return res.status(404).send('Dancer not found');

  if (dancer.is_claimed) {
    return res.render('claim_dancer', { dancer, error: 'Dancer is already claimed.' });
  }

  const proof_text = `Relationship: ${relationship}\nDetails: ${proof}`;
  const user = req.session.user;

  await db.run('INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, dancer.id, proof_text, 'pending']);
  return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly."); window.location.href="/dancer/${dancer.unique_id}";</script>`);
});

module.exports = router;
