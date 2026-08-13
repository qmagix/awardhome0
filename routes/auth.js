const express = require('express');
const router = express.Router();
const { openDb } = require('../database');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendEmail } = require('../utils/mailer');
const { domainsMatch, approveStudioClaim } = require('../utils/claims');
const { BASE_URL } = require('../config');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many attempts from this IP, please try again after 15 minutes'
});

router.get('/register', (req, res) => res.render('register'));
router.post('/register', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const db = await openDb();

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    return res.render('register', { error: 'Email already registered' });
  }

  const hash = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO users (email, password_hash, verification_token, verification_token_expires) VALUES (?, ?, ?, ?)`,
    [email, hash, token, expires]
  );

  const verifyLink = `${BASE_URL}/verify-email?token=${token}`;

  if (process.env.EMAIL_PROVIDER) {
    const result = await sendEmail({
      to: email,
      subject: 'Verify your Dance Awards Account',
      html: `<p>Click here to verify: <a href="${verifyLink}">${verifyLink}</a></p>`
    });
    if (!result.success) {
      console.error("Failed to send verification email:", result.error);
    }
  } else {
    console.log(`[DEV MODE] Verification Link for ${email}: ${verifyLink}`);
  }

  res.render('register', { message: 'Registration successful! Please check your email to verify your account.' });
});


router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid token');

  const db = await openDb();
  const user = await db.get('SELECT id, verification_token_expires FROM users WHERE verification_token = ?', [token]);
  if (!user) return res.status(400).send('Invalid token');

  if (!user.verification_token_expires || new Date(user.verification_token_expires).getTime() < Date.now()) {
    const expired = await db.get('SELECT email FROM users WHERE id = ?', [user.id]);
    return res.status(400).render('login', {
      error: 'This verification link has expired. You can request a new one below.',
      showResend: true,
      prefillEmail: expired ? expired.email : ''
    });
  }

  await db.run('UPDATE users SET is_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?', [user.id]);

  // Now that the email is verified, run the domain fast-track on any
  // pending studio claims filed by this account.
  const verified = await db.get('SELECT id, email FROM users WHERE id = ?', [user.id]);
  const pendingClaims = await db.all(`
    SELECT sc.studio_id, st.website_url, st.name
    FROM studio_claims sc JOIN studios st ON st.id = sc.studio_id
    WHERE sc.user_id = ? AND sc.status = 'pending' AND st.is_claimed = 0
  `, [user.id]);

  let approvedName = null;
  let pendingName = null;
  for (const claim of pendingClaims) {
    if (domainsMatch(claim.website_url, verified.email)) {
      await approveStudioClaim(db, { userId: user.id, studioId: claim.studio_id });
      approvedName = claim.name;
    } else {
      pendingName = claim.name;
    }
  }

  // Dancer claims are always manually reviewed (no fast-track) — just
  // report the pending status.
  const pendingDancer = await db.get(`
    SELECT d.name FROM dancer_claims dc JOIN dancers d ON d.id = dc.dancer_id
    WHERE dc.user_id = ? AND dc.status = 'pending' LIMIT 1
  `, [user.id]);

  let msg = 'Email verified! Log in below.';
  if (approvedName) msg = `Email verified — and your claim for ${approvedName} was auto-approved (your email domain matches the studio website). Log in to manage your studio.`;
  else if (pendingName) msg = `Email verified! Your claim for ${pendingName} is now awaiting admin review — log in to check its status.`;
  else if (pendingDancer) msg = `Email verified! Your claim for ${pendingDancer.name}'s profile is now awaiting review — our team checks every dancer claim to keep profiles secure. Log in to check its status.`;
  res.render('login', { message: msg });
});


router.get('/login', (req, res) => res.render('login', {
  next: typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : null
}));
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const db = await openDb();

  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('login', { error: 'Invalid credentials' });
  }

  if (!user.is_verified) {
    return res.render('login', {
      error: 'Please verify your email first.',
      showResend: true,
      prefillEmail: email
    });
  }

  req.session.user = { id: user.id, email: user.email, role: user.role };

  const nextUrl = typeof req.body.next === 'string' && req.body.next.startsWith('/') ? req.body.next : null;
  if (nextUrl) return res.redirect(nextUrl);

  if (user.role === 'admin' || user.role === 'superadmin') {
    return res.redirect('/admin');
  }

  const ownedStudio = await db.get('SELECT id FROM studios WHERE owner_id = ? LIMIT 1', [user.id]);
  if (ownedStudio) {
    return res.redirect(`/dance/studio/${ownedStudio.id}`);
  }
  const ownedOrg = await db.get('SELECT id FROM organizations WHERE owner_id = ? LIMIT 1', [user.id]);
  if (ownedOrg) {
    return res.redirect(`/manage/org/${ownedOrg.id}`);
  }
  // Parents/dancers: anyone with a claimed dancer OR a claim in flight
  // lands on the My Dancers dashboard (shows claim status too — a parent
  // with only a pending claim previously landed on the generic homepage
  // with no sign their claim existed).
  const dancerTie = await db.get(`
    SELECT 1 FROM dancers WHERE claimed_by_user_id = ?
    UNION SELECT 1 FROM dancer_claims WHERE user_id = ? LIMIT 1
  `, [user.id, user.id]);
  if (dancerTie) {
    return res.redirect('/my-dancers');
  }
  res.redirect('/');
});


router.post('/resend-verification', authLimiter, async (req, res) => {
  const { email } = req.body;
  const genericMessage = 'If an unverified account exists for that email, a new verification link has been sent.';
  if (!email) return res.render('login', { message: genericMessage });

  const db = await openDb();
  const user = await db.get('SELECT id, is_verified FROM users WHERE email = ?', [email]);

  if (user && !user.is_verified) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db.run('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?', [token, expires, user.id]);

    const verifyLink = `${BASE_URL}/verify-email?token=${token}`;
    if (process.env.EMAIL_PROVIDER) {
      const result = await sendEmail({
        to: email,
        subject: 'Verify your Dance Awards Account',
        html: `<p>Click here to verify: <a href="${verifyLink}">${verifyLink}</a></p>`
      });
      if (!result.success) {
        console.error("Failed to send verification email:", result.error);
      }
    } else {
      console.log(`[DEV MODE] Verification Link for ${email}: ${verifyLink}`);
    }
  }

  res.render('login', { message: genericMessage });
});


router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});


router.get('/login/impersonate/:token', async (req, res) => {
  const db = await openDb();
  const record = await db.get('SELECT * FROM impersonation_tokens WHERE token = ?', [req.params.token]);

  if (!record) {
    return res.status(400).send('Invalid or expired impersonation link.');
  }

  // Delete the token so it can only be used once
  await db.run('DELETE FROM impersonation_tokens WHERE token = ?', [req.params.token]);

  // Check expiration (e.g., 1 hour)
  const created = new Date(record.created_at).getTime();
  if (Date.now() - created > 60 * 60 * 1000) {
    return res.status(400).send('This impersonation link has expired.');
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [record.target_user_id]);
  if (!user) return res.status(404).send('User not found.');

  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.redirect(record.target_url);
});

module.exports = router;
