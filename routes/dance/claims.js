const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { logStudioActivity } = require('../../utils/activity');
const { requireAuth } = require('../../middleware/auth');
const { domainsMatch, approveStudioClaim } = require('../../utils/claims');
const { sendEmail } = require('../../utils/mailer');
const { BASE_URL } = require('../../config');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts from this IP, please try again later'
});


// Public: anonymous visitors get the one-page apply form (account +
// claim in one submit); logged-in users get the short claim form.
router.get('/claim/studio/:id', async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT id, name, is_claimed FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  res.render('claim_studio', { studio, pageTitle: `Claim ${studio.name}` });
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

  // Fast-Track Verification Logic (session emails are verified at login)
  const user = req.session.user;

  if (domainsMatch(studio.website_url, user.email)) {
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'pending']);
    await approveStudioClaim(db, { userId: user.id, studioId: studio.id });
    if (user.role === 'user') req.session.user.role = 'studio_owner';
    return res.send(`<script>alert("Congratulations! Your email domain matched the studio's website. Your claim has been auto-approved."); window.location.href="/dance/studio/${studio.id}";</script>`);
  } else {
    // Normal pending claim
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'pending']);
    return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly."); window.location.href="/dance/studio/${studio.id}";</script>`);
  }
});


// One-page apply: creates the account AND files the claim together.
// Auto-approval deliberately waits for email verification (see auth.js).
router.post('/claim/studio/:id/apply', applyLimiter, async (req, res) => {
  const { contact_name, email, password, phone, role, proof } = req.body || {};
  const db = await openDb();

  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  const fail = (error) => res.status(400).render('claim_studio', { studio, error, pageTitle: `Claim ${studio.name}` });

  if (studio.is_claimed) return fail('This studio is already claimed.');
  if (!contact_name || !contact_name.trim()) return fail('Please enter your name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail('Please enter a valid email address.');
  if (!password || password.length < 8) return fail('Password must be at least 8 characters.');

  const cleanEmail = email.trim();
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
  if (existing) {
    return res.status(400).render('claim_studio', {
      studio, pageTitle: `Claim ${studio.name}`,
      error: 'An account with this email already exists — log in below to continue your claim.',
      showLogin: true
    });
  }

  const hash = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    'INSERT INTO users (email, password_hash, verification_token, verification_token_expires) VALUES (?, ?, ?, ?)',
    [cleanEmail, hash, token, expires]
  );
  const newUser = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);

  const proof_text = `Contact: ${contact_name.trim()}\nRole: ${role || ''}\nPhone: ${phone || ''}\nDetails: ${proof || ''}`;
  await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)',
    [newUser.id, studio.id, proof_text, 'pending']);

  const verifyLink = `${BASE_URL}/verify-email?token=${token}`;
  if (process.env.EMAIL_PROVIDER) {
    const result = await sendEmail({
      to: cleanEmail,
      subject: `Verify your email to claim ${studio.name} on AwardHome`,
      html: `<p>Hi ${contact_name.trim()},</p>
        <p>One step left to claim <strong>${studio.name}</strong>: verify this email address.</p>
        <p><a href="${verifyLink}">Verify my email</a></p>
        <p>If your email domain matches your studio's website, your claim is approved instantly on verification. Otherwise our team will review it shortly.</p>`
    });
    if (!result.success) console.error('Failed to send claim verification email:', result.error);
  } else {
    console.log(`[DEV MODE] Claim verification link for ${cleanEmail}: ${verifyLink}`);
  }

  res.render('claim_studio', {
    studio, pageTitle: `Claim ${studio.name}`,
    success: `Almost there! We sent a verification link to ${cleanEmail}. Click it to finish your claim — if your email domain matches your studio's website, approval is instant.`
  });
});


// Public: anonymous visitors get the one-page apply form (account +
// claim in one submit); logged-in users get the short claim form.
// Unlike studios there is no domain fast-track — every dancer claim is
// manually reviewed (child-safety: an email domain proves nothing here).
router.get('/claim/dancer/:id', async (req, res) => {
  const db = await openDb();
  const dancer = await db.get('SELECT id, name, unique_id, is_claimed FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) return res.status(404).send('Dancer not found');
  res.render('claim_dancer', { dancer, pageTitle: `Claim ${dancer.name}` });
});


router.post('/claim/dancer/:id', requireAuth, async (req, res) => {
  const { relationship, proof } = req.body || {};
  const db = await openDb();

  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) return res.status(404).send('Dancer not found');

  if (dancer.is_claimed) {
    return res.render('claim_dancer', { dancer, pageTitle: `Claim ${dancer.name}`, error: 'This dancer profile is already claimed.' });
  }

  const proof_text = `Relationship: ${relationship || ''}\nDetails: ${proof || ''}`;
  const user = req.session.user;

  await db.run('INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, dancer.id, proof_text, 'pending']);
  return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly."); window.location.href="/dancer/${dancer.unique_id}";</script>`);
});


// One-page apply: creates the account AND files the dancer claim together.
router.post('/claim/dancer/:id/apply', applyLimiter, async (req, res) => {
  const { contact_name, email, password, relationship, proof } = req.body || {};
  const db = await openDb();

  const dancer = await db.get('SELECT id, name, unique_id, is_claimed FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) return res.status(404).send('Dancer not found');
  const fail = (error) => res.status(400).render('claim_dancer', { dancer, error, pageTitle: `Claim ${dancer.name}` });

  if (dancer.is_claimed) return fail('This dancer profile is already claimed.');
  if (!contact_name || !contact_name.trim()) return fail('Please enter your name.');
  if (!relationship) return fail('Please select your relationship to the dancer.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail('Please enter a valid email address.');
  if (!password || password.length < 8) return fail('Password must be at least 8 characters.');

  const cleanEmail = email.trim();
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
  if (existing) {
    return res.status(400).render('claim_dancer', {
      dancer, pageTitle: `Claim ${dancer.name}`,
      error: 'An account with this email already exists — log in below to continue your claim.',
      showLogin: true
    });
  }

  const hash = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    'INSERT INTO users (email, password_hash, verification_token, verification_token_expires) VALUES (?, ?, ?, ?)',
    [cleanEmail, hash, token, expires]
  );
  const newUser = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);

  const proof_text = `Contact: ${contact_name.trim()}\nRelationship: ${relationship}\nDetails: ${proof || ''}`;
  await db.run('INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status) VALUES (?, ?, ?, ?)',
    [newUser.id, dancer.id, proof_text, 'pending']);

  const verifyLink = `${BASE_URL}/verify-email?token=${token}`;
  if (process.env.EMAIL_PROVIDER) {
    const result = await sendEmail({
      to: cleanEmail,
      subject: `Verify your email to claim ${dancer.name}'s profile on AwardHome`,
      html: `<p>Hi ${contact_name.trim()},</p>
        <p>One step left to claim the profile for <strong>${dancer.name}</strong>: verify this email address.</p>
        <p><a href="${verifyLink}">Verify my email</a></p>
        <p>After verification our team reviews every dancer claim to keep profiles secure — you'll hear from us shortly.</p>`
    });
    if (!result.success) console.error('Failed to send claim verification email:', result.error);
  } else {
    console.log(`[DEV MODE] Claim verification link for ${cleanEmail}: ${verifyLink}`);
  }

  res.render('claim_dancer', {
    dancer, pageTitle: `Claim ${dancer.name}`,
    success: `Almost there! We sent a verification link to ${cleanEmail}. Click it to activate your account — our team then reviews your claim to keep dancer profiles secure.`
  });
});

module.exports = router;
