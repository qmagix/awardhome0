// Mobile API contract test (development plan M5).
//
// Unlike test/smoke.js, this runs against a THROWAWAY COPY of the database.
// The API's write paths mint awards, claims and evidence, and a contract test
// that leaves debris in a developer's working database is a test people learn
// to skip.
//
// The acceptance criteria it exists to prove:
//   * a token-authenticated client completes claim -> submit -> status with no
//     session cookie and no CSRF token anywhere;
//   * revoking a device invalidates its tokens immediately;
//   * a rotated refresh token cannot be replayed;
//   * guests can read what the web publishes publicly;
//   * evidence is stripped of metadata, stored outside the served tree, and
//     readable only by the uploader and reviewers.
//
// Run: node test/api_mobile.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.API_TEST_PORT || 3994;
const BASE = `http://localhost:${PORT}/api/v1/mobile`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'awardhome-api-'));
const API_DB = path.join(TMP, 'api.sqlite');
const SUB_DB = path.join(TMP, 'submissions.sqlite');
const AUTH_DB = path.join(TMP, 'auth.sqlite');
const EVIDENCE_DIR = path.join(TMP, 'evidence');

let failures = 0;
const check = (ok, desc, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${desc}${detail ? '  [' + detail + ']' : ''}`);
};

// A JPEG carrying an APP1/EXIF block. Competition photos arrive with GPS
// coordinates and often the child's name in here; the point of the test is
// that none of it survives storage.
function jpegWithExif() {
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0', 'ascii'),
    Buffer.from('GPSLatitude=37.3382;GPSLongitude=-121.8863;Artist=A Child', 'ascii'),
  ]);
  const app1 = Buffer.concat([
    Buffer.from([0xFF, 0xE1]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(exif.length + 2); return b; })(),
    exif,
  ]);
  const scan = Buffer.concat([
    Buffer.from([0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]),
    Buffer.from('imagedatapretendingtobeascan', 'ascii'),
    Buffer.from([0xFF, 0xD9]),
  ]);
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), app1, scan]);
}

async function main() {
  // ---- throwaway database ----
  for (const ext of ['', '-wal', '-shm']) {
    const src = path.join(ROOT, 'database.sqlite' + ext);
    if (fs.existsSync(src)) fs.copyFileSync(src, API_DB + ext);
  }
  const { spawnSync } = require('child_process');
  spawnSync('sqlite3', [API_DB, 'PRAGMA wal_checkpoint(TRUNCATE);']);

  process.env.DB_PATH = API_DB;
  process.env.SUBMISSIONS_DB_PATH = SUB_DB;
  process.env.MOBILE_AUTH_DB_PATH = AUTH_DB;
  process.env.EVIDENCE_DIR = EVIDENCE_DIR;

  const { openDb } = require('../database');
  const { openSubmissionsDb } = require('../utils/submissionsDb');
  const db = await openDb();

  // Feature-gated write paths need their flag on in the copy.
  await db.run("INSERT INTO feature_flags (key, state) VALUES ('family_submissions', 'on') " +
    "ON CONFLICT(key) DO UPDATE SET state = 'on'");

  const bcrypt = require('bcrypt');
  const hash = bcrypt.hashSync('api-test-pass', 4);
  const u1 = await db.run("INSERT INTO users (email, password_hash, role, is_verified) VALUES ('api-family@test.invalid', ?, 'user', 1)", [hash]);
  const u2 = await db.run("INSERT INTO users (email, password_hash, role, is_verified) VALUES ('api-other@test.invalid', ?, 'user', 1)", [hash]);
  const st = await db.run("INSERT INTO studios (unique_id, name, status, is_claimed, owner_id) VALUES ('api-studio', 'API Test Studio', 'active', 1, ?)", [u1.lastID]);
  const dn = await db.run("INSERT INTO dancers (unique_id, name, is_claimed, claimed_by_user_id) VALUES ('DNC-api-dancer', 'API Test Dancer', 1, ?)", [u1.lastID]);
  await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [dn.lastID, st.lastID]);
  const unclaimed = await db.run("INSERT INTO dancers (unique_id, name) VALUES ('DNC-api-unclaimed', 'API Unclaimed Dancer')");
  await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [unclaimed.lastID, st.lastID]);
  const event = await db.get('SELECT id, year FROM events WHERE year IS NOT NULL ORDER BY id LIMIT 1');

  // ---- boot ----
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT), DB_PATH: API_DB, SUBMISSIONS_DB_PATH: SUB_DB,
      MOBILE_AUTH_DB_PATH: AUTH_DB, EVIDENCE_DIR,
      EMAIL_PROVIDER: '', BETA_MODE: 'false',
      ENABLE_NIGHTLY_BACKUPS: 'false', ENABLE_WEEKLY_SCRAPE: 'false', ENABLE_SENTINEL: 'false',
      PROFILE_RATE_LIMIT: '50000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });

  const deadline = Date.now() + 30000;
  let up = false;
  while (Date.now() < deadline) {
    try { await fetch(`http://localhost:${PORT}/healthz`); up = true; break; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!up) {
    console.error('server did not start\n' + log.slice(-2000));
    process.exit(1);
  }

  // Every API response is inspected for Set-Cookie: mounting before the
  // session middleware means the API must never issue one, which is what
  // makes "no session cookie" a property rather than a claim.
  const cookiesSeen = [];
  const api = async (method, p, { body, token, headers = {}, raw } = {}) => {
    const res = await fetch(BASE + p, {
      method,
      headers: {
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...headers,
      },
      body: raw || (body === undefined ? undefined : JSON.stringify(body)),
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookie && setCookie.length) cookiesSeen.push(p);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* non-JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  try {
    // ---- contract published ----
    const spec = await api('GET', '/openapi.json');
    check(spec.status === 200 && spec.json && spec.json.openapi && spec.json.paths['/submissions'],
      'the OpenAPI contract ships with the code that implements it', 'status ' + spec.status);

    // ---- CORS (browser clients only) ----
    // `expo start --web` serves the app from another origin, so without these
    // the browser discards a perfectly good 200 and the app reports that it
    // cannot reach the server. Native clients are unaffected either way — CORS
    // is a browser rule.
    const corsGet = await fetch(BASE + '/dancers/search?q=api', {
      headers: { Origin: 'http://localhost:8081' },
    });
    check(corsGet.headers.get('access-control-allow-origin') === 'http://localhost:8081' &&
          (corsGet.headers.get('vary') || '').includes('Origin'),
      'a browser origin gets Access-Control-Allow-Origin, varying on Origin',
      'acao=' + corsGet.headers.get('access-control-allow-origin'));

    const preflight = await fetch(BASE + '/submissions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8081',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    check(preflight.status === 204 &&
          (preflight.headers.get('access-control-allow-headers') || '').toLowerCase().includes('authorization'),
      'preflight answers 204 and allows Authorization — before any token check',
      preflight.status + ' ' + preflight.headers.get('access-control-allow-headers'));

    // The one that must never appear: this API has no cookie, so allowing
    // credentials would invite exactly the attack its absence prevents.
    check(!corsGet.headers.get('access-control-allow-credentials') &&
          !preflight.headers.get('access-control-allow-credentials'),
      'Access-Control-Allow-Credentials is never sent — there is no cookie to ride');

    const noOrigin = await fetch(BASE + '/dancers/search?q=api');
    check(!noOrigin.headers.get('access-control-allow-origin'),
      'a request with no Origin (a native client) gets no CORS headers at all');

    // ---- guest reads ----
    const search = await api('GET', '/dancers/search?q=API%20Test');
    check(search.status === 200 && search.json.dancers.some(d => d.unique_id === 'DNC-api-dancer'),
      'a guest with no token can search dancers', 'status ' + search.status);
    const guestAwards = await api('GET', '/dancers/DNC-api-dancer/awards');
    check(guestAwards.status === 200 && Array.isArray(guestAwards.json.awards),
      'a guest with no token can read a trophy case', 'status ' + guestAwards.status);
    const noAuth = await api('POST', '/submissions', { body: {} });
    check(noAuth.status === 401 && noAuth.json.error === 'unauthorized',
      'writes still require a token', 'status ' + noAuth.status);

    // ---- sign in (no cookie, no CSRF token, anywhere) ----
    const codeReq = await api('POST', '/auth/request-code', { body: { email: 'api-family@test.invalid' } });
    const devCode = codeReq.json && codeReq.json.devCode;
    check(codeReq.status === 200 && !!devCode, 'a sign-in code is issued', 'status ' + codeReq.status);

    const unknown = await api('POST', '/auth/request-code', { body: { email: 'nobody-here@test.invalid' } });
    // A development server returns a code for ANY address, because any address
    // can now become an account — verifying the code creates one. There is no
    // longer a "valid code with nothing to unlock" dead end.
    check(unknown.status === 200 && !!unknown.json.devCode && unknown.json.devMode === true,
      'a development server returns a code for a first-time address too — it will create the account',
      JSON.stringify(unknown.json));

    // The property that actually matters is the PRODUCTION shape, and it
    // cannot be probed through this server (which is running in development).
    // So assert it where it is decided — one gate in utils/mobileAuth.js —
    // by flipping NODE_ENV in-process. Fresh addresses each time, because
    // requesting a code is rate-limited per email.
    {
      const { requestCode: rc } = require('../utils/mobileAuth');
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      // Deliberately NOT api-family: issuing a code retires that address's
      // earlier one, and this test is holding a devCode for it that has not
      // been redeemed yet.
      const known = await rc('api-other@test.invalid');
      const stranger = await rc('nobody-at-all@test.invalid');
      process.env.NODE_ENV = prev;
      check(JSON.stringify(known) === JSON.stringify(stranger) &&
            !known.devCode && !known.devMode,
        'in production the two answers are byte-identical — no account-existence oracle',
        JSON.stringify(known));
    }

    const badCode = await api('POST', '/auth/verify', { body: { email: 'api-family@test.invalid', code: '000000' } });
    check(badCode.status === 401, 'a wrong code is refused', 'status ' + badCode.status);

    const signIn = await api('POST', '/auth/verify', {
      body: { email: 'api-family@test.invalid', code: devCode, device_label: 'API Test Phone', platform: 'ios' },
    });
    let access = signIn.json && signIn.json.accessToken;
    let refresh = signIn.json && signIn.json.refreshToken;
    check(signIn.status === 200 && !!access && !!refresh && signIn.json.user.id === u1.lastID,
      'a valid code returns an access token and a refresh token', 'status ' + signIn.status);

    const replay = await api('POST', '/auth/verify', { body: { email: 'api-family@test.invalid', code: devCode } });
    check(replay.status === 401, 'a sign-in code works exactly once', 'status ' + replay.status);

    // ---- a parent who has never heard of AwardHome ----
    // The journey that matters commercially: she hears about it from a friend,
    // finds her child, and taps claim. Requiring an account she does not have,
    // made on another device, is where that parent leaves.
    const NEW_EMAIL = `new-parent-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const newCode = await api('POST', '/auth/request-code', { body: { email: NEW_EMAIL } });
    const newSignIn = await api('POST', '/auth/verify', {
      body: { email: NEW_EMAIL, code: newCode.json.devCode },
    });
    const createdUser = await db.get('SELECT id, is_verified FROM users WHERE email = ?', [NEW_EMAIL]);
    check(newSignIn.status === 200 && newSignIn.json.isNewAccount === true &&
          !!newSignIn.json.accessToken && !!createdUser && createdUser.is_verified === 1,
      'a first-time address gets an account and a session from the code alone — no signup form',
      'status ' + newSignIn.status + ' isNew=' + (newSignIn.json || {}).isNewAccount);

    // She claims, and is told nobody at the studio will see it.
    const unclaimedDancer = await db.run(
      "INSERT INTO dancers (unique_id, name) VALUES ('DNC-api-orphan', 'API Orphan Dancer')");
    const orphanStudio = await db.run(
      "INSERT INTO studios (unique_id, name, status) VALUES ('api-unclaimed-studio', 'API Unclaimed Studio', 'active')");
    await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)',
      [unclaimedDancer.lastID, orphanStudio.lastID]);
    const newClaim = await api('POST', `/dancers/${unclaimedDancer.lastID}/claim`, {
      token: newSignIn.json.accessToken, body: { relationship: 'parent' },
    });
    check(newClaim.status === 201 &&
          newClaim.json.unclaimedStudio &&
          newClaim.json.unclaimedStudio.name === 'API Unclaimed Studio',
      'the claim response names the unclaimed studio — nobody there will review it, and she can say so',
      JSON.stringify((newClaim.json || {}).unclaimedStudio));

    // ---- a director claiming their studio from a phone ----
    const studioSearch = await api('GET', '/studios/search?q=API%20Unclaimed');
    check(studioSearch.status === 200 &&
          studioSearch.json.studios.some(s2 => s2.unique_id === 'api-unclaimed-studio'),
      'studios are searchable, so a director can find their own', 'status ' + studioSearch.status);

    const studioClaim = await api('POST', '/studios/api-unclaimed-studio/claim', {
      token: newSignIn.json.accessToken,
      body: { contact_name: 'A Director', studio_address: '1 Test Street', role: 'owner' },
    });
    const filed = await db.get(
      "SELECT status FROM studio_claims WHERE studio_id = ?", [orphanStudio.lastID]);
    check(studioClaim.status === 201 && studioClaim.json.status === 'pending' &&
          !!filed && filed.status === 'pending',
      'a director can claim a studio from the app', 'status ' + studioClaim.status);

    const noAddress = await api('POST', '/studios/api-unclaimed-studio/claim', {
      token: newSignIn.json.accessToken, body: { contact_name: 'A Director' },
    });
    check(noAddress.status === 409 || noAddress.status === 400,
      'the studio address is required — it is how same-named studios are told apart',
      'status ' + noAddress.status);

    // ---- household ----
    const me = await api('GET', '/me', { token: access });
    check(me.status === 200 && me.json.dancers.length === 1 && me.json.dancers[0].studios.length === 1,
      'the household reads back its dancers with the studio the Add flow derives',
      'status ' + me.status + ' dancers=' + (me.json.dancers || []).length);

    // ---- claim ----
    const claim = await api('POST', `/dancers/${unclaimed.lastID}/claim`, {
      token: access, body: { relationship: 'parent', proof: 'api test' },
    });
    const claimRow = await db.get('SELECT status FROM dancer_claims WHERE dancer_id = ?', [unclaimed.lastID]);
    check(claim.status === 201 && claimRow && claimRow.status === 'pending',
      'claim: a token-authenticated client files a dancer claim', 'status ' + claim.status);

    // ---- submit (idempotent) ----
    const IDEM = crypto.randomUUID();
    const submitBody = {
      client_submission_id: IDEM, dancer_id: dn.lastID, event_id: event.id,
      performance_name: '  API   Test Routine ', group_size: 'small_group', place: '1st',
      teacher: 'Ms. API',
    };
    const submit1 = await api('POST', '/submissions', { token: access, body: submitBody });
    const submit2 = await api('POST', '/submissions', { token: access, body: submitBody });
    check(submit1.status === 201 && submit2.status === 200 &&
          submit1.json.submission.id === submit2.json.submission.id &&
          submit1.json.submission.performance_name === 'API Test Routine',
      'submit: created once, replayed idempotently, normalised server-side',
      submit1.status + '/' + submit2.status);

    const missingSize = await api('POST', '/submissions', {
      token: access, body: { ...submitBody, client_submission_id: crypto.randomUUID(), group_size: '' },
    });
    check(missingSize.status === 400 && /group size/i.test(missingSize.json.message || ''),
      'submit: group size is required, because it decides the write path',
      'status ' + missingSize.status);

    const otherDancer = await api('POST', '/submissions', {
      token: access, body: { ...submitBody, client_submission_id: crypto.randomUUID(), dancer_id: unclaimed.lastID },
    });
    check(otherDancer.status === 403,
      'submit: only for a dancer this household manages', 'status ' + otherDancer.status);

    // ---- status feed ----
    const feed = await api('GET', '/submissions', { token: access });
    check(feed.status === 200 && feed.json.submissions.some(s => s.client_submission_id === IDEM),
      'status: the submission comes back in the household feed', 'status ' + feed.status);

    // ---- evidence ----
    const subId = submit1.json.submission.id;
    const grant = await api('POST', `/submissions/${subId}/evidence`, { token: access });
    check(grant.status === 200 && !!grant.json.grant && grant.json.maxBytes > 0,
      'evidence: an upload grant is issued', 'status ' + grant.status);

    const original = jpegWithExif();
    const upload = await api('POST', '/uploads', {
      token: access, raw: original,
      headers: { 'Content-Type': 'image/jpeg', 'X-Upload-Grant': grant.json.grant },
    });
    check(upload.status === 201 && upload.json.mediaType === 'image/jpeg',
      'evidence: the file is accepted', 'status ' + upload.status + ' ' + (upload.json && upload.json.reason));

    if (upload.status === 201) {
      const stored = fs.readFileSync(path.join(EVIDENCE_DIR, upload.json.objectKey));
      check(!stored.includes(Buffer.from('GPSLatitude')) && !stored.includes(Buffer.from('Artist')) &&
            stored.includes(Buffer.from('imagedatapretendingtobeascan')),
        'evidence: EXIF/GPS is stripped and the image data is kept',
        'bytes ' + original.length + ' -> ' + stored.length);

      const inPublic = fs.existsSync(path.join(ROOT, 'public', 'uploads', upload.json.objectKey));
      check(!inPublic && !path.resolve(EVIDENCE_DIR).includes(path.join(ROOT, 'public')),
        'evidence: nothing is written into the publicly served tree');

      const fetchOwn = await api('GET', `/evidence/${upload.json.evidenceId}`, { token: access });
      check(fetchOwn.status === 200 && fetchOwn.headers.get('content-disposition') === 'attachment',
        'evidence: the uploader can download it, as an attachment', 'status ' + fetchOwn.status);

      // A different household must not be able to read it.
      const otherCode = await api('POST', '/auth/request-code', { body: { email: 'api-other@test.invalid' } });
      const otherSignIn = await api('POST', '/auth/verify', {
        body: { email: 'api-other@test.invalid', code: otherCode.json.devCode },
      });
      const stranger = await api('GET', `/evidence/${upload.json.evidenceId}`, { token: otherSignIn.json.accessToken });
      check(stranger.status === 404,
        'evidence: another household cannot read it — and is told nothing about it',
        'status ' + stranger.status);
    }

    const badBytes = await api('POST', '/uploads', {
      token: access, raw: Buffer.from('this is not an image at all, it is a script'),
      headers: { 'Content-Type': 'image/jpeg', 'X-Upload-Grant': grant.json.grant },
    });
    check(badBytes.status === 400 && badBytes.json.error === 'unsupported_type',
      'evidence: the bytes are believed, not the Content-Type header',
      'status ' + badBytes.status);

    // ---- M7: event sessions batch a weekend ----
    const s1 = await api('POST', '/event-sessions', { token: access, body: { event_id: event.id } });
    const s2 = await api('POST', '/event-sessions', { token: access, body: { event_id: event.id } });
    check(s1.status === 201 && s2.status === 200 && s1.json.session.id === s2.json.session.id,
      'a session is get-or-create — asking twice rejoins the weekend, never starts a second one',
      s1.status + '/' + s2.status);

    const sessionId = s1.json.session.id;
    const batched = await api('POST', '/submissions', {
      token: access,
      body: { ...submitBody, client_submission_id: crypto.randomUUID(), event_session_id: sessionId },
    });
    check(batched.status === 201 && batched.json.submission.event_session_id === sessionId,
      'a submission joins the session', 'status ' + batched.status);

    // A session id belonging to another household must not let one family file
    // into another's batch.
    const otherCode2 = await api('POST', '/auth/request-code', { body: { email: 'api-other@test.invalid' } });
    const other2 = await api('POST', '/auth/verify', {
      body: { email: 'api-other@test.invalid', code: otherCode2.json.devCode },
    });
    const otherDn = await db.run(
      "INSERT INTO dancers (unique_id, name, is_claimed, claimed_by_user_id) VALUES ('DNC-api-other', 'API Other Dancer', 1, ?)",
      [u2.lastID]);
    const stolen = await api('POST', '/submissions', {
      token: other2.json.accessToken,
      body: {
        client_submission_id: crypto.randomUUID(), dancer_id: otherDn.lastID, event_id: event.id,
        performance_name: 'Stolen Session', group_size: 'solo', event_session_id: sessionId,
      },
    });
    check(stolen.status === 201 && stolen.json.submission.event_session_id === null,
      'another household\'s session id is dropped, not honoured — and the award still saves',
      'status ' + stolen.status + ' session=' + (stolen.json.submission || {}).event_session_id);

    const ctx = await api('GET', `/event-sessions/${sessionId}`, { token: access });
    check(ctx.status === 200 && ctx.json.submissionCount >= 1 && ctx.json.suggested.dancer_id === dn.lastID,
      'the session carries the weekend\'s context forward as suggestions',
      'count=' + (ctx.json.submissionCount));

    // ---- M7: card content rides with the submission ----
    const withCard = await api('POST', '/submissions', {
      token: access,
      body: {
        ...submitBody, client_submission_id: crypto.randomUUID(),
        performance_name: 'API Card Content Routine',
        thank_you_note: 'Thank you Miss API!',
        card_photo_object_key: 'ab/deadbeef.jpg',
        card_consent_affirmed: true,
      },
    });
    const cardRow = withCard.status === 201
      ? await (await openSubmissionsDb()).get(
          'SELECT * FROM award_submission_card_content WHERE submission_id = ?',
          [withCard.json.submission.id])
      : null;
    check(withCard.status === 201 && !!cardRow &&
          cardRow.thank_you_note === 'Thank you Miss API!' && cardRow.consent_affirmed === 1,
      'a photo and thank-you note are captured with the submission, before any award exists',
      'status ' + withCard.status + ' stored=' + !!cardRow);

    // Nothing is published by submitting: the canonical card tables stay empty
    // until a reviewer promotes the award.
    const prematureCard = await db.get(
      "SELECT COUNT(*) AS n FROM award_card_photos WHERE photo_url = 'ab/deadbeef.jpg'");
    check(prematureCard.n === 0,
      'card content is NOT written to the award tables by submitting — promotion does that, at pending');

    // ---- events picker ----
    const nearby = await api('GET', '/events/nearby?q=dance');
    check(nearby.status === 200 && Array.isArray(nearby.json.options),
      'the event picker answers guests too', 'status ' + nearby.status);

    // ---- refresh rotation + reuse detection ----
    const rotated = await api('POST', '/auth/refresh', { body: { refresh_token: refresh } });
    check(rotated.status === 200 && rotated.json.refreshToken !== refresh,
      'refresh: tokens rotate on every use', 'status ' + rotated.status);

    const reuse = await api('POST', '/auth/refresh', { body: { refresh_token: refresh } });
    const afterReuse = await api('GET', '/me', { token: rotated.json.accessToken });
    check(reuse.status === 401 && reuse.json.error === 'token_reuse' && afterReuse.status === 401,
      'refresh: replaying a rotated token kills the whole session — theft is assumed',
      'reuse=' + reuse.status + ' session=' + afterReuse.status);

    // ---- revoke is immediate ----
    const freshCode = await api('POST', '/auth/request-code', { body: { email: 'api-family@test.invalid' } });
    const fresh = await api('POST', '/auth/verify', {
      body: { email: 'api-family@test.invalid', code: freshCode.json.devCode },
    });
    const beforeRevoke = await api('GET', '/me', { token: fresh.json.accessToken });
    const revoke = await api('POST', '/auth/revoke', { token: fresh.json.accessToken, body: { all: true } });
    const afterRevoke = await api('GET', '/me', { token: fresh.json.accessToken });
    const afterRefresh = await api('POST', '/auth/refresh', { body: { refresh_token: fresh.json.refreshToken } });
    check(beforeRevoke.status === 200 && revoke.status === 200 &&
          afterRevoke.status === 401 && afterRefresh.status === 401,
      'revoke: the device is dead on the very next request, refresh token included',
      'before=' + beforeRevoke.status + ' after=' + afterRevoke.status + ' refresh=' + afterRefresh.status);

    // ---- the middleware-order property ----
    check(cookiesSeen.length === 0,
      'the API never issues a session cookie — it is mounted before the session store',
      cookiesSeen.length ? 'cookies on: ' + cookiesSeen.join(', ') : '0 cookies across ' + 'all calls');

  } catch (e) {
    failures++;
    console.error('FAIL  api test errored: ' + e.message);
    console.error(log.slice(-1500));
  } finally {
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nAll mobile API checks passed.' : `\n${failures} mobile API check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
