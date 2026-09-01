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
const { runAutoPromotion } = require('../../utils/promotion');
const { findEventOptions } = require('../../utils/eventPicker');
const {
  LIFECYCLE, cleanCandidateInput, findDuplicateCandidates, createCandidate,
} = require('../../utils/eventCandidates');
const { CORRECTABLE_FIELDS, CORRECTION_REASON_TEXT, canPropose, propose } = require('../../utils/corrections');
const { markContestedClaims, matchDancerClaimCode } = require('../../utils/claims');
const { studioDisplayNameSql } = require('../../utils/independents');
const { issueGrant, storeEvidence, canServe, readEvidence, MAX_BYTES } = require('../../utils/evidence');
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
  res.json({ ok: true, expiresInMinutes: require('../../utils/mobileAuth').CODE_TTL_MIN, ...(result.devCode ? { devCode: result.devCode } : {}) });
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
    ORDER BY award_count DESC
    LIMIT 25`, [`%${q}%`]);
  res.json({ dancers });
});

// The trophy case. Public, because the web page is — but it honours the same
// per-card hide the owner controls there.
//
// SYNC. `cursor` is the last award id seen, and ids only ever increase, so
// paging is stable under concurrent writes. `updated_since` is derived from
// the two timestamps that actually exist — when the dancer's link was made and
// when the fact last changed — because `awards` has no updated_at and putting
// a trigger on a 900k-row table's UPDATE path would tax every import for the
// benefit of a sync protocol. Consequence, stated plainly: an importer editing
// an award without writing provenance will not move its marker.
router.get('/dancers/:id/awards', async (req, res) => {
  const db = await openDb();
  const dancer = await db.get(
    'SELECT id, unique_id, name, is_claimed FROM dancers WHERE unique_id = ? OR id = ?',
    [req.params.id, parseInt(req.params.id, 10) || -1]);
  if (!dancer) return fail(res, 404, 'not_found', 'No such dancer.');

  const cursor = parseInt(req.query.cursor, 10) || 0;
  const since = normalizeText(req.query.updated_since);
  const params = [dancer.id, dancer.id, dancer.id, dancer.id];
  let sinceClause = '';
  if (since) { sinceClause = 'AND updated_at > ?'; params.push(since); }
  if (cursor) params.push(cursor);

  const rows = await db.all(`
    SELECT * FROM (
      SELECT DISTINCT a.id, a.place, a.performance_name, a.award_type, a.category, a.age_division,
             a.verification_status, a.is_self_added,
             e.name AS event_name, e.year AS event_year, o.name AS org_name,
             ${studioDisplayNameSql('s')} AS studio_name, s.unique_id AS studio_unique_id,
             (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) AS dancer_count,
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
    ${cursor ? (sinceClause ? 'AND' : 'WHERE') + ' id < ?' : ''}
    ORDER BY id DESC
    LIMIT ${PAGE_SIZE + 1}`, params);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  res.json({
    dancer: { id: dancer.id, unique_id: dancer.unique_id, name: dancer.name, is_claimed: !!dancer.is_claimed },
    awards: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
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

  const { relationship, proof, studio_code: studioCode } = req.body || {};
  const codeMatch = await matchDancerClaimCode(db, dancer.id, studioCode);
  let proofText = `Relationship: ${normalizeText(relationship) || ''}\nDetails: ${normalizeText(proof) || ''}`;
  if (codeMatch.provided) {
    proofText += codeMatch.valid
      ? `\nStudio code: valid for ${codeMatch.studio.name}`
      : '\nStudio code: provided but did not match any of this dancer\'s studios';
  }
  await db.run(
    'INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status, studio_id, code_valid) VALUES (?, ?, ?, ?, ?, ?)',
    [req.mobileUser.id, dancer.id, proofText, 'pending',
     codeMatch.valid ? codeMatch.studio.id : null, codeMatch.valid ? 1 : 0]);

  // A second household on the same dancer contests both, and it leaves the
  // studio queue for AwardHome — the same rule the web flow follows.
  const contest = await markContestedClaims(db, dancer.id);
  res.status(201).json({
    ok: true,
    status: contest.contested ? 'contested' : 'pending',
    routedTo: contest.contested ? 'awardhome' : (codeMatch.valid ? 'studio' : 'awardhome'),
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
  if (dancer.claimed_by_user_id !== req.mobileUser.id) {
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
  const dancers = await db.all(`
    SELECT d.id, d.unique_id, d.name,
      (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS award_count
    FROM dancers d WHERE d.claimed_by_user_id = ? ORDER BY d.name`, [req.mobileUser.id]);
  for (const d of dancers) d.studios = await dancerStudios(db, d.id);
  res.json({
    user: { id: req.mobileUser.id, email: req.mobileUser.email },
    dancers,
    groupSizes: GROUP_SIZES,
  });
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
