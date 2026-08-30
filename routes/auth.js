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

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect(roleHome(req.session.user));
  res.render('register');
});
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


// Already-signed-in visitors to /login or /register get routed home by
// role instead of being re-prompted (re-showing a login form to a logged-in
// user reads as a bug and invites accidental session switches).
function roleHome(user) {
  if (user.role === 'admin' || user.role === 'superadmin') return '/admin';
  if (user.role === 'org_owner') return '/my-org';
  if (user.role === 'studio_owner') return '/my-studio';
  return '/my-dancers';
}

// Lightweight account/profile page: identity + recorded agreements —
// separate from the working dashboards, linked from the navbar dropdown.
router.get('/account', async (req, res) => {
  if (!req.session.user) return res.redirect('/login?next=/account');
  const db = await openDb();
  const account = await db.get('SELECT email, role, created_at FROM users WHERE id = ?', [req.session.user.id]);
  let orgTerms = [];
  try {
    orgTerms = await db.all(
      'SELECT name, branding_terms_accepted_at FROM organizations WHERE owner_id = ?',
      [req.session.user.id]);
  } catch (e) { /* column pre-migrate */ }
  let photoConsents = [];
  try {
    photoConsents = await db.all(`
      SELECT d.name, c.consented_at FROM card_photo_consents c
      JOIN dancers d ON d.id = c.dancer_id WHERE c.user_id = ?`,
      [req.session.user.id]);
  } catch (e) { /* table pre-migrate */ }
  res.render('account', { user: req.session.user, account, orgTerms, photoConsents });
});

router.get('/login', (req, res) => {
  const nextUrl = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : null;
  if (req.session.user) return res.redirect(nextUrl || roleHome(req.session.user));
  res.render('login', { next: nextUrl });
});
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

  const ownedStudio = await db.get('SELECT unique_id FROM studios WHERE owner_id = ? LIMIT 1', [user.id]);
  if (ownedStudio) {
    return res.redirect(`/dance/studio/${ownedStudio.unique_id}`);
  }
  const ownedOrg = await db.get('SELECT id FROM organizations WHERE owner_id = ? LIMIT 1', [user.id]);
  if (ownedOrg) {
    return res.redirect(`/manage/org/${ownedOrg.id}`);
  }
  // A studio claim still in review: land the claimant on their studio's
  // page (which shows them a "verification pending" banner) rather than
  // the generic homepage or the parent/dancer flow — a claimant with no
  // signal that their claim exists assumes it was lost.
  const pendingStudioClaim = await db.get(`
    SELECT s.unique_id FROM studio_claims sc JOIN studios s ON s.id = sc.studio_id
    WHERE sc.user_id = ? AND sc.status = 'pending' ORDER BY sc.id DESC LIMIT 1`,
    [user.id]);
  if (pendingStudioClaim) {
    return res.redirect(`/dance/studio/${pendingStudioClaim.unique_id}`);
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


// ---- Password reset ----
// Families and studio directors lock themselves out; without this the only
// recovery is a support email and a hand-edited DB row. Rules: the emailed
// token is random and stored ONLY as a SHA-256 hash, expires in 1 hour, is
// single-use, and the request endpoint always answers identically so it
// can't be used to discover which emails have accounts.

const RESET_TTL_MS = 60 * 60 * 1000;
const hashResetToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

router.get('/forgot-password', (req, res) => {
  res.render('forgot_password', { sent: false, error: null, pageTitle: 'Reset your password' });
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();
  const db = await openDb();
  // Same response either way — no account enumeration.
  const done = () => res.render('forgot_password', { sent: true, error: null, pageTitle: 'Reset your password' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('forgot_password', { sent: false, error: 'Please enter a valid email address.', pageTitle: 'Reset your password' });
  }

  const user = await db.get('SELECT id, email FROM users WHERE email = ?', [email]);
  if (!user) return done();

  const token = crypto.randomBytes(32).toString('hex');
  await db.run('UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?',
    [hashResetToken(token), new Date(Date.now() + RESET_TTL_MS).toISOString(), user.id]);

  const link = `${BASE_URL}/reset-password/${token}`;
  if (process.env.EMAIL_PROVIDER) {
    const result = await sendEmail({
      to: user.email,
      subject: 'Reset your AwardHome password',
      html: `<p>Hi,</p>
        <p>Someone (hopefully you) asked to reset the password for your AwardHome account.</p>
        <p><a href="${link}">Choose a new password</a></p>
        <p>This link works once and expires in an hour. If you didn't ask for it, you can ignore
        this email — your password stays as it is.</p>`,
    });
    if (!result.success) console.error('Failed to send password reset email:', result.error);
  } else {
    console.log(`[DEV MODE] Password reset link for ${user.email}: ${link}`);
  }
  return done();
});

async function userForResetToken(db, token) {
  if (!token) return null;
  return db.get(
    'SELECT id, email FROM users WHERE reset_token_hash = ? AND reset_token_expires > ?',
    [hashResetToken(token), new Date().toISOString()]);
}

router.get('/reset-password/:token', async (req, res) => {
  const db = await openDb();
  const user = await userForResetToken(db, req.params.token);
  if (!user) {
    return res.status(410).render('reset_password', {
      expired: true, token: null, error: null, pageTitle: 'Reset your password' });
  }
  res.render('reset_password', { expired: false, token: req.params.token, error: null, pageTitle: 'Reset your password' });
});

router.post('/reset-password/:token', authLimiter, async (req, res) => {
  const db = await openDb();
  const user = await userForResetToken(db, req.params.token);
  if (!user) {
    return res.status(410).render('reset_password', {
      expired: true, token: null, error: null, pageTitle: 'Reset your password' });
  }
  const { password, password_confirm } = req.body || {};
  const fail = (error) => res.status(400).render('reset_password', {
    expired: false, token: req.params.token, error, pageTitle: 'Reset your password' });
  if (!password || password.length < 8) return fail('Password must be at least 8 characters.');
  if (password !== password_confirm) return fail('Those passwords do not match.');

  const hash = await bcrypt.hash(password, 10);
  // Clicking the emailed link proves control of the address, so a reset
  // also verifies the account — otherwise an unverified user who forgot
  // their password would still be stuck after resetting it.
  await db.run(
    'UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL, is_verified = 1 WHERE id = ?',
    [hash, user.id]);

  // Drop any existing session so an attacker's stolen session can't survive
  // the password change; the owner signs in fresh below.
  req.session.regenerate(() => {
    res.render('login', { next: null, message: 'Your password is updated — sign in with it below.' });
  });
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
