const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { logStudioActivity } = require('../../utils/activity');
const { requireAuth } = require('../../middleware/auth');
const { domainsMatch, approveStudioClaim, matchDancerClaimCode, notifyStudioOfProfileClaim, markContestedClaims, routeDancerClaim } = require('../../utils/claims');
const { sendEmail } = require('../../utils/mailer');
const { consumeHouseholdAction } = require('../../utils/submissions');
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
  const studio = await db.get('SELECT id, unique_id, name, is_claimed FROM studios WHERE unique_id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  res.render('claim_studio', { studio, pageTitle: `Claim ${studio.name}` });
});


router.post('/claim/studio/:id', requireAuth, async (req, res) => {
  const { contact_name, role, phone, studio_address, proof } = req.body;
  const db = await openDb();

  const studio = await db.get('SELECT * FROM studios WHERE unique_id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  const fail = (error) => res.status(400).render('claim_studio', { studio, error, pageTitle: `Claim ${studio.name}` });

  if (studio.is_claimed) {
    return res.render('claim_studio', { studio, error: 'Studio is already claimed.', pageTitle: `Claim ${studio.name}` });
  }
  if (!contact_name || !contact_name.trim()) return fail('Please enter your name.');
  if (!studio_address || !studio_address.trim()) return fail("Please enter your studio's address — it helps us tell same-named studios apart.");

  // Combine proof text
  const proof_text = `Contact: ${contact_name.trim()}\nRole: ${role}\nPhone: ${phone}\nStudio address: ${studio_address.trim()}\nDetails: ${proof}`;

  // Fast-Track Verification Logic (session emails are verified at login)
  const user = req.session.user;

  if (domainsMatch(studio.website_url, user.email)) {
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'pending']);
    await approveStudioClaim(db, { userId: user.id, studioId: studio.id });
    if (user.role === 'user') req.session.user.role = 'studio_owner';
    return res.send(`<script>alert("Congratulations! Your email domain matched the studio's website. Your claim has been auto-approved."); window.location.href="/dance/studio/${studio.unique_id}";</script>`);
  } else {
    // Normal pending claim
    await db.run('INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, ?, ?)', [user.id, studio.id, proof_text, 'pending']);
    return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly."); window.location.href="/dance/studio/${studio.unique_id}";</script>`);
  }
});


// One-page apply: creates the account AND files the claim together.
// Auto-approval deliberately waits for email verification (see auth.js).
router.post('/claim/studio/:id/apply', applyLimiter, async (req, res) => {
  const { contact_name, email, password, phone, role, studio_address, proof } = req.body || {};
  const db = await openDb();

  const studio = await db.get('SELECT * FROM studios WHERE unique_id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  const fail = (error) => res.status(400).render('claim_studio', { studio, error, pageTitle: `Claim ${studio.name}` });

  if (studio.is_claimed) return fail('This studio is already claimed.');
  if (!contact_name || !contact_name.trim()) return fail('Please enter your name.');
  if (!studio_address || !studio_address.trim()) return fail("Please enter your studio's address — it helps us tell same-named studios apart.");
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

  const proof_text = `Contact: ${contact_name.trim()}\nRole: ${role || ''}\nPhone: ${phone || ''}\nStudio address: ${studio_address.trim()}\nDetails: ${proof || ''}`;
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
  const dancer = await db.get('SELECT id, name, unique_id, is_claimed, suppressed_at FROM dancers WHERE id = ?', [req.params.id]);
  // Suppressed reads as nonexistent — this route takes the SEQUENTIAL id, so
  // without the guard it would be the walkable oracle that undoes the
  // profile page's 404 (utils/suppression.js). A family who needs to claim
  // a suppressed dancer is already talking to us: we suppressed it for them.
  if (!dancer || dancer.suppressed_at) return res.status(404).send('Dancer not found');
  res.render('claim_dancer', { dancer, pageTitle: `Claim ${dancer.name}` });
});


router.post('/claim/dancer/:id', requireAuth, async (req, res) => {
  const { relationship, proof, studio_code } = req.body || {};
  const db = await openDb();

  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer || dancer.suppressed_at) return res.status(404).send('Dancer not found');

  if (dancer.is_claimed) {
    return res.render('claim_dancer', { dancer, pageTitle: `Claim ${dancer.name}`, error: 'This dancer profile is already claimed.' });
  }

  // Per-household daily ceiling on dancer links. The IP limiter on the
  // anonymous apply route stops a burst; this stops one signed-in account
  // quietly claiming profile after profile, which is the shape that costs
  // reviewer time rather than bandwidth.
  const linkQuota = await consumeHouseholdAction(req.session.user.id, 'dancer_link', dancer.id);
  if (!linkQuota.ok) {
    return res.status(429).render('claim_dancer', {
      dancer, pageTitle: `Claim ${dancer.name}`,
      error: `That's ${linkQuota.limit} profile claims in 24 hours. Please come back tomorrow, or contact us if you manage more dancers than that.`,
    });
  }

  // Optional studio claim code: a match routes the claim to that studio's
  // director for confirmation; a mismatch is recorded as signal for the
  // admin reviewer (never silently dropped).
  const codeMatch = await matchDancerClaimCode(db, dancer.id, studio_code);
  const route = await routeDancerClaim(db, dancer.id, codeMatch);
  let proof_text = `Relationship: ${relationship || ''}\nDetails: ${proof || ''}`;
  if (codeMatch.provided) {
    proof_text += codeMatch.valid
      ? `\nStudio code: valid for ${codeMatch.studio.name}`
      : `\nStudio code: provided but did not match any of this dancer's studios`;
  }
  const user = req.session.user;

  // Route by COMPETENCE, not by paperwork: whether a code was supplied does
  // not change who is able to judge whether someone is a child's parent. The
  // director can; an AwardHome reviewer cannot. `route` was already computed
  // above and was previously discarded here — which meant a codeless claim
  // filed on the web went to AwardHome while the identical claim filed from
  // the app went to the studio. Same product decision, two behaviours.
  await db.run(
    'INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status, studio_id, code_valid) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, dancer.id, proof_text, 'pending', route.studioId, codeMatch.valid ? 1 : 0]);

  // A second household on the same dancer makes BOTH claims contested, and a
  // contested claim leaves the studio queue entirely — a director must never
  // be asked to choose between two families (design §6.9).
  const contest = await markContestedClaims(db, dancer.id);
  if (contest.contested) {
    return res.send(`<script>alert("Claim submitted. Someone else has also claimed this dancer, so the AwardHome team will sort it out directly rather than asking your studio to choose — we'll email you with the outcome."); window.location.href="/dancer/${dancer.unique_id}";</script>`);
  }

  if (route.routedTo === 'studio' && route.studio) {
    notifyStudioOfProfileClaim(db, {
      studio: route.studio, dancer,
      claimantEmail: user.email, relationship,
    });
    const who = JSON.stringify(route.studio.name).slice(1, -1);
    return res.send(`<script>alert("Claim submitted! ${who} can confirm it directly — they know which families belong to which dancers — and you'll get an email when they do."); window.location.href="/dancer/${dancer.unique_id}";</script>`);
  }
  if (route.routedTo === 'waiting_for_studio' && route.unclaimedStudio) {
    const who = JSON.stringify(route.unclaimedStudio.name).slice(1, -1);
    return res.send(`<script>alert("Claim submitted. ${who} hasn't claimed its studio page yet, so there is nobody there to confirm it — if you let your director know, they can claim the studio and approve you. In the meantime you can still record awards; they'll be submitted once your claim is approved."); window.location.href="/dancer/${dancer.unique_id}";</script>`);
  }
  return res.send(`<script>alert("Claim submitted successfully! Our admins will review your request shortly — you'll get an email with the decision."); window.location.href="/dancer/${dancer.unique_id}";</script>`);
});


// One-page apply: creates the account AND files the dancer claim together.
router.post('/claim/dancer/:id/apply', applyLimiter, async (req, res) => {
  const { contact_name, email, password, relationship, proof, studio_code } = req.body || {};
  const db = await openDb();

  const dancer = await db.get('SELECT id, name, unique_id, is_claimed, suppressed_at FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer || dancer.suppressed_at) return res.status(404).send('Dancer not found');
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

  const codeMatch = await matchDancerClaimCode(db, dancer.id, studio_code);
  let proof_text = `Contact: ${contact_name.trim()}\nRelationship: ${relationship}\nDetails: ${proof || ''}`;
  if (codeMatch.provided) {
    proof_text += codeMatch.valid
      ? `\nStudio code: valid for ${codeMatch.studio.name}`
      : `\nStudio code: provided but did not match any of this dancer's studios`;
  }
  await db.run('INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status, studio_id, code_valid) VALUES (?, ?, ?, ?, ?, ?)',
    [newUser.id, dancer.id, proof_text, 'pending', codeMatch.valid ? codeMatch.studio.id : null, codeMatch.valid ? 1 : 0]);

  if (codeMatch.valid) {
    notifyStudioOfProfileClaim(db, {
      studio: codeMatch.studio, dancer,
      claimantEmail: cleanEmail, relationship,
    });
  }

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
    success: codeMatch.valid
      ? `Almost there! We sent a verification link to ${cleanEmail}. Click it to activate your account — and since you used ${codeMatch.studio.name}'s claim code, your studio director can confirm your claim directly. You'll get an email when it's approved.`
      : `Almost there! We sent a verification link to ${cleanEmail}. Click it to activate your account — our team then reviews your claim to keep dancer profiles secure. You'll get an email with the decision.`
  });
});

// ---- Organizer claim via invitation token ----
// Deliberately NO public claim button on org pages: an "unclaimed" state
// would advertise which orgs aren't partnered yet. The only way in is the
// single-use link mailed in an invitation letter (utils/invites.js), so
// possession of the token is the whole authorization — no admin review.

const { ensureOrgInviteTables } = require('../../utils/invites');

async function loadOrgClaimToken(db, token) {
  await ensureOrgInviteTables(db);
  const row = await db.get(`
    SELECT t.*, o.name AS org_name, o.owner_id AS org_owner_id
    FROM org_claim_tokens t JOIN organizations o ON t.org_id = o.id
    WHERE t.token = ?`, [String(token || '')]);
  if (!row) return { error: 'This claim link is not valid. Check that the full link from your invitation email was copied, or reply to the email and we\'ll send a fresh one.' };
  if (row.org_owner_id) return { error: 'This organization has already been claimed. If that wasn\'t you, reply to your invitation email and we\'ll sort it out.', row };
  if (row.used_at) return { error: 'This claim link has already been used. Log in with the account you created, or reply to your invitation email for help.', row };
  if (new Date(row.expires_at) < new Date()) return { error: 'This claim link has expired. Reply to your invitation email and we\'ll send a fresh one.', row };
  return { row };
}

router.get('/claim/org/:token', async (req, res) => {
  const db = await openDb();
  const { row, error } = await loadOrgClaimToken(db, req.params.token);
  if (error) return res.status(410).render('claim_org', { error, orgName: row ? row.org_name : null, token: null, prefillEmail: null, user: req.session.user || null });
  res.render('claim_org', {
    error: null, orgName: row.org_name, token: req.params.token,
    prefillEmail: row.email, user: req.session.user || null
  });
});

router.post('/claim/org/:token', applyLimiter, async (req, res) => {
  const db = await openDb();
  const { row, error } = await loadOrgClaimToken(db, req.params.token);
  if (error) return res.status(410).render('claim_org', { error, orgName: row ? row.org_name : null, token: null, prefillEmail: null, user: req.session.user || null });
  const fail = (msg) => res.status(400).render('claim_org', {
    error: msg, orgName: row.org_name, token: req.params.token,
    prefillEmail: row.email, user: req.session.user || null
  });

  let user = req.session.user;
  if (!user) {
    const { email, password, password_confirm } = req.body || {};
    const cleanEmail = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return fail('Please enter a valid email address.');
    if (!password || password.length < 8) return fail('Password must be at least 8 characters.');
    if (password !== password_confirm) return fail('Passwords do not match.');

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(400).render('claim_org', {
        error: null, orgName: row.org_name, token: req.params.token,
        prefillEmail: cleanEmail, user: null,
        existingAccount: `An account with ${cleanEmail} already exists. Log in and you'll come straight back here to finish claiming.`
      });
    }

    // The token arrived at an inbox the superadmin chose — that is the
    // verification, so the account starts verified.
    const hash = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, 1)',
      [cleanEmail, hash, 'org_owner']);
    const newUser = await db.get('SELECT id, email, role FROM users WHERE email = ?', [cleanEmail]);
    req.session.user = { id: newUser.id, email: newUser.email, role: newUser.role };
    user = req.session.user;
  }

  await db.run('UPDATE organizations SET owner_id = ? WHERE id = ? AND owner_id IS NULL', [user.id, row.org_id]);
  const claimed = await db.get('SELECT owner_id FROM organizations WHERE id = ?', [row.org_id]);
  if (claimed.owner_id !== user.id) return fail('This organization was claimed by someone else just now. Reply to your invitation email and we\'ll sort it out.');
  await db.run('UPDATE org_claim_tokens SET used_at = CURRENT_TIMESTAMP, used_by = ? WHERE id = ?', [user.id, row.id]);

  res.redirect('/manage/org/' + row.org_id);
});

// ---- Delegated cast entry, public side (maybe_patentable §A9) ----
// The token IS the authorization: it opens exactly one routine-year of one
// studio, needs no account, and never writes dancer links directly — the
// helper's names stage as a submission the director reviews and credits.

const { ensureCastInviteTables } = require('../../utils/castInvites');

async function loadCastInvite(db, token) {
  await ensureCastInviteTables(db);
  const inv = await db.get(`
    SELECT i.*, s.name AS studio_name
    FROM routine_cast_invites i JOIN studios s ON s.id = i.studio_id
    WHERE i.token = ?`, [String(token || '')]);
  if (!inv) return { error: 'This link is not valid. Check that the full link from the email was copied.' };
  if (inv.revoked_at) return { error: 'This link was withdrawn by the studio. If you think that\'s a mistake, just reply to the email that brought you here.' };
  if (new Date(inv.expires_at) < new Date()) return { error: 'This link has expired. Reply to the email that brought you here and the studio can send a fresh one.' };
  return { inv };
}

async function castInviteEvents(db, inv) {
  const events = await db.all(`
    SELECT IFNULL(e.id, 0) AS event_id, IFNULL(e.name, 'Self-reported') AS event_name,
           COUNT(DISTINCT a.id) AS award_count
    FROM awards a LEFT JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ?
      AND IFNULL(a.performance_name_key, LOWER(TRIM(IFNULL(a.performance_name, '')))) = ?
      AND IFNULL(CAST(e.year AS TEXT), 'Undated') = ?
    GROUP BY e.id ORDER BY event_name`, [inv.studio_id, inv.routine_key, String(inv.year)]);
  // Existing named dancers per event, for context (these names are already
  // public on award pages once linked — no new disclosure).
  for (const ev of events) {
    const rows = await db.all(`
      SELECT DISTINCT d.name FROM award_dancers ad
      JOIN awards a ON a.id = ad.award_id JOIN dancers d ON d.id = ad.dancer_id
      WHERE d.suppressed_at IS NULL
        AND a.studio_id = ? AND IFNULL(a.event_id, 0) = ?
        AND IFNULL(a.performance_name_key, LOWER(TRIM(IFNULL(a.performance_name, '')))) = ?
      ORDER BY d.name`, [inv.studio_id, ev.event_id, inv.routine_key]);
    ev.known_dancers = rows.map(r => r.name);
  }
  return events;
}

// The helper's own earlier submissions on this link — shown on return
// visits so they can see what they already sent (and its status).
async function priorSubmissions(db, inviteId) {
  const rows = await db.all(`
    SELECT helper_name, payload, note, status, created_at
    FROM routine_cast_submissions WHERE invite_id = ? AND status != 'dismissed'
    ORDER BY created_at DESC`, [inviteId]);
  return rows.map(r => {
    let events = [];
    try { events = JSON.parse(r.payload); } catch (e) {}
    return { ...r, events };
  });
}

// Prefill: the latest submission's names land back in the input fields so
// a returning helper edits in place — adding or correcting — instead of
// wondering whether to retype (Q, 2026-08-30). Re-sending REPLACES the
// pending submission, so the studio always reviews one current version.
function buildPrefill(priorSubs) {
  const latest = priorSubs[0];
  const prefill = { names: {}, helperName: '', note: '' };
  if (!latest) return prefill;
  prefill.helperName = latest.helper_name || '';
  prefill.note = latest.note || '';
  for (const ev of latest.events) prefill.names[ev.event_id] = ev.names.join('\n');
  return prefill;
}

router.get('/cast/:token', async (req, res) => {
  const db = await openDb();
  const { inv, error } = await loadCastInvite(db, req.params.token);
  if (error) return res.status(410).render('cast_invite', { error, inv: null, events: [], priorSubs: [], prefill: buildPrefill([]), submitted: false, pageTitle: 'Cast entry' });
  const events = await castInviteEvents(db, inv);
  const priorSubs = await priorSubmissions(db, inv.id);
  res.render('cast_invite', { error: null, inv, events, priorSubs, prefill: buildPrefill(priorSubs), submitted: false, pageTitle: `Dancers of "${inv.routine_display}"` });
});

router.post('/cast/:token', applyLimiter, async (req, res) => {
  const db = await openDb();
  const { inv, error } = await loadCastInvite(db, req.params.token);
  if (error) return res.status(410).render('cast_invite', { error, inv: null, events: [], priorSubs: [], prefill: buildPrefill([]), submitted: false, pageTitle: 'Cast entry' });
  const events = await castInviteEvents(db, inv);
  const priorSubs = await priorSubmissions(db, inv.id);
  const fail = (msg) => res.status(400).render('cast_invite', { error: msg, inv, events, priorSubs, prefill: buildPrefill(priorSubs), submitted: false, pageTitle: `Dancers of "${inv.routine_display}"` });

  const helper = String((req.body && req.body.helper_name) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!helper) return fail('Please tell us your name — the studio wants to know who to thank!');
  const note = String((req.body && req.body.note) || '').trim().slice(0, 500) || null;

  const payload = [];
  for (const ev of events) {
    const raw = String((req.body && req.body['names_' + ev.event_id]) || '');
    const names = raw.split(/[\n,;]+/).map(n => n.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 60);
    if (names.length) payload.push({ event_id: ev.event_id, event_name: ev.event_name, names });
  }
  if (!payload.length) return fail('Add at least one dancer name before sending.');

  // An unreviewed submission is replaced, not duplicated — the studio
  // always sees one current version per link.
  const pending = await db.get(
    "SELECT id FROM routine_cast_submissions WHERE invite_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [inv.id]);
  if (pending) {
    await db.run(`UPDATE routine_cast_submissions
                  SET helper_name = ?, payload = ?, note = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [helper, JSON.stringify(payload), note, pending.id]);
  } else {
    await db.run(`INSERT INTO routine_cast_submissions (invite_id, helper_name, payload, note) VALUES (?, ?, ?, ?)`,
      [inv.id, helper, JSON.stringify(payload), note]);
  }
  logStudioActivity(inv.studio_id, 'cast_submission_received', { dedupMinutes: 5 });
  const priorSubs2 = await priorSubmissions(db, inv.id);
  res.render('cast_invite', { error: null, inv, events, priorSubs: priorSubs2, prefill: buildPrefill(priorSubs2), submitted: true, pageTitle: 'Thank you!' });
});

module.exports = router;
