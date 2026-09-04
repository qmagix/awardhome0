// /api/v1/mobile — the versioned JSON API the Expo client will consume
// (mobile design v2 §9, development plan M5).
//
// MOUNT POSITION IS PART OF THE CONTRACT. server.js mounts this router after
// express.json() and BEFORE the session middleware, the CSRF middleware, and
// the private-beta gate. Each of those is deliberate:
//
//   before session  — a bearer-authenticated request has no reason to create
//                     a session row, and a native client will never send the
//                     cookie back anyway
//   before CSRF     — CSRF defends against a browser attaching an AMBIENT
//                     credential to a cross-site request. A bearer token is
//                     not ambient: nothing attaches it automatically, so
//                     there is nothing to forge. Skipping the check here is
//                     not a hole, it is the check not applying
//   outside beta    — the app ships to invited families through TestFlight
//                     and internal builds, which is its own gate
//
// This is the only milestone that touches middleware order (plan §10), and
// the authenticated route audit is the check on it.
//
// GUESTS ARE FIRST-CLASS. Read endpoints that mirror a PUBLIC web page work
// with no token at all, so a parent can search for their dancer and see the
// trophy case before deciding whether to make an account.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { openDb } = require('../../database');
const { openSubmissionsDb } = require('../../utils/submissionsDb');
const {
  requestCode, verifyCode, refreshSession, revokeSession, listSessions,
  registerDevice, attachBearer, requireBearer,
} = require('../../utils/mobileAuth');
const {
  GROUP_SIZES, validateSubmission, createSubmission, listForDancer,
  castForSubmissions, normalizeText, consumeHouseholdAction, dancerStudios,
} = require('../../utils/submissions');
const { runAutoPromotion, REASON_TEXT } = require('../../utils/promotion');
const { findEventOptions } = require('../../utils/eventPicker');
const {
  LIFECYCLE, cleanCandidateInput, findDuplicateCandidates, createCandidate,
} = require('../../utils/eventCandidates');
const { CORRECTABLE_FIELDS, CORRECTION_REASON_TEXT, canPropose, propose } = require('../../utils/corrections');
const {
  markContestedClaims, matchDancerClaimCode, domainsMatch, approveStudioClaim,
  routeDancerClaim, notifyStudioOfProfileClaim, householdStanding,
} = require('../../utils/claims');
const { studioDisplayNameSql, excludeIndependentSql } = require('../../utils/independents');
const { notSuppressedSql } = require('../../utils/suppression');
const { formatPlacement } = require('../../utils/format');
const { sniff, stripMetadata, newObjectKey, currentDriver } = require('../../utils/evidence');
const { issueGrant, storeEvidence, canServe, readEvidence, MAX_BYTES } = require('../../utils/evidence');
const { openSession, sessionContext } = require('../../utils/eventSessions');
const { flagOn } = require('../../utils/featureFlags');
const openapi = require('../../docs/openapi_mobile.json');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 50;

const fail = (res, status, error, message) => res.status(status).json({ error, message });

// ---- CORS, for browser clients only ----------------------------------------
//
// Native clients never need this: CORS is a browser rule. But `expo start
// --web` serves the app from localhost:8081 and calls this API on another
// origin, and without these headers the browser discards a perfectly good 200
// and the app reports "we couldn't reach AwardHome".
//
// Safe here in a way it would NOT be on the session-authenticated web app:
// this API carries no cookie, so there is no ambient credential for a hostile
// page to ride. That is also why `Access-Control-Allow-Credentials` is
// deliberately absent — setting it would invite exactly the attack that its
// absence prevents.
//
// Policy, least-privilege by default:
//   MOBILE_API_CORS_ORIGINS   comma-separated allowlist; always honoured
//   unset + not production    any origin (local development convenience)
//   unset + production        no CORS headers at all — nothing is deployed as
//                             a browser client, and native clients don't care
const CORS_ALLOWLIST = (process.env.MOBILE_API_CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const CORS_OPEN_IN_DEV = CORS_ALLOWLIST.length === 0 && process.env.NODE_ENV !== 'production';

router.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && (CORS_OPEN_IN_DEV || CORS_ALLOWLIST.includes(origin))) {
    res.set('Access-Control-Allow-Origin', origin);
    // The response varies by Origin, so a cache must not serve one origin's
    // response to another.
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Upload-Grant');
    res.set('Access-Control-Max-Age', '600');
  }
  // Preflight must answer before anything that could require a token: the
  // browser sends OPTIONS with no Authorization header by design.
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Every response is JSON, including the ones Express would otherwise render as
// an HTML error page.
router.use(express.json({ limit: '1mb' }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(attachBearer);

// Sending mail costs money and annoys people; verifying costs a database read.
// Two different limits for two different risks.
const codeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many sign-in requests. Please try again later.'),
});
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many attempts. Please try again later.'),
});

// The published contract. Serving it from the app guarantees it ships with the
// code that implements it rather than drifting in a wiki.
router.get('/openapi.json', (req, res) => res.json(openapi));

// ---- Auth ------------------------------------------------------------------

router.post('/auth/request-code', codeLimiter, async (req, res) => {
  const result = await requestCode((req.body || {}).email);
  // Always 200, always the same shape: whether an address has an account is
  // not something an unauthenticated caller gets to learn.
  res.json({
    ok: true,
    expiresInMinutes: require('../../utils/mobileAuth').CODE_TTL_MIN,
    ...(result.devMode ? { devMode: true } : {}),
    ...(result.devCode ? { devCode: result.devCode } : {}),
  });
});

router.post('/auth/verify', verifyLimiter, async (req, res) => {
  const { email, code, device_label: deviceLabel, platform } = req.body || {};
  const result = await verifyCode(email, code, { deviceLabel, platform });
  if (!result.ok) {
    return fail(res, 401, result.reason,
      result.reason === 'too_many_attempts'
        ? 'Too many tries with that code. Please request a new one.'
        : 'That code is not valid. Please check it or request a new one.');
  }
  res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    // A first-time address gets an account here rather than being sent to the
    // website to make one — the code already proved she controls it.
    isNewAccount: !!result.isNewAccount,
    user: { id: result.user.id, email: result.user.email },
  });
});

router.post('/auth/refresh', verifyLimiter, async (req, res) => {
  const result = await refreshSession((req.body || {}).refresh_token);
  if (!result.ok) {
    // A reused refresh token has already revoked the session by the time we
    // get here — the client must sign in again, which is the point.
    return fail(res, 401, result.reason,
      result.reason === 'token_reuse'
        ? 'This session was ended for security. Please sign in again.'
        : 'Please sign in again.');
  }
  res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken, expiresIn: result.expiresIn });
});

// Revoke this device, or every device on the account. `all` is what a lost
// phone needs, and it takes effect on the very next request — there is no
// token cache to wait out.
router.post('/auth/revoke', requireBearer, async (req, res) => {
  const all = !!(req.body || {}).all;
  const result = await revokeSession({
    sessionId: all ? null : req.mobileSession.id,
    userId: req.mobileUser.id,
    all,
  });
  res.json({ ok: true, revoked: result.revoked });
});

router.get('/auth/sessions', requireBearer, async (req, res) => {
  res.json({ sessions: await listSessions(req.mobileUser.id) });
});

// ---- Dancers (public reads) ------------------------------------------------

router.get('/dancers/search', async (req, res) => {
  const q = normalizeText(req.query.q);
  if (!q || q.length < 2) return res.json({ dancers: [] });
  const db = await openDb();
  const dancers = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.is_claimed,
      (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS award_count,
      (SELECT GROUP_CONCAT(${studioDisplayNameSql('s2')}, ', ') FROM dancer_studios ds
        JOIN studios s2 ON s2.id = ds.studio_id WHERE ds.dancer_id = d.id) AS studios
    FROM dancers d
    WHERE d.name LIKE ? AND COALESCE(d.hide_from_search, 0) = 0
      AND ${notSuppressedSql('d')}
    ORDER BY award_count DESC
    LIMIT 25`, [`%${q}%`]);
  res.json({ dancers });
});

// The trophy case. Public, because the web page is — but it honours the same
// per-card hide the owner controls there.
//
// SYNC. `cursor` is an opaque "<year>:<id>" keyset position (see below).
// `updated_since` is derived from
// the two timestamps that actually exist — when the dancer's link was made and
// when the fact last changed — because `awards` has no updated_at and putting
// a trigger on a 900k-row table's UPDATE path would tax every import for the
// benefit of a sync protocol. Consequence, stated plainly: an importer editing
// an award without writing provenance will not move its marker.
router.get('/dancers/:id/awards', async (req, res) => {
  const db = await openDb();
  const dancer = await db.get(
    'SELECT id, unique_id, name, is_claimed, claimed_by_user_id, suppressed_at FROM dancers WHERE unique_id = ? OR id = ?',
    [req.params.id, parseInt(req.params.id, 10) || -1]);
  if (!dancer) return fail(res, 404, 'not_found', 'No such dancer.');
  // Safety-suppressed (utils/suppression.js): indistinguishable from
  // nonexistent to everyone EXCEPT the owning household — suppression
  // protects the family, so it must not lock them out of their own record.
  if (dancer.suppressed_at &&
      !(req.mobileUser && dancer.claimed_by_user_id === req.mobileUser.id)) {
    return fail(res, 404, 'not_found', 'No such dancer.');
  }

  // MOST RECENT FIRST, by the competition's year — not by award id, which is
  // import order and interleaves seasons badly (a real dancer's ids run 2023,
  // 2025, 2024, 2024, 2026, 2023). Keyset pagination on the composite keeps
  // paging stable under concurrent writes; the cursor is "<year>:<id>".
  const since = normalizeText(req.query.updated_since);
  const rawCursor = String(req.query.cursor || '');
  const cm = rawCursor.match(/^(\d+):(\d+)$/);
  const cursorYear = cm ? parseInt(cm[1], 10) : null;
  const cursorId = cm ? parseInt(cm[2], 10) : null;

  const params = [dancer.id, dancer.id, dancer.id, dancer.id];
  let sinceClause = '';
  if (since) { sinceClause = 'AND updated_at > ?'; params.push(since); }
  if (cm) params.push(cursorYear, cursorYear, cursorId);

  const rows = await db.all(`
    SELECT * FROM (
      SELECT DISTINCT a.id, a.place, a.award_class, a.performance_name, a.award_type, a.category, a.age_division,
             a.verification_status, a.is_self_added,
             e.name AS event_name, e.year AS event_year, o.name AS org_name,
             ${studioDisplayNameSql('s')} AS studio_name, s.unique_id AS studio_unique_id,
             (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) AS dancer_count,
             CAST(IFNULL(e.year, 0) AS INTEGER) AS sort_year,
             MAX(
               IFNULL((SELECT MAX(ad3.created_at) FROM award_dancers ad3
                       WHERE ad3.award_id = a.id AND ad3.dancer_id = ?), ''),
               IFNULL((SELECT MAX(p.created_at) FROM award_provenance p WHERE p.award_id = a.id), '')
             ) AS updated_at
      FROM awards a
      LEFT JOIN events e ON e.id = a.event_id
      LEFT JOIN organizations o ON o.id = e.org_id
      LEFT JOIN studios s ON s.id = a.studio_id
      LEFT JOIN award_dancers ad ON ad.award_id = a.id
      WHERE (a.dancer_id = ? OR ad.dancer_id = ?)
        AND NOT EXISTS (SELECT 1 FROM dancer_card_hidden h WHERE h.award_id = a.id AND h.dancer_id = ?)
    ) ${sinceClause ? 'WHERE 1=1 ' + sinceClause : ''}
    ${cm ? (sinceClause ? 'AND' : 'WHERE') + ' (sort_year < ? OR (sort_year = ? AND id < ?))' : ''}
    ORDER BY sort_year DESC, id DESC
    LIMIT ${PAGE_SIZE + 1}`, params);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  // Formatted server-side from the shared helper the web pages use, so the two
  // surfaces cannot disagree about what an unplaced scholarship is called.
  page.forEach(a => { a.place_display = formatPlacement(a); });

  // Where the caller's own claim stands, if they have one. Without this the
  // app offers "This is my dancer" to someone who already asked, and tapping
  // it files a second claim that reads as two households fighting over the
  // child.
  let myClaim = null;
  if (req.mobileUser) {
    try {
      myClaim = await db.get(
        "SELECT id, status, studio_id FROM dancer_claims WHERE dancer_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
        [dancer.id, req.mobileUser.id]);
    } catch (e) { /* pre-migration */ }
  }

  // Why a pending claim is not moving. When the dancer's studio has no owner
  // there is nobody competent to confirm the family, and the wait is open-ended
  // — 21,693 of 21,695 real studios are in that state. The family is the one
  // person positioned to fix it, so the app has to be able to hand them the
  // director's invite link, not just an apology. Computed only for a caller
  // with a live claim; a browsing stranger has no business being told which
  // studios are unclaimed.
  let unclaimedStudio = null;
  if (myClaim && myClaim.status === 'pending' && !myClaim.studio_id) {
    const route = await routeDancerClaim(db, dancer.id, null);
    unclaimedStudio = route.unclaimedStudio || null;
  }

  res.json({
    dancer: { id: dancer.id, unique_id: dancer.unique_id, name: dancer.name, is_claimed: !!dancer.is_claimed },
    myClaim: myClaim || null,
    unclaimedStudio,
    awards: page,
    nextCursor: hasMore
      ? `${page[page.length - 1].sort_year}:${page[page.length - 1].id}`
      : null,
  });
});

// ---- Studios ---------------------------------------------------------------
//
// A director hearing about AwardHome from one of their own families should be
// able to claim the studio from a phone, in the moment. 21,693 of 21,695 real
// studios are unclaimed, so this is the common case rather than an edge one —
// and an unclaimed studio means nobody is reviewing that studio's families'
// submissions at all.
router.get('/studios/search', async (req, res) => {
  const q = normalizeText(req.query.q);
  if (!q || q.length < 2) return res.json({ studios: [] });
  const db = await openDb();
  const studios = await db.all(`
    SELECT s.id, s.unique_id, s.name,
           CASE WHEN s.owner_id IS NOT NULL THEN 1 ELSE 0 END AS is_claimed,
           COUNT(a.id) AS award_count
    FROM studios s LEFT JOIN awards a ON a.studio_id = s.id
    WHERE s.name LIKE ? AND s.status = 'active' AND ${excludeIndependentSql('s')}
    GROUP BY s.id ORDER BY award_count DESC LIMIT 15`, [`%${q}%`]);
  res.json({ studios });
});

router.get('/studios/:id', async (req, res) => {
  const db = await openDb();
  const studio = await db.get(`
    SELECT s.id, s.unique_id, s.name, s.bio, s.logo_url, s.website_url,
           CASE WHEN s.owner_id IS NOT NULL THEN 1 ELSE 0 END AS is_claimed,
           COALESCE(s.is_independent, 0) AS is_independent
    FROM studios s WHERE s.unique_id = ? OR s.id = ?`,
    [req.params.id, parseInt(req.params.id, 10) || -1]);
  if (!studio || studio.is_independent) return fail(res, 404, 'not_found', 'No such studio.');

  // Is it the CALLER's? "Already managed by its director" is a dead end for
  // the director reading it — they may simply be signed out, or signed in as
  // themselves and unable to tell that they already own it. Only ever
  // reported to the person it is about; a guest learns nothing beyond the
  // is_claimed flag the page already shows.
  studio.is_mine = !!(req.mobileUser && (await db.get(
    'SELECT 1 AS x FROM studios WHERE id = ? AND owner_id = ?',
    [studio.id, req.mobileUser.id])));

  // WHO manages it. Present only when the manager agreed to be named — the
  // name is theirs to publish, not ours, and an existing claimant who was
  // never asked is not retroactively published.
  try {
    const m = await db.get(
      'SELECT manager_name, manager_role, manager_public FROM studios WHERE id = ?', [studio.id]);
    studio.manager = (m && m.manager_public && m.manager_name)
      ? { name: m.manager_name, role: m.manager_role || null }
      : null;
  } catch (e) { studio.manager = null; }

  const stats = await db.get(`
    SELECT COUNT(*) AS awards, COUNT(DISTINCT a.event_id) AS events
    FROM awards a WHERE a.studio_id = ?`, [studio.id]);
  const dancers = await db.get(
    'SELECT COUNT(*) AS n FROM dancer_studios WHERE studio_id = ?', [studio.id]);

  // Enough to RECOGNISE the studio by. A name and three counts cannot answer
  // "is this mine?" — there are a lot of studios called Dance Unlimited, and
  // the claim form itself says so. Competitions are what a director actually
  // remembers, and the event names carry the city ("Rainbow - Pueblo, CO"),
  // which is why they identify a studio better than the address column does:
  // only 1,340 of 25,081 studios have an address on file, while every studio
  // with awards has events.
  const recentEvents = await db.all(`
    SELECT e.name, e.year, COUNT(*) AS award_count
    FROM awards a JOIN events e ON e.id = a.event_id
    WHERE a.studio_id = ?
    GROUP BY e.id
    ORDER BY IFNULL(e.year, 0) DESC, award_count DESC
    LIMIT 5`, [studio.id]);

  // Deliberately NO dancer names: roster lists are not public (a dancer
  // appears only on awards they have claimed), and a claim-decision page has
  // no business being the one place a roster leaks. Routine, placement and
  // event are what make a studio recognisable anyway.
  const recentAwards = await db.all(`
    SELECT a.id, a.place, a.award_class, a.performance_name, a.award_type, a.category,
           e.name AS event_name, e.year AS event_year
    FROM awards a LEFT JOIN events e ON e.id = a.event_id
    WHERE a.studio_id = ?
    -- Named routines first. A convention scholarship with no routine name is
    -- a real award but tells a director nothing about whether this is their
    -- studio; "A Pale'" does.
    ORDER BY (a.performance_name IS NULL OR a.performance_name = ''),
             IFNULL(e.year, 0) DESC, a.id DESC
    LIMIT 6`, [studio.id]);
  recentAwards.forEach(a => { a.place_display = formatPlacement(a); });

  res.json({
    studio,
    stats: { ...stats, dancers: dancers.n },
    recentEvents,
    recentAwards,
  });
});

// Claim a studio. Mirrors the web flow including the domain fast-track — and
// the fast-track is legitimate here for the same reason it is there: it only
// fires on a VERIFIED address, and a mobile address is verified by the code
// that signed her in.
router.post('/studios/:id/claim', requireBearer, async (req, res) => {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE unique_id = ? OR id = ?',
    [req.params.id, parseInt(req.params.id, 10) || -1]);
  if (!studio || studio.is_independent) return fail(res, 404, 'not_found', 'No such studio.');
  if (studio.owner_id) return fail(res, 409, 'already_claimed', 'This studio is already claimed.');

  const {
    contact_name: contactName, role, phone, studio_address: address, proof,
    show_publicly: showPublicly,
  } = req.body || {};
  if (!normalizeText(contactName)) return fail(res, 400, 'invalid', 'Please tell us your name.');
  if (!normalizeText(address)) {
    return fail(res, 400, 'invalid',
      "Please add the studio's address — it is how we tell same-named studios apart.");
  }

  const proofText = [
    `Contact: ${normalizeText(contactName)}`,
    `Role: ${normalizeText(role) || ''}`,
    `Phone: ${normalizeText(phone) || ''}`,
    `Studio address: ${normalizeText(address)}`,
    `Details: ${normalizeText(proof) || ''}`,
    'Filed from the mobile app',
  ].join('\n');

  // Stored structurally as well as in proof_text: the reviewer reads the
  // narrative, the studio page needs fields.
  await db.run(
    'INSERT INTO studio_claims (user_id, studio_id, proof_text, status, contact_name, contact_role, show_publicly) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.mobileUser.id, studio.id, proofText, 'pending',
     normalizeText(contactName), normalizeText(role) || null, showPublicly ? 1 : 0]);

  if (domainsMatch(studio.website_url, req.mobileUser.email)) {
    await approveStudioClaim(db, { userId: req.mobileUser.id, studioId: studio.id });
    return res.status(201).json({ ok: true, status: 'approved', reason: 'domain_match' });
  }
  res.status(201).json({ ok: true, status: 'pending' });
});

// A claimant's photo, attached to their pending studio claim.
//
// Two arguments, and they are different. RECOGNITION: a family who is told
// "Dana Reyes manages this studio" still has to find Dana in a lobby.
// DETERRENCE: being asked for your own face raises the cost of a speculative
// claim, and gives a reviewer something checkable — a studio's own "meet the
// staff" page is public, so a photo is evidence in a way a typed name is not.
//
// PRIVATE by default. It rides the same treatment as award evidence — the
// bytes are believed rather than the Content-Type header, camera metadata is
// stripped, and it is written 0600 OUTSIDE the served tree — and it is shown
// to reviewers, not to the public. Putting a real person's face on a public
// page is a larger step than naming them and needs its own moderation, so
// manager_photo_public exists and stays 0.
router.post('/studios/:id/claim-photo', requireBearer,
  express.raw({ type: '*/*', limit: 6 * 1024 * 1024 }),
  async (req, res) => {
    const db = await openDb();
    const studio = await db.get(
      'SELECT id FROM studios WHERE unique_id = ? OR id = ?',
      [req.params.id, parseInt(req.params.id, 10) || -1]);
    if (!studio) return fail(res, 404, 'not_found', 'No such studio.');

    // Only against your OWN pending claim: an upload endpoint keyed on a
    // studio id alone would let anyone attach a face to anyone's claim.
    const claim = await db.get(
      "SELECT id FROM studio_claims WHERE studio_id = ? AND user_id = ? AND status = 'pending' " +
      'ORDER BY id DESC LIMIT 1', [studio.id, req.mobileUser.id]);
    if (!claim) return fail(res, 404, 'not_found', 'No pending claim to attach that to.');

    const buf = req.body;
    if (!buf || !buf.length) return fail(res, 400, 'invalid', 'No image received.');
    const kind = sniff(buf);
    if (!kind || !['image/jpeg', 'image/png'].includes(kind.mime)) {
      return fail(res, 400, 'invalid', 'Please send a JPEG or PNG photo.');
    }
    const clean = stripMetadata(buf, kind.mime);
    const key = newObjectKey(kind.ext);
    await currentDriver().put(key, clean);
    await db.run('UPDATE studio_claims SET photo_object_key = ? WHERE id = ?', [key, claim.id]);
    res.status(201).json({ ok: true });
  });

router.post('/dancers/:id/claim', requireBearer, async (req, res) => {
  const db = await openDb();
  const dancerId = parseInt(req.params.id, 10);
  const dancer = await db.get('SELECT * FROM dancers WHERE id = ? OR unique_id = ?', [dancerId || -1, req.params.id]);
  if (!dancer) return fail(res, 404, 'not_found', 'No such dancer.');
  if (dancer.is_claimed) return fail(res, 409, 'already_claimed', 'This dancer profile is already claimed.');

  const quota = await consumeHouseholdAction(req.mobileUser.id, 'dancer_link', dancer.id);
  if (!quota.ok) {
    return fail(res, 429, 'rate_limited',
      `That's ${quota.limit} profile claims in 24 hours. Please try again tomorrow.`);
  }

  // Already asked? Say so, rather than showing the form again and filing a
  // second claim — which would then look like two households fighting over
  // the dancer and get marked contested.
  const mine = await db.get(
    "SELECT id, status FROM dancer_claims WHERE dancer_id = ? AND user_id = ? AND status IN ('pending','contested','approved') ORDER BY id DESC LIMIT 1",
    [dancer.id, req.mobileUser.id]);
  if (mine) {
    return res.status(409).json({
      error: 'already_claimed_by_you',
      message: mine.status === 'approved'
        ? `You already manage ${dancer.name}.`
        : `You've already asked to manage ${dancer.name}. It's still being reviewed.`,
      claim: { id: mine.id, status: mine.status },
    });
  }

  const { relationship, proof, studio_code: studioCode } = req.body || {};
  const codeMatch = await matchDancerClaimCode(db, dancer.id, studioCode);
  const route = await routeDancerClaim(db, dancer.id, codeMatch);
  let proofText = `Relationship: ${normalizeText(relationship) || ''}\nDetails: ${normalizeText(proof) || ''}`;
  if (codeMatch.provided) {
    proofText += codeMatch.valid
      ? `\nStudio code: valid for ${codeMatch.studio.name}`
      : '\nStudio code: provided but did not match any of this dancer\'s studios';
  }
  await db.run(
    'INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status, studio_id, code_valid) VALUES (?, ?, ?, ?, ?, ?)',
    [req.mobileUser.id, dancer.id, proofText, 'pending',
     route.studioId, codeMatch.valid ? 1 : 0]);

  // A second household on the same dancer contests both, and it leaves the
  // studio queue for AwardHome — the same rule the web flow follows.
  if (route.routedTo === 'studio' && route.studio) {
    notifyStudioOfProfileClaim(db, {
      studio: route.studio, dancer, claimantEmail: req.mobileUser.email, relationship,
    });
  }

  const contest = await markContestedClaims(db, dancer.id);

  res.status(201).json({
    ok: true,
    status: contest.contested ? 'contested' : 'pending',
    // Contested always overrides: a director must never be asked to choose
    // between two families.
    routedTo: contest.contested ? 'awardhome' : route.routedTo,
    studio: route.studio ? { id: route.studio.id, name: route.studio.name } : null,
    unclaimedStudio: route.unclaimedStudio || null,
  });
});

// ---- Events ----------------------------------------------------------------

// Public: the same tour-stop data /dance/events already publishes.
router.get('/events/nearby', async (req, res) => {
  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  let lat = num(req.query.lat), lng = num(req.query.lng);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) { lat = null; lng = null; }
  const date = ISO_DATE.test(req.query.date || '') ? req.query.date : null;
  const state = /^[A-Za-z]{2}$/.test(req.query.state || '') ? req.query.state.toUpperCase() : null;

  const options = await findEventOptions(db, sdb, { lat, lng, date, q: normalizeText(req.query.q), state });
  res.json({ options, radiusMiles: LIFECYCLE.visibilityMiles, dateWindowDays: LIFECYCLE.visibilityDays });
});

// Dedup runs BEFORE the create is accepted, exactly as on the web: without
// `confirm_new`, a likely twin comes back as an offer instead of a second row.
router.post('/events/candidates', requireBearer, async (req, res) => {
  if (!(await flagOn('family_submissions', req))) return fail(res, 404, 'not_found', 'Not available.');
  const { ok, errors, values } = cleanCandidateInput(req.body || {});
  if (!ok) return res.status(400).json({ error: 'invalid', message: errors.join(' '), errors });

  const sdb = await openSubmissionsDb();
  if ((req.body || {}).check_only) {
    return res.json({ duplicates: await findDuplicateCandidates(sdb, values) });
  }

  const quota = await consumeHouseholdAction(req.mobileUser.id, 'submission', null);
  if (!quota.ok) return fail(res, 429, 'rate_limited', `Daily limit of ${quota.limit} reached.`);

  const { candidate, duplicates, offered } = await createCandidate(sdb, values, {
    userId: req.mobileUser.id,
    confirmNew: !!(req.body || {}).confirm_new,
  });
  if (offered) return res.status(409).json({ error: 'duplicates_found', offered: true, duplicates });
  res.status(201).json({ candidate });
});

// ---- Event sessions (M7) ---------------------------------------------------
//
// A weekend at one competition, batched. Get-or-create by design: a client
// that lost its local copy — reinstalled, switched devices mid-weekend —
// rejoins the same session instead of starting a second one.
router.post('/event-sessions', requireBearer, async (req, res) => {
  const eventId = parseInt((req.body || {}).event_id, 10) || null;
  const candidateId = parseInt((req.body || {}).event_candidate_id, 10) || null;
  const result = await openSession({
    userId: req.mobileUser.id, eventId, eventCandidateId: candidateId,
  });
  if (!result.ok) return fail(res, 400, result.reason, 'An event is required to start a session.');
  res.status(result.created ? 201 : 200).json({ session: result.session, created: result.created });
});

// What the session already knows, so the second award of a weekend asks for a
// routine and a placement and nothing else.
router.get('/event-sessions/:id', requireBearer, async (req, res) => {
  const ctx = await sessionContext(req.params.id, req.mobileUser.id);
  if (!ctx) return fail(res, 404, 'not_found', 'No such session.');
  res.json(ctx);
});

// ---- Submissions -----------------------------------------------------------

router.get('/submissions', requireBearer, async (req, res) => {
  const sdb = await openSubmissionsDb();
  const db = await openDb();
  const cursor = parseInt(req.query.cursor, 10) || 0;
  const params = [req.mobileUser.id];
  let where = 'user_id = ?';
  if (req.query.updated_since) { where += ' AND updated_at > ?'; params.push(String(req.query.updated_since)); }
  if (cursor) { where += ' AND id < ?'; params.push(cursor); }

  const rows = await sdb.all(
    `SELECT * FROM award_submissions WHERE ${where} ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`, params);
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const cast = await castForSubmissions(page.map(s => s.id));
  const out = [];
  for (const r of page) {
    const event = r.event_id ? await db.get('SELECT id, name, year FROM events WHERE id = ?', [r.event_id]) : null;
    const candidate = (!event && r.event_candidate_id)
      ? await sdb.get('SELECT id, name, start_date, status FROM event_candidates WHERE id = ?', [r.event_candidate_id])
      : null;
    out.push({ ...r, event, candidate, cast: cast.get(r.id) || [] });
  }
  res.json({ submissions: out, nextCursor: hasMore ? page[page.length - 1].id : null });
});

// Idempotent on (user, client_submission_id) — a retried offline upload
// returns the ORIGINAL row. That contract is the whole reason the mobile
// client can queue submissions on a venue's terrible wifi and not worry.
router.post('/submissions', requireBearer, async (req, res) => {
  if (!(await flagOn('family_submissions', req))) return fail(res, 404, 'not_found', 'Not available.');
  const db = await openDb();
  const dancerId = parseInt((req.body || {}).dancer_id, 10);
  const dancer = await db.get('SELECT id, claimed_by_user_id FROM dancers WHERE id = ?', [dancerId]);
  if (!dancer) return fail(res, 404, 'not_found', 'No such dancer.');
  // Standing (owner or pending claimant) is decided by the service, not here,
  // so the web form and this endpoint cannot drift on who may write on a
  // child's behalf. A stranger fails validation below with the same message.
  const standing = await householdStanding(db, dancer.id, req.mobileUser.id);
  if (!standing) {
    return fail(res, 403, 'forbidden', 'You can only add awards for a dancer you manage.');
  }

  const { ok, errors, value } = await validateSubmission(db, req.body || {}, {
    dancerId: dancer.id, userId: req.mobileUser.id,
  });
  if (!ok) return res.status(400).json({ error: 'invalid', message: errors.join(' '), errors });

  const { submission, idempotent, limit } = await createSubmission(value, value.cast);
  if (!submission) {
    return fail(res, 429, 'rate_limited', `Daily limit of ${limit.limit} submissions reached.`);
  }

  let auto = { promoted: [], reason: null };
  if (!idempotent) {
    try { auto = await runAutoPromotion({ submissionId: submission.id }); }
    catch (e) { console.error('[api] auto-promotion failed:', e.message); }
  }
  res.status(idempotent ? 200 : 201).json({
    submission, idempotent, published: auto.promoted.includes(submission.id), reason: auto.reason,
    // Tell her the truth about where it went. "Saved, waiting on your claim"
    // is a different promise from "submitted for review", and an app that
    // conflates them teaches families their entries vanished.
    queued: !!value.unverified_household,
    message: auto.reason && REASON_TEXT[auto.reason] ? REASON_TEXT[auto.reason] : null,
  });
});

// Upload grants: the client asks for permission, then sends the bytes. The
// two-step exists so the storage driver can be swapped for S3/R2 without the
// client changing — the grant simply points somewhere else.
router.post('/submissions/:id/evidence', requireBearer, async (req, res) => {
  const result = await issueGrant({
    submissionId: parseInt(req.params.id, 10),
    userId: req.mobileUser.id,
  });
  if (!result.ok) return fail(res, 404, 'not_found', 'No such submission.');
  res.json({
    uploadUrl: '/api/v1/mobile/uploads',
    method: 'POST',
    grant: result.grant,
    expiresAt: result.expiresAt,
    maxBytes: result.maxBytes,
    acceptedTypes: result.acceptedTypes,
  });
});

// Redeem a grant. Raw body: the client sends the file bytes with its
// Content-Type, and the server believes the BYTES, not the header.
router.post('/uploads', requireBearer,
  express.raw({ type: '*/*', limit: MAX_BYTES + 1024 }),
  async (req, res) => {
    const grant = req.get('x-upload-grant') || req.query.grant;
    const result = await storeEvidence({
      grantToken: grant,
      buffer: req.body,
      declaredType: req.get('content-type'),
      userId: req.mobileUser.id,
    });
    if (!result.ok) {
      const status = result.reason === 'too_large' ? 413
        : (result.reason === 'not_found' ? 404 : 400);
      return fail(res, status, result.reason, {
        invalid_grant: 'That upload permission is not valid or has expired.',
        too_large: 'That file is too large.',
        unsupported_type: 'Please upload a photo (JPEG, PNG, WebP or HEIC).',
        unreadable: 'That file could not be read.',
        empty: 'No file received.',
        not_found: 'No such submission.',
      }[result.reason] || 'Upload failed.');
    }
    res.status(201).json(result);
  });

// Evidence is PRIVATE. Served only to the household that uploaded it and to
// reviewers, always as an attachment, never inline, never cached.
router.get('/evidence/:id', requireBearer, async (req, res) => {
  const db = await openDb();
  const allowed = await canServe(db, {
    evidenceId: parseInt(req.params.id, 10),
    userId: req.mobileUser.id,
    role: req.mobileUser.role,
  });
  if (!allowed.ok) return fail(res, 404, 'not_found', 'No such evidence.');
  try {
    const buf = await readEvidence(allowed.evidence.object_key);
    res.set('Content-Type', allowed.evidence.media_type || 'application/octet-stream');
    res.set('Content-Disposition', 'attachment');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  } catch (e) {
    fail(res, 404, 'not_found', 'No such evidence.');
  }
});

// ---- Corrections -----------------------------------------------------------

router.post('/corrections', requireBearer, async (req, res) => {
  if (!(await flagOn('family_submissions', req))) return fail(res, 404, 'not_found', 'Not available.');
  const db = await openDb();
  const awardId = parseInt((req.body || {}).award_id, 10);
  const dancerId = parseInt((req.body || {}).dancer_id, 10);
  if (!(await canPropose(db, req.mobileUser.id, awardId, dancerId))) {
    return fail(res, 403, 'forbidden', 'You can only suggest corrections on your own dancer\'s awards.');
  }
  const result = await propose(db, {
    awardId, dancerId, userId: req.mobileUser.id,
    field: (req.body || {}).field,
    proposedValue: (req.body || {}).proposed_value,
    reason: (req.body || {}).reason,
  });
  if (!result.ok) {
    return fail(res, 400, result.reason, CORRECTION_REASON_TEXT[result.reason] || 'Could not file that.');
  }
  res.status(201).json({ ok: true, correctionId: result.correctionId, fields: CORRECTABLE_FIELDS });
});

// ---- Activity --------------------------------------------------------------

// What happened to this household's things, newest first. Decisions and
// questions only — the same rule the push notifications follow. There is
// deliberately no engagement feed here.
router.get('/activity', requireBearer, async (req, res) => {
  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const userId = req.mobileUser.id;

  const subs = await sdb.all(`
    SELECT id, performance_name, status, verification_level, reviewer_note, decided_at, updated_at
    FROM award_submissions
    WHERE user_id = ? AND status IN ('accepted', 'rejected', 'needs_info')
    ORDER BY IFNULL(decided_at, updated_at) DESC LIMIT 50`, [userId]);

  let corrections = [], claims = [];
  try {
    corrections = await db.all(`
      SELECT c.id, c.field, c.proposed_value, c.status, c.decision_note, c.decided_at, a.performance_name
      FROM award_corrections c LEFT JOIN awards a ON a.id = c.award_id
      WHERE c.submitted_by = ? AND c.status != 'open'
      ORDER BY c.decided_at DESC LIMIT 25`, [userId]);
    claims = await db.all(`
      SELECT dc.id, dc.status, d.name AS dancer_name, d.unique_id AS dancer_uid, dc.created_at
      FROM dancer_claims dc JOIN dancers d ON d.id = dc.dancer_id
      WHERE dc.user_id = ? ORDER BY dc.created_at DESC LIMIT 25`, [userId]);
  } catch (e) { /* pre-migration */ }

  const items = [
    ...subs.map(s => ({
      type: 'submission', id: s.id, at: s.decided_at || s.updated_at,
      title: s.performance_name, status: s.status,
      verification: s.verification_level, note: s.reviewer_note,
    })),
    ...corrections.map(c => ({
      type: 'correction', id: c.id, at: c.decided_at,
      title: c.performance_name, status: c.status, field: c.field, note: c.decision_note,
    })),
    ...claims.map(c => ({
      type: 'claim', id: c.id, at: c.created_at,
      title: c.dancer_name, status: c.status, dancer_uid: c.dancer_uid,
    })),
  ].filter(i => i.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  res.json({ activity: items.slice(0, 50) });
});

// ---- Household -------------------------------------------------------------

// The dancers this account manages, with the studio affiliation the Add flow
// derives from. The client needs this to render the Add screen without asking
// anyone to type a studio name.
router.get('/me', requireBearer, async (req, res) => {
  const db = await openDb();
  // Dancers this household manages, PLUS the ones it has asked to manage
  // (M8). A pending claimant needs her dancer in this list or the Add flow
  // has nothing to offer her — and the weekend she is trying to write down
  // will be gone by the time an unclaimed studio finds an owner. `standing`
  // tells the app which it is, so it can promise the right thing.
  let dancers;
  try {
    dancers = await db.all(`
      SELECT d.id, d.unique_id, d.name,
        (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS award_count,
        CASE WHEN d.claimed_by_user_id = ? THEN 'owner' ELSE 'pending_claim' END AS standing,
        IFNULL(d.independent_publish_status, 'none') AS independent_publish_status,
        (SELECT MAX(c2.created_at) FROM dancer_claims c2
          WHERE c2.dancer_id = d.id AND c2.user_id = ?
            AND c2.status IN ('pending', 'contested')) AS claim_at
      FROM dancers d
      WHERE d.claimed_by_user_id = ?
         OR EXISTS (SELECT 1 FROM dancer_claims c
                     WHERE c.dancer_id = d.id AND c.user_id = ?
                       AND c.status IN ('pending', 'contested'))
      -- Confirmed dancers first: those are the ones she actually manages, and
      -- they are what she opened the app for. Pending claims follow, most
      -- RECENT first — a claim she filed minutes ago is the one she is looking
      -- for, whereas confirmed dancers are a stable list best kept alphabetical
      -- so it does not reshuffle under her between visits.
      ORDER BY CASE WHEN d.claimed_by_user_id = ? THEN 0 ELSE 1 END,
               CASE WHEN d.claimed_by_user_id = ? THEN d.name END ASC,
               claim_at DESC, d.id DESC`,
      [req.mobileUser.id, req.mobileUser.id, req.mobileUser.id, req.mobileUser.id,
       req.mobileUser.id, req.mobileUser.id]);
  } catch (e) { // pre-migration: no dancer_claims table
    dancers = await db.all(`
      SELECT d.id, d.unique_id, d.name,
        (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS award_count,
        'owner' AS standing, NULL AS claim_at,
        IFNULL(d.independent_publish_status, 'none') AS independent_publish_status
      FROM dancers d WHERE d.claimed_by_user_id = ? ORDER BY d.name`, [req.mobileUser.id]);
  }
  for (const d of dancers) d.studios = await dancerStudios(db, d.id);
  res.json({
    user: { id: req.mobileUser.id, email: req.mobileUser.email },
    dancers,
    groupSizes: GROUP_SIZES,
  });
});

// An independent dancer's family asking AwardHome to publish their record.
// The app's equivalent of the web button; same one-grant-per-household shape.
router.post('/dancers/:id/publish-request', requireBearer, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get(
    'SELECT id, claimed_by_user_id, independent_publish_status AS st FROM dancers WHERE id = ? OR unique_id = ?',
    [parseInt(req.params.id, 10) || -1, req.params.id]);
  if (!dancer) return fail(res, 404, 'not_found', 'No such dancer.');
  // Owner only: a pending claimant asking us to publish a record she has not
  // yet been confirmed to have any part in is the wrong order of operations.
  if (dancer.claimed_by_user_id !== req.mobileUser.id) {
    return fail(res, 403, 'forbidden', 'You can only do this for a dancer you manage.');
  }
  const indep = await db.get(
    'SELECT 1 AS x FROM dancer_studios ds JOIN studios s ON s.id = ds.studio_id ' +
    'WHERE ds.dancer_id = ? AND COALESCE(s.is_independent, 0) = 1', [dancer.id]);
  if (!indep) {
    return fail(res, 400, 'not_independent',
      'This dancer has a studio, so their director confirms awards — there is nothing to ask us for.');
  }
  await db.run(
    "UPDATE dancers SET independent_publish_status = 'requested', " +
    'independent_publish_at = CURRENT_TIMESTAMP ' +
    "WHERE id = ? AND IFNULL(independent_publish_status, 'none') = 'none'", [dancer.id]);
  const after = await db.get('SELECT independent_publish_status AS st FROM dancers WHERE id = ?', [dancer.id]);
  res.json({ ok: true, status: after.st });
});

router.post('/devices', requireBearer, async (req, res) => {
  const { platform, token, preferences } = req.body || {};
  if (!platform || !token) return fail(res, 400, 'invalid', 'platform and token are required.');
  await registerDevice({
    userId: req.mobileUser.id,
    sessionId: req.mobileSession.id,
    platform: String(platform).slice(0, 20),
    token: String(token).slice(0, 400),
    preferences,
  });
  res.status(201).json({ ok: true });
});

// JSON to the last byte: an unhandled error inside the API must not fall
// through to the HTML error handler a native client cannot read.
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') {
    return fail(res, 413, 'too_large', 'That request is too large.');
  }
  console.error('[api/v1/mobile]', err);
  fail(res, 500, 'server_error', 'Something went wrong.');
});

module.exports = router;
