// Smoke test: boots the server on a test port and checks that public pages
// respond and admin endpoints reject anonymous requests.
// Run with: npm run smoke
const { spawn } = require('child_process');

const PORT = process.env.SMOKE_PORT || 3997;
const BASE = `http://localhost:${PORT}`;

const CHECKS = [
  // [method, path, expected status(es), description]
  ['GET', '/healthz', [200], 'health check'],
  ['GET', '/', [200], 'landing page (anonymous)'],
  ['GET', '/style.css', [200], 'landing stylesheet'],
  ['GET', '/dance', [200], 'dance vertical home'],
  ['GET', '/dance/studios', [403], 'studio directory admin-gated'],
  ['GET', '/studios', [301], 'legacy /studios redirects to /dance'],
  ['GET', '/studio/1', [404], 'legacy numeric studio URL is dead (no enumeration oracle)'],
  ['GET', '/login', [200], 'login page'],
  ['GET', '/forgot-password', [200], 'password reset request page'],
  ['GET', '/reset-password/000000', [410], 'bogus reset token rejected'],
  ['POST', '/forgot-password', [403], 'tokenless reset request blocked (CSRF)'],
  ['GET', '/register', [200], 'register page'],
  ['GET', '/faq/dancer', [200], 'dancer FAQ'],
  ['GET', '/verify-email?token=bogus', [400], 'bogus verification token rejected'],
  ['POST', '/api/merge/studios', [403], 'anonymous studio merge blocked'],
  ['POST', '/api/merge/dancers', [403], 'anonymous dancer merge blocked'],
  ['POST', '/api/reject-merge/studios', [403], 'anonymous reject-merge blocked'],
  ['POST', '/api/studios/1/investigate', [403], 'anonymous investigate blocked'],
  ['POST', '/api/studios/1/feature', [403], 'anonymous feature blocked'],
  ['GET', '/admin/orgs/1/award-vocab', [403], 'award vocab editor superadmin-gated'],
  ['GET', '/my-org', [302], 'anonymous my-org redirected to login'],
  ['GET', '/my-org/public', [302], 'anonymous my-org public redirected to login'],
  ['POST', '/admin/orgs/1/award-vocab/rename', [403], 'award vocab rename superadmin-gated'],
  ['POST', '/admin/orgs/1/award-vocab/top', [403], 'award vocab top-mark superadmin-gated'],
  ['GET', '/admin/compare/studios', [403], 'anonymous compare blocked'],
  ['POST', '/admin/backfill-dancers/1', [403], 'anonymous backfill blocked'],
  ['GET', '/admin', [403], 'anonymous admin dashboard blocked'],
  ['GET', '/admin/users', [403], 'anonymous user management blocked'],
  ['PUT', '/api/studio/ai-summary/1', [403], 'anonymous ai-summary edit blocked (CSRF)'],
  ['GET', '/manage/studio/1', [302], 'anonymous studio manage redirected to login'],
  ['POST', '/manage/studio/1/onboarding/dismiss', [403], 'anonymous onboarding dismiss blocked (CSRF)'],
  ['GET', '/manage/org/1', [302], 'anonymous org manage redirected to login'],
  ['GET', '/dance/events', [200], 'upcoming events directory'],
  ['GET', '/dance/events?state=TX&month=2027-01&org=1', [200], 'upcoming events directory with filters'],
  ['GET', '/dance/events?state=Texas', [200], 'upcoming events directory ignores malformed filters'],
  ['GET', '/dance/events?near=32.78,-96.80', [200], 'upcoming events near-me view'],
  ['GET', '/dance/events?near=bogus', [200], 'upcoming events malformed near ignored'],
  ['GET', '/dance/events?saved=1', [302], 'anonymous shortlist filter redirected to login'],
  ['GET', '/dance/events.ics', [200], 'upcoming events calendar export'],
  ['GET', '/dance/events.ics?saved=1', [401], 'anonymous shortlist export blocked'],
  ['POST', '/api/upcoming/1/save', [403], 'anonymous shortlist toggle blocked (CSRF)'],
  ['POST', '/manage/org/1/upcoming', [403], 'anonymous upcoming-event add blocked (CSRF)'],
  ['POST', '/manage/org/1/upcoming/1/gold', [403], 'anonymous gold placement blocked (CSRF)'],
  ['POST', '/manage/org/1/upcoming/1/delete', [403], 'anonymous upcoming-event delete blocked (CSRF)'],
  ['GET', '/manage/dancer/1/card', [302], 'anonymous dancer card-extras redirected to login'],
  ['GET', '/my-dancers', [302], 'anonymous my-dancers redirected to login'],
  ['POST', '/manage/dancer/1/card/ack', [403], 'anonymous card ack blocked (CSRF)'],
  ['POST', '/manage/dancer/1/card/photo', [403], 'anonymous card photo upload blocked (CSRF)'],
  ['POST', '/manage/dancer/1/card/award-photo', [403], 'anonymous award photo upload blocked (CSRF)'],
  ['POST', '/api/admin/card-award-photo/1', [403], 'anonymous award-photo moderation blocked'],
  ['GET', '/admin/card-content', [403], 'anonymous card-content review blocked'],
  ['GET', '/admin/features', [403], 'anonymous feature-flag console blocked'],
  ['POST', '/api/admin/features', [403], 'anonymous flag update blocked'],
  ['POST', '/api/admin/card-ack/1/revoke', [403], 'anonymous ack revoke blocked'],
  ['POST', '/manage/studio/1/verifications/profile/1/approve', [403], 'anonymous profile-claim approve blocked (CSRF)'],
  ['POST', '/admin/claims/dancer/1/approve', [403], 'anonymous dancer-claim approve blocked'],
  ['POST', '/api/admin/card-photo/1', [403], 'anonymous card-photo moderation blocked'],
  ['POST', '/api/admin/card-ack/1', [403], 'anonymous card-ack moderation blocked'],
  ['POST', '/resend-verification', [403], 'tokenless resend-verification blocked (CSRF)'],
  ['POST', '/admin/featured/recompute', [403], 'anonymous featured recompute blocked'],
  ['POST', '/api/award/1/react', [403], 'tokenless award reaction blocked (CSRF)'],
  ['POST', '/admin/marketing/studios/1/send-invite', [403], 'anonymous invite send blocked'],
  ['GET', '/unsubscribe?e=bogus&t=bad', [400], 'bad unsubscribe token rejected'],
  
  ['POST', '/claim/studio/1/apply', [403], 'tokenless claim apply blocked (CSRF)'],
  ['POST', '/claim/dancer/1/apply', [403], 'tokenless dancer apply blocked (CSRF)'],
  ['GET', '/dance/leaderboard/studios-alltime', [200], 'leaderboard fragment renders'],
  ['GET', '/dance/leaderboard/bogus', [404], 'unknown leaderboard rejected'],
  ['GET', '/dance/api/search?q=a', [200], 'hero search rejects short query gracefully'],
  ['GET', '/dance/api/search?q=dance', [200], 'hero search returns results'],
  ['GET', '/manage/dancer/1/submissions', [302], 'anonymous family submissions redirected to login'],
  ['POST', '/manage/dancer/1/submissions', [403], 'anonymous family submission blocked (CSRF)'],
  ['GET', '/api/dancer/1/event-search?q=dance', [302], 'anonymous event search redirected to login'],
  ['GET', '/api/dancer/1/event-picker?q=dance', [302], 'anonymous event picker redirected to login'],
  ['POST', '/api/dancer/1/event-candidates', [403], 'anonymous event-candidate create blocked (CSRF)'],
  ['POST', '/api/dancer/1/event-candidates/check', [403], 'anonymous dedup check blocked (CSRF)'],
  ['GET', '/admin/event-candidates', [403], 'anonymous candidate queue blocked'],
  ['POST', '/admin/event-candidates/1/promote', [403], 'anonymous candidate promotion blocked'],
  ['POST', '/admin/event-candidates/1/merge', [403], 'anonymous candidate merge blocked'],
];

// Family submissions stage in their OWN SQLite file (utils/submissionsDb.js).
// Point both this process and the server at a throwaway copy so the suite
// never writes to a real staging database.
const SUBMISSIONS_DB = require('path').join(require('os').tmpdir(), 'awardhome_smoke_submissions.sqlite');

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(BASE + '/', { redirect: 'manual' });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('Server did not start within ' + timeoutMs + 'ms');
}

async function main() {
  // Start from a clean staging file, and both processes must agree on it.
  for (const ext of ['', '-wal', '-shm']) require('fs').rmSync(SUBMISSIONS_DB + ext, { force: true });
  process.env.SUBMISSIONS_DB_PATH = SUBMISSIONS_DB;

  // The family-submission surfaces are behind a feature flag that ships dark.
  // Flip it ON in the database BEFORE the server boots, so its flag cache is
  // never warmed with the wrong value, and restore it afterwards.
  let priorFlagState = null;
  try {
    const { openDb } = require('../database');
    const db = await openDb();
    const row = await db.get("SELECT state FROM feature_flags WHERE key = 'family_submissions'");
    priorFlagState = row ? row.state : null;
    await db.run("INSERT INTO feature_flags (key, state) VALUES ('family_submissions', 'on') " +
      "ON CONFLICT(key) DO UPDATE SET state = 'on'");
  } catch (e) {
    console.log('NOTE: could not enable family_submissions flag (' + e.message + ')');
  }

  const server = spawn('node', ['server.js'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
      SUBMISSIONS_DB_PATH: SUBMISSIONS_DB,
      PORT: String(PORT),
      EMAIL_PROVIDER: '',          // never send real email from the smoke test
      ENABLE_NIGHTLY_BACKUPS: 'false',
      BETA_MODE: 'false',          // smoke tests the real pages, not the beta gate
      PROFILE_RATE_LIMIT: '25',    // low ceiling so the anti-scrape burst check trips fast
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });

  let failures = 0;
  try {
    await waitForServer();

    // Real-content checks: hit an actual studio profile and dancer trophy
    // case so the heaviest views render end-to-end.
    let burstPath = null;
    try {
      const { openDb } = require('../database');
      const db = await openDb();
      const studio = await db.get("SELECT id, unique_id FROM studios WHERE status = 'active' ORDER BY id LIMIT 1");
      const dancer = await db.get('SELECT id, unique_id FROM dancers ORDER BY id LIMIT 1');
      const event = await db.get('SELECT id FROM events ORDER BY id LIMIT 1');
      if (studio) CHECKS.push(['GET', `/dance/studio/${studio.unique_id}`, [200], 'real studio profile renders']);
      if (studio) CHECKS.push(['GET', `/dance/studio/${studio.id}`, [404], 'numeric studio id 404s on public page']);
      if (studio) CHECKS.push(['GET', `/dance/studio/${studio.unique_id}?design=rafters`, [200], 'Rafters design preview renders (?design=rafters)']);
      if (studio) CHECKS.push(['GET', `/claim/studio/${studio.unique_id}`, [200], 'claim page public (one-page apply)']);
      if (studio) burstPath = `/dance/studio/${studio.unique_id}`;
      if (dancer) CHECKS.push(['GET', `/dancer/${dancer.unique_id}`, [200], 'real dancer trophy case renders']);
      if (dancer) CHECKS.push(['GET', `/dancer/${dancer.unique_id}?design=rafters&card_design=rafters`, [200], 'dancer Rafters preview + rafters card variant render']);
      if (dancer) CHECKS.push(['GET', `/dancer/${dancer.unique_id}?card_design=default`, [200], 'card design session override clears']);
      if (dancer) CHECKS.push(['GET', `/claim/dancer/${dancer.id}`, [200], 'dancer claim page public (one-page apply)']);
      if (event) CHECKS.push(['GET', `/dance/event/${event.id}`, [403], 'event detail stays admin-gated']);
      if (studio) CHECKS.push(['GET', `/widget/studio/${studio.unique_id}`, [200], 'embeddable widget renders']);
      const org = await db.get('SELECT slug FROM organizations ORDER BY id LIMIT 1');
      if (org) CHECKS.push(['GET', `/dance/org/${org.slug}`, [200], 'org page is public']);
      if (org) CHECKS.push(['GET', `/dance/org/${org.slug}?design=rafters`, [200], 'org Rafters design preview renders (?design=rafters)']);
      CHECKS.push(['GET', '/?design=rafters', [200], 'Front Door landing variant renders (?design=rafters)']);
      CHECKS.push(['GET', '/dance?design=rafters', [200], 'Hall homepage renders (?design=rafters alias)']);
      // Post-cutover (2026-08-24): Rafters is the default everywhere;
      // ?design=v0 is the classic escape hatch and must stay reachable.
      CHECKS.push(['GET', '/?design=v0', [200], 'classic landing escape hatch (?design=v0)']);
      CHECKS.push(['GET', '/dance?design=v0', [200], 'classic homepage escape hatch (?design=v0)']);
      if (studio) CHECKS.push(['GET', `/dance/studio/${studio.unique_id}?design=v0`, [200], 'classic studio page escape hatch (?design=v0)']);
      if (org) CHECKS.push(['GET', `/dance/org/${org.slug}?design=v0`, [200], 'classic org page escape hatch (?design=v0)']);
      if (dancer) CHECKS.push(['GET', `/dancer/${dancer.unique_id}?design=v0`, [200], 'classic dancer page escape hatch (?design=v0)']);
    } catch (e) {
      console.log('NOTE: real-content checks skipped (' + e.message + ')');
    }

    // CSRF-aware checks: fetch a page to obtain a session cookie + token,
    // then confirm state-changing endpoints work WITH the token (so the
    // original validation/auth behavior is still exercised end-to-end).
    let csrfHeaders = null;
    let claimUid = 'unknown';
    try {
      const { openDb: odb } = require('../database');
      const cdb = await odb();
      const cs = await cdb.get("SELECT unique_id FROM studios WHERE status = 'active' ORDER BY id LIMIT 1");
      if (cs) claimUid = cs.unique_id;
    } catch (e) {}
    try {
      const loginRes = await fetch(BASE + '/login');
      const cookie = (loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
      const tokenMatch = (await loginRes.text()).match(/<meta name="csrf-token" content="([^"]+)"/);
      if (cookie && tokenMatch) {
        csrfHeaders = { 'Content-Type': 'application/json', 'Cookie': cookie, 'X-CSRF-Token': tokenMatch[1] };
        CHECKS.push(
          ['POST', '/resend-verification', [200], 'resend-verification responds (with CSRF token)', csrfHeaders],
          ['POST', `/claim/studio/${claimUid}/apply`, [400], 'apply validates input (with CSRF token)', csrfHeaders],
          ['POST', '/claim/dancer/1/apply', [400, 404], 'dancer apply validates input (with CSRF token)', csrfHeaders],
          ['POST', '/manage/studio/1/onboarding/dismiss', [302], 'anonymous onboarding dismiss redirected to login (with CSRF token)', csrfHeaders],
          // 404 while the 'reactions' flag is off or beta (anonymous caller)
          ['POST', '/api/award/1/react', [404], 'reaction endpoint dark while flag off (with CSRF token)', csrfHeaders],
          ['POST', '/api/org-card-click', [400], 'org card click telemetry validates input (with CSRF token)', csrfHeaders],
        );
      } else {
        failures++;
        console.log('FAIL  could not extract session cookie + CSRF token from /login');
      }
    } catch (e) {
      failures++;
      console.log('FAIL  CSRF token bootstrap errored: ' + e.message);
    }

    for (const [method, path, expected, desc, headers] of CHECKS) {
      let status;
      try {
        const res = await fetch(BASE + path, {
          method,
          redirect: 'manual',
          headers: headers || { 'Content-Type': 'application/json' },
          body: method === 'GET' ? undefined : '{}',
        });
        status = res.status;
      } catch (e) {
        status = 'ERR: ' + e.message;
      }
      const ok = expected.includes(status);
      if (!ok) failures++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${method.padEnd(4)} ${path}  -> ${status} (expected ${expected.join('/')})  ${desc}`);
    }

    // Owner-flow checks: a real studio owner must be able to render the
    // manage surfaces with content (regression: /history threw on a bare
    // `app` reference the anonymous 302 check couldn't catch), and a
    // pending claimant must land on their studio page and see the
    // approval-pending state instead of the parent/dancer flow.
    try {
      const bcrypt = require('bcrypt');
      const { openDb } = require('../database');
      const db = await openDb();
      // Pre-clean leftovers from a crashed prior run
      await db.run("DELETE FROM studio_claims WHERE proof_text = 'smoke-fixture'");
      await db.run("DELETE FROM award_dancer_removals WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
      await db.run("DELETE FROM award_dancers WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')");
      await db.run("DELETE FROM dancer_studios WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')");
      await db.run("DELETE FROM dancers WHERE name LIKE 'Smoke Dancer%'");
      await db.run("DELETE FROM awards WHERE award_type IN ('Top Smoke Studio', 'Top Smoke Small Group')");
      await db.run("DELETE FROM studios WHERE unique_id IN ('smoke-studio-1', 'smoke-studio-2')");
      await db.run("DELETE FROM users WHERE email LIKE 'smoke-%@test.invalid'");

      const hash = bcrypt.hashSync('smoke-test-pass-1', 4);
      const event = await db.get('SELECT id, year FROM events WHERE year IS NOT NULL ORDER BY id LIMIT 1');
      const ids = { users: [], studios: [], awards: [], claims: [] };
      try {
        const u1 = await db.run("INSERT INTO users (email, password_hash, role, is_verified) VALUES ('smoke-owner@test.invalid', ?, 'studio_owner', 1)", [hash]);
        const u2 = await db.run("INSERT INTO users (email, password_hash, role, is_verified) VALUES ('smoke-claimant@test.invalid', ?, 'user', 1)", [hash]);
        // Reviewer fixture: promoting an event candidate to a canonical event
        // is AwardHome's decision alone, so the M2 promotion checks need one.
        const u3 = await db.run("INSERT INTO users (email, password_hash, role, is_verified) VALUES ('smoke-super@test.invalid', ?, 'superadmin', 1)", [hash]);
        ids.users.push(u1.lastID, u2.lastID, u3.lastID);
        // s2's name contains s1's base name so the manage page must show
        // it as a merge suggestion (with award context) for s1's owner.
        const s1 = await db.run("INSERT INTO studios (unique_id, name, status, is_claimed, owner_id) VALUES ('smoke-studio-1', 'Smoke Test Studio', 'active', 1, ?)", [u1.lastID]);
        const s2 = await db.run("INSERT INTO studios (unique_id, name, status, is_claimed) VALUES ('smoke-studio-2', 'Smoke Test Studio Two', 'active', 0)");
        ids.studios.push(s1.lastID, s2.lastID);
        const aw = await db.run("INSERT INTO awards (event_id, studio_id, performance_name, award_type, category, place, award_class) VALUES (?, ?, '', 'Top Smoke Studio', '', '', 'studio')", [event.id, s1.lastID]);
        ids.awards.push(aw.lastID);
        // Group routine + one roster dancer for the group-dancers flow
        const gaw = await db.run("INSERT INTO awards (event_id, studio_id, performance_name, award_type, category, place, award_class) VALUES (?, ?, 'Smoke Group Routine', 'Top Smoke Small Group', '', '1st', 'adjudication')", [event.id, s1.lastID]);
        ids.awards.push(gaw.lastID);
        const rosterDancer = await db.run("INSERT INTO dancers (unique_id, name) VALUES ('smoke-dancer-1', 'Smoke Dancer One')");
        await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [rosterDancer.lastID, s1.lastID]);
        // A SOLO linked only through the junction (no awards.dancer_id) — the
        // exact shape five importers produced, which made the dancer show
        // under "Group Dancers". And a GROUP with one linked dancer (a partly
        // entered cast), which must NOT be promoted to a solo.
        const soloAw = await db.run("INSERT INTO awards (event_id, studio_id, performance_name, award_type, category, place, award_class) VALUES (?, ?, 'Smoke Solo Routine', '', 'Teen Advanced Solos', '1st', 'adjudication')", [event.id, s1.lastID]);
        ids.awards.push(soloAw.lastID);
        await db.run('INSERT INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, ?)', [soloAw.lastID, rosterDancer.lastID, 'import']);
        const partialGroupAw = await db.run("INSERT INTO awards (event_id, studio_id, performance_name, award_type, category, place, award_class) VALUES (?, ?, 'Smoke Partial Group', '', 'Teen Small Groups', '2nd', 'adjudication')", [event.id, s1.lastID]);
        ids.awards.push(partialGroupAw.lastID);
        await db.run('INSERT INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, ?)', [partialGroupAw.lastID, rosterDancer.lastID, 'import']);
        ids.soloAwardId = soloAw.lastID;
        ids.partialGroupAwardId = partialGroupAw.lastID;
        const cl = await db.run("INSERT INTO studio_claims (user_id, studio_id, proof_text, status) VALUES (?, ?, 'smoke-fixture', 'pending')", [u2.lastID, s2.lastID]);
        ids.claims.push(cl.lastID);

        const login = async (email) => {
          const page = await fetch(BASE + '/login');
          const cookie = (page.headers.getSetCookie ? page.headers.getSetCookie() : [page.headers.get('set-cookie')])
            .filter(Boolean).map(c => c.split(';')[0]).join('; ');
          const token = (await page.text()).match(/<meta name="csrf-token" content="([^"]+)"/)[1];
          const res = await fetch(BASE + '/login', {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
            body: `email=${encodeURIComponent(email)}&password=smoke-test-pass-1&_csrf=${encodeURIComponent(token)}`
          });
          return { cookie, status: res.status, location: res.headers.get('location') || '' };
        };
        const check = (ok, desc, detail) => {
          if (!ok) failures++;
          console.log(`${ok ? 'PASS' : 'FAIL'}  ${desc}${detail ? '  [' + detail + ']' : ''}`);
        };

        const owner = await login('smoke-owner@test.invalid');
        check(owner.status === 302 && owner.location === '/dance/studio/smoke-studio-1',
          'owner login redirects to their studio page', owner.status + ' -> ' + owner.location);
        const hist = await fetch(BASE + `/manage/studio/${s1.lastID}/history`, { headers: { Cookie: owner.cookie } });
        check(hist.status === 200, 'owner studio history renders', 'status ' + hist.status);
        const rosterRes = await fetch(BASE + `/manage/studio/${s1.lastID}/roster`, { headers: { Cookie: owner.cookie } });
        const rosterHtml = await rosterRes.text();
        check(rosterRes.status === 200 && rosterHtml.includes('function openMergeModal') && rosterHtml.includes('Compare &amp; Merge — select 2 dancers'),
          'roster renders with Compare & Merge wiring present', 'status ' + rosterRes.status);
        const mg = await fetch(BASE + `/manage/studio/${s1.lastID}`, { headers: { Cookie: owner.cookie } });
        const mgHtml = await mg.text();
        check(mg.status === 200 && mgHtml.includes('Merge Suggestions') && mgHtml.includes('Smoke Test Studio Two'),
          'manage dashboard shows merge suggestion with award context', 'status ' + mg.status);
        check(mgHtml.includes('Manage Studio') && mgHtml.includes('Public View'),
          'owner navbar shows Manage Studio + Public View');
        const pv = await fetch(BASE + '/my-studio/public', { redirect: 'manual', headers: { Cookie: owner.cookie } });
        check(pv.status === 302 && pv.headers.get('location') === '/dance/studio/smoke-studio-1',
          'Public View redirects to the owner\'s studio page', pv.status + ' -> ' + pv.headers.get('location'));
        const awRes = await fetch(BASE + `/manage/studio/${s1.lastID}/awards?year=${event.year}&view=routines&sort=name`, { headers: { Cookie: owner.cookie } });
        const awHtml = await awRes.text();
        check(awRes.status === 200 && awHtml.includes('Studio Awards'),
          'awards editor groups placeless awards as "Studio Awards"', 'status ' + awRes.status);

        // A junction-only SOLO must render its dancer as PRIMARY (marked
        // "(linked)" since the stored column is still empty), while a GROUP
        // with a partly-entered cast must be left in the group column — the
        // asymmetry is the whole safety rule of utils/soloPrimary.js.
        const awAll = await fetch(BASE + `/manage/studio/${s1.lastID}/awards?year=all`, { headers: { Cookie: owner.cookie } });
        const awAllHtml = await awAll.text();
        // Slice the exact <tr> by data-award-id rather than guessing a
        // character window: the Type & Category cell carries long inline
        // styles, so an offset-based window silently misses the cell.
        const rowFor = (id) => {
          const start = awAllHtml.indexOf(`data-award-id="${id}"`);
          if (start === -1) return '';
          const end = awAllHtml.indexOf('</tr>', start);
          return awAllHtml.slice(start, end === -1 ? undefined : end);
        };
        const soloRow = rowFor(ids.soloAwardId);
        const groupRow = rowFor(ids.partialGroupAwardId);
        check(awAll.status === 200 && soloRow.includes('Smoke Dancer One') && soloRow.includes('(linked)'),
          'junction-only solo shows its dancer as Primary, marked "(linked)"',
          'status ' + awAll.status + ' rowFound=' + !!soloRow);
        check(groupRow.includes('Smoke Dancer One') && !groupRow.includes('(linked)'),
          'partly-cast GROUP keeps its dancer in the group column, NOT promoted',
          'rowFound=' + !!groupRow);

        // Group Routine Dancers: page renders, preview classifies against
        // the roster without writing, apply links the confirmed cast.
        const gdPage = await fetch(BASE + `/manage/studio/${s1.lastID}/group-dancers`, { headers: { Cookie: owner.cookie } });
        const gdHtml = await gdPage.text();
        check(gdPage.status === 200 && gdHtml.includes('Smoke Group Routine'),
          'group-dancers page lists the group routine', 'status ' + gdPage.status);
        const ownerToken = (gdHtml.match(/<meta name="csrf-token" content="([^"]+)"/) || [])[1];
        const gdHeaders = { 'Content-Type': 'application/json', 'Cookie': owner.cookie, 'X-CSRF-Token': ownerToken };
        const pv1 = await fetch(BASE + `/manage/studio/${s1.lastID}/group-dancers/preview`, {
          method: 'POST', headers: gdHeaders,
          body: JSON.stringify({ routine: 'Smoke Group Routine', year: event.year, names: 'Smoke Dancer One\nSmoke Dancer Two' })
        });
        const pd = pv1.status === 200 ? await pv1.json() : { results: [] };
        const classified = pd.results.length === 2 && pd.results[0].status === 'matched' && pd.results[1].status === 'new';
        check(classified, 'group-dancers preview classifies roster match vs new dancer',
          pv1.status + ' ' + JSON.stringify((pd.results || []).map(r => r.status)));
        if (classified) {
          const ap = await fetch(BASE + `/manage/studio/${s1.lastID}/group-dancers/apply`, {
            method: 'POST', headers: gdHeaders,
            body: JSON.stringify({ routine: 'Smoke Group Routine', year: event.year, entries: [
              { name: 'Smoke Dancer One', dancer_id: pd.results[0].candidates[0].id },
              { name: 'Smoke Dancer Two', dancer_id: 'new' },
            ] })
          });
          const ad = ap.status === 200 ? await ap.json() : {};
          const linkCount = await db.get('SELECT COUNT(*) AS n FROM award_dancers WHERE award_id = ?', [gaw.lastID]);
          check(ap.status === 200 && ad.created === 1 && linkCount.n === 2,
            'group-dancers apply links roster dancer + creates new one', ap.status + ' created=' + ad.created + ' links=' + linkCount.n);

          // Provenance + tombstone lifecycle: owner-applied links carry
          // source, removal tombstones the pair, re-adding clears it.
          const src = await db.get('SELECT source, created_at FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [gaw.lastID, rosterDancer.lastID]);
          check(src && src.source === 'studio_owner' && !!src.created_at,
            'owner-applied link records source + timestamp', JSON.stringify(src));
          const rm = await fetch(BASE + `/manage/studio/${s1.lastID}/group-dancers/remove`, {
            method: 'POST', headers: gdHeaders,
            body: JSON.stringify({ routine: 'Smoke Group Routine', year: event.year, dancer_id: rosterDancer.lastID })
          });
          const tomb = await db.get('SELECT 1 AS t FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [gaw.lastID, rosterDancer.lastID]);
          check(rm.status === 200 && tomb && tomb.t === 1,
            'owner removal writes a tombstone', 'status ' + rm.status);
          const reapply = await fetch(BASE + `/manage/studio/${s1.lastID}/group-dancers/apply`, {
            method: 'POST', headers: gdHeaders,
            body: JSON.stringify({ routine: 'Smoke Group Routine', year: event.year, entries: [
              { name: 'Smoke Dancer One', dancer_id: rosterDancer.lastID },
            ] })
          });
          const tomb2 = await db.get('SELECT 1 AS t FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [gaw.lastID, rosterDancer.lastID]);
          const relink = await db.get('SELECT source FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [gaw.lastID, rosterDancer.lastID]);
          check(reapply.status === 200 && !tomb2 && relink && relink.source === 'studio_owner',
            'owner re-add clears the tombstone and relinks', 'tombstone=' + !!tomb2 + ' link=' + JSON.stringify(relink));

          // Same-name disambiguation: second roster dancer with the same
          // name → preview turns ambiguous with routine context; the
          // director's private tag saves and comes back in candidates.
          const twin = await db.run("INSERT INTO dancers (unique_id, name) VALUES ('smoke-dancer-1b', 'Smoke Dancer One')");
          await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [twin.lastID, s1.lastID]);
          const lb = await fetch(BASE + `/manage/studio/${s1.lastID}/roster/${rosterDancer.lastID}/label`, {
            method: 'POST', headers: gdHeaders, body: JSON.stringify({ label: 'Senior Smoke' })
          });
          const pv2 = await fetch(BASE + `/manage/studio/${s1.lastID}/group-dancers/preview`, {
            method: 'POST', headers: gdHeaders,
            body: JSON.stringify({ routine: 'Smoke Group Routine', year: event.year, names: 'Smoke Dancer One' })
          });
          const pd2 = pv2.status === 200 ? await pv2.json() : { results: [] };
          const amb = pd2.results[0] || {};
          const tagged = (amb.candidates || []).find(c => c.label === 'Senior Smoke');
          const withRoutines = (amb.candidates || []).some(c => (c.recent_routines || '').includes('Smoke Group Routine'));
          check(lb.status === 200 && amb.status === 'ambiguous' && amb.candidates.length === 2 && !!tagged && withRoutines,
            'same-name twin previews ambiguous with private tag + routine context',
            pv2.status + ' status=' + amb.status + ' tagged=' + !!tagged + ' routines=' + withRoutines);
        }

        // ---- M1: family award submissions ----
        // The whole contract in one pass: a claimed family submits, it shows
        // as Pending in their private view, a retry with the same
        // idempotency key returns the ORIGINAL row, and nothing canonical or
        // public is created by any of it.
        const famDancer = await db.run(
          "INSERT INTO dancers (unique_id, name, is_claimed, claimed_by_user_id) VALUES ('smoke-dancer-fam', 'Smoke Dancer Family', 1, ?)",
          [u1.lastID]);
        await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [famDancer.lastID, s1.lastID]);

        const subPage = await fetch(BASE + `/manage/dancer/${famDancer.lastID}/submissions`, { headers: { Cookie: owner.cookie } });
        const subHtml = await subPage.text();
        check(subPage.status === 200 && subHtml.includes('Add a missing award') && subHtml.includes('Smoke Test Studio'),
          'family submissions page renders with the studio derived from affiliation', 'status ' + subPage.status);

        const subToken = (subHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
        const IDEM = 'smoke-idem-0001';
        const postSubmission = (extra) => fetch(BASE + `/manage/dancer/${famDancer.lastID}/submissions`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
          body: new URLSearchParams({
            _csrf: subToken,
            client_submission_id: IDEM,
            event_id: String(event.id),
            performance_name: '  Smoke   Submitted Routine ',
            group_size: 'small_group',
            place: '1st',
            cast_complete: '1', // must be IGNORED: a small group is never a complete cast
            ...extra,
          }).toString(),
        });

        const { openSubmissionsDb } = require('../utils/submissionsDb');
        const sdb = await openSubmissionsDb();

        const sub1 = await postSubmission({});
        const rows1 = await sdb.all('SELECT * FROM award_submissions WHERE client_submission_id = ?', [IDEM]);
        const r1 = rows1[0] || {};
        check(sub1.status === 302 && (sub1.headers.get('location') || '').includes('added=1') && rows1.length === 1,
          'family submission accepted', sub1.status + ' -> ' + sub1.headers.get('location') + ' rows=' + rows1.length);
        check(r1.performance_name === 'Smoke Submitted Routine' && r1.studio_id === s1.lastID &&
              r1.status === 'submitted' && r1.verification_level === 'family_submitted',
          'submission is normalised server-side, studio derived, staged as family_submitted',
          JSON.stringify({ name: r1.performance_name, studio: r1.studio_id, status: r1.status, level: r1.verification_level }));
        check(r1.group_size === 'small_group' && r1.cast_complete === 0,
          'a group submission records an explicitly INCOMPLETE cast, whatever the client claimed',
          'group_size=' + r1.group_size + ' cast_complete=' + r1.cast_complete);

        const pending = await fetch(BASE + `/manage/dancer/${famDancer.lastID}/submissions`, { headers: { Cookie: owner.cookie } });
        const pendingHtml = await pending.text();
        const subRow = (() => {
          const start = pendingHtml.indexOf(`data-submission-id="${r1.id}"`);
          if (start === -1) return '';
          const end = pendingHtml.indexOf('</div>', pendingHtml.indexOf('data-submission-status', start));
          return pendingHtml.slice(start, end === -1 ? undefined : end);
        })();
        check(subRow.includes('Smoke Submitted Routine') && subRow.includes('Pending review'),
          'submission shows as Pending in the household\'s private view', 'rowFound=' + !!subRow);

        const sub2 = await postSubmission({});
        const rows2 = await sdb.all('SELECT * FROM award_submissions WHERE client_submission_id = ?', [IDEM]);
        check(sub2.status === 302 && (sub2.headers.get('location') || '').includes('duplicate=1') &&
              rows2.length === 1 && rows2[0].id === r1.id,
          'retrying the same idempotency key returns the original row, no duplicate',
          sub2.status + ' -> ' + sub2.headers.get('location') + ' rows=' + rows2.length);

        // Nothing canonical, nothing public. A submission is a staging fact
        // until a reviewer promotes it (M3).
        const canonical = await db.get(
          "SELECT COUNT(*) AS n FROM awards WHERE performance_name LIKE '%Smoke Submitted Routine%'");
        const famPublic = await fetch(BASE + '/dancer/smoke-dancer-fam');
        const famPublicHtml = await famPublic.text();
        check(canonical.n === 0 && !famPublicHtml.includes('Smoke Submitted Routine'),
          'a pending submission creates NO canonical award and appears on no public page',
          'canonicalAwards=' + canonical.n + ' onPublicPage=' + famPublicHtml.includes('Smoke Submitted Routine'));

        // Group size is required: it decides the canonical write path, so a
        // submission without it must be refused, not guessed at.
        const noSize = await postSubmission({ client_submission_id: 'smoke-idem-0002', group_size: '' });
        check(noSize.status === 400, 'submission without a group size is refused', 'status ' + noSize.status);

        // ---- M1: independent dancers are invisible to studio surfaces ----
        const indep = await db.get(
          "SELECT s.id, s.unique_id, s.name FROM studios s WHERE COALESCE(s.is_independent,0) = 1 " +
          "AND (SELECT COUNT(*) FROM dancer_studios ds WHERE ds.studio_id = s.id) = 1 LIMIT 1");
        if (indep) {
          const indepPage = await fetch(BASE + `/dance/studio/${indep.unique_id}`, { redirect: 'manual' });
          check(indepPage.status === 302 && (indepPage.headers.get('location') || '').startsWith('/dancer/'),
            'an independent dancer\'s synthetic studio has no studio page — it redirects to the dancer',
            indepPage.status + ' -> ' + indepPage.headers.get('location'));
          const term = indep.name.split('(')[0].trim().slice(0, 20);
          const searchRes = await fetch(BASE + `/dance/api/search?q=${encodeURIComponent(term)}`);
          const searchJson = searchRes.status === 200 ? await searchRes.json() : { studios: [] };
          check(!(searchJson.studios || []).some(s => s.unique_id === indep.unique_id),
            'independent synthetic studios are excluded from public studio search',
            'hits=' + (searchJson.studios || []).length);
        } else {
          console.log('NOTE: independent-studio checks skipped (migration not applied to this DB)');
        }

        const claimant = await login('smoke-claimant@test.invalid');
        check(claimant.status === 302 && claimant.location === '/dance/studio/smoke-studio-2',
          'pending claimant login lands on their claimed studio', claimant.status + ' -> ' + claimant.location);
        const sp = await fetch(BASE + claimant.location, { headers: { Cookie: claimant.cookie } });
        const spHtml = await sp.text();
        check(sp.status === 200 && spHtml.includes('approval pending'),
          'studio page shows the verification-pending banner', 'status ' + sp.status);
        const md = await fetch(BASE + '/my-dancers', { headers: { Cookie: claimant.cookie } });
        const mdHtml = await md.text();
        check(md.status === 200 && mdHtml.includes('approval pending'),
          'my-dancers shows the studio-claim pending state', 'status ' + md.status);

        // ---- M2: the event picker and event candidates ----
        // The four acceptance criteria in order: one-tap pick at a known
        // event, a created candidate selectable by a SECOND household
        // immediately, the dedup offer + shared cluster when two families
        // create the same event minutes apart, and — through all of it — not
        // one canonical `events` row written by a family action.
        const canonicalBefore = (await db.get('SELECT COUNT(*) AS n FROM events')).n;
        const upcoming = await db.get(
          "SELECT id, name, start_date, lat, lng FROM org_upcoming_events WHERE status = 'active' AND lat IS NOT NULL ORDER BY id LIMIT 1");

        if (upcoming) {
          const pickRes = await fetch(BASE + `/api/dancer/${famDancer.lastID}/event-picker` +
            `?lat=${upcoming.lat}&lng=${upcoming.lng}&date=${upcoming.start_date}`,
            { headers: { Cookie: owner.cookie } });
          const pickJson = pickRes.status === 200 ? await pickRes.json() : { options: [] };
          const hit = (pickJson.options || []).find(o => o.kind === 'upcoming' && o.id === upcoming.id);
          check(pickRes.status === 200 && !!hit && hit.distance_miles != null && hit.distance_miles < 1,
            'a family standing at a known event finds it in the picker, geo-matched',
            pickRes.status + ' options=' + (pickJson.options || []).length + ' hit=' + !!hit);

          // Picking an organizer-announced stop seeds exactly one candidate,
          // lazily at submit time — browsing the picker must never write.
          const preSeed = await sdb.get('SELECT COUNT(*) AS n FROM event_candidates WHERE upcoming_event_id = ?', [upcoming.id]);
          const upSub = await fetch(BASE + `/manage/dancer/${famDancer.lastID}/submissions`, {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
            body: new URLSearchParams({
              _csrf: subToken, client_submission_id: 'smoke-idem-up-1',
              upcoming_event_id: String(upcoming.id),
              performance_name: 'Smoke Upcoming Routine', group_size: 'solo', place: '2nd',
            }).toString(),
          });
          const seeded = await sdb.get('SELECT * FROM event_candidates WHERE upcoming_event_id = ?', [upcoming.id]);
          const upRow = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-idem-up-1'");
          check(preSeed.n === 0 && upSub.status === 302 && !!seeded && seeded.source === 'org_upcoming' &&
                !!upRow && upRow.event_candidate_id === seeded.id && upRow.event_id === null,
            'browsing writes nothing; submitting seeds one candidate from the organizer\'s own stop',
            'preSeed=' + preSeed.n + ' status=' + upSub.status + ' seeded=' + !!seeded +
            ' boundTo=' + (upRow ? upRow.event_candidate_id : null));
        } else {
          console.log('NOTE: geo picker check skipped (no geocoded upcoming events in this DB)');
        }

        // A family creates an event nobody has heard of.
        const CE = {
          name: 'Smoke Spring Classic', start_date: '2027-03-13',
          city: 'San Jose', state: 'CA', lat: 37.3382, lng: -121.8863,
        };
        const ceHeaders = { 'Content-Type': 'application/json', Cookie: owner.cookie, 'X-CSRF-Token': subToken };
        const ce1 = await fetch(BASE + `/api/dancer/${famDancer.lastID}/event-candidates`, {
          method: 'POST', headers: ceHeaders, body: JSON.stringify(CE),
        });
        const ce1Json = ce1.status === 200 ? await ce1.json() : {};
        check(ce1.status === 200 && ce1Json.offered === false && ce1Json.candidate && ce1Json.candidate.id,
          'a family can create an event when they genuinely cannot find theirs',
          ce1.status + ' ' + JSON.stringify(ce1Json).slice(0, 120));

        // A SECOND household must see it immediately — that is the whole point
        // of instant selectability, and the reason it is a candidate rather
        // than a private draft.
        const famDancer2 = await db.run(
          "INSERT INTO dancers (unique_id, name, is_claimed, claimed_by_user_id) VALUES ('smoke-dancer-fam2', 'Smoke Dancer Family Two', 1, ?)",
          [u2.lastID]);
        const pick2 = await fetch(BASE + `/api/dancer/${famDancer2.lastID}/event-picker` +
          `?lat=${CE.lat}&lng=${CE.lng}&date=${CE.start_date}`, { headers: { Cookie: claimant.cookie } });
        const pick2Json = pick2.status === 200 ? await pick2.json() : { options: [] };
        const seenByOther = (pick2Json.options || []).find(
          o => o.kind === 'candidate' && ce1Json.candidate && o.id === ce1Json.candidate.id);
        check(pick2.status === 200 && !!seenByOther && seenByOther.note === 'Added by a family',
          'a second household sees the new event immediately, labelled as provisional',
          pick2.status + ' options=' + (pick2Json.options || []).length + ' found=' + !!seenByOther);

        // The race this design exists to lose gracefully: a second family
        // creating the same event minutes later is OFFERED the first one.
        const claimToken = (await (await fetch(BASE + '/my-dancers', { headers: { Cookie: claimant.cookie } })).text())
          .match(/<meta name="csrf-token" content="([^"]+)"/)[1];
        const ce2Headers = { 'Content-Type': 'application/json', Cookie: claimant.cookie, 'X-CSRF-Token': claimToken };
        const ce2 = await fetch(BASE + `/api/dancer/${famDancer2.lastID}/event-candidates`, {
          method: 'POST', headers: ce2Headers,
          body: JSON.stringify({ ...CE, name: 'Smoke Spring Classic 2027' }),
        });
        const ce2Json = ce2.status === 200 ? await ce2.json() : {};
        check(ce2.status === 200 && ce2Json.offered === true &&
              (ce2Json.duplicates || []).some(d => d.id === (ce1Json.candidate || {}).id),
          'a second family creating the same event is offered the existing one first',
          ce2.status + ' offered=' + ce2Json.offered + ' dupes=' + ((ce2Json.duplicates || []).length));

        // If they insist, both rows are filed as ONE dedup cluster so a
        // reviewer decides once instead of twice.
        const ce3 = await fetch(BASE + `/api/dancer/${famDancer2.lastID}/event-candidates`, {
          method: 'POST', headers: ce2Headers,
          body: JSON.stringify({ ...CE, name: 'Smoke Spring Classic 2027', confirm_new: '1' }),
        });
        const ce3Json = ce3.status === 200 ? await ce3.json() : {};
        const clusterRows = ce3Json.candidate
          ? await sdb.all('SELECT id, dedup_cluster_id FROM event_candidates WHERE id IN (?, ?)',
              [ce1Json.candidate.id, ce3Json.candidate.id])
          : [];
        check(ce3.status === 200 && ce3Json.offered === false && clusterRows.length === 2 &&
              clusterRows[0].dedup_cluster_id === clusterRows[1].dedup_cluster_id,
          'two families who both insist are filed as one dedup cluster',
          ce3.status + ' cluster=' + JSON.stringify(clusterRows.map(r => r.dedup_cluster_id)));

        // The invariant across every family action above.
        const canonicalAfter = (await db.get('SELECT COUNT(*) AS n FROM events')).n;
        check(canonicalAfter === canonicalBefore,
          'no canonical event row is ever written by a family action',
          'before=' + canonicalBefore + ' after=' + canonicalAfter);

        // ---- M2: promotion, the ONLY path from candidate to canonical ----
        // The riskiest operation in this milestone: it writes to two SQLite
        // files that cannot share a transaction, so it must be idempotent as
        // well as correct.
        const boundSub = await fetch(BASE + `/manage/dancer/${famDancer.lastID}/submissions`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
          body: new URLSearchParams({
            _csrf: subToken, client_submission_id: 'smoke-idem-cand-1',
            event_candidate_id: String(ce1Json.candidate.id),
            performance_name: 'Smoke Candidate Routine', group_size: 'duet', place: '3rd',
          }).toString(),
        });

        const superUser = await login('smoke-super@test.invalid');
        const superPage = await fetch(BASE + '/admin/event-candidates', { headers: { Cookie: superUser.cookie } });
        const superHtml = await superPage.text();
        const superToken = (superHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
        check(superPage.status === 200 && superHtml.includes(`data-candidate-id="${ce1Json.candidate.id}"`),
          'the reviewer queue lists the family-created candidate', 'status ' + superPage.status);

        const org = await db.get('SELECT id FROM organizations ORDER BY id LIMIT 1');
        const adminPost = (path, body) => fetch(BASE + path, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: superUser.cookie },
          body: new URLSearchParams({ _csrf: superToken, ...body }).toString(),
        });

        // Promotion needs an organization — a canonical event cannot exist
        // without one, so refusing here beats writing a half-formed row.
        const noOrgPromote = await adminPost(`/admin/event-candidates/${ce1Json.candidate.id}/promote`, {});
        check((noOrgPromote.headers.get('location') || '').includes('error='),
          'promotion is refused while the candidate has no organization',
          noOrgPromote.headers.get('location'));

        await adminPost(`/admin/event-candidates/${ce1Json.candidate.id}/org`, { org_id: String(org.id) });
        const promote1 = await adminPost(`/admin/event-candidates/${ce1Json.candidate.id}/promote`, {});
        const promoted = await sdb.get('SELECT * FROM event_candidates WHERE id = ?', [ce1Json.candidate.id]);
        const newEvent = promoted && promoted.promoted_event_id
          ? await db.get('SELECT id, name, year FROM events WHERE id = ?', [promoted.promoted_event_id]) : null;
        const movedSub = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-idem-cand-1'");
        if (newEvent) ids.promotedEventId = newEvent.id;
        check(boundSub.status === 302 && promote1.status === 302 && promoted.status === 'promoted' &&
              !!newEvent && newEvent.name === 'Smoke Spring Classic' && newEvent.year === 2027 &&
              !!movedSub && movedSub.event_id === newEvent.id,
          'promotion creates the canonical event and re-points the family\'s submission at it',
          'candidate=' + (promoted && promoted.status) + ' event=' + (newEvent && newEvent.id) +
          ' submissionEvent=' + (movedSub && movedSub.event_id));

        // Two SQLite files, no shared transaction: a retry after a crash
        // between the halves must not mint a second event.
        const promote2 = await adminPost(`/admin/event-candidates/${ce1Json.candidate.id}/promote`, {});
        const dupEvents = await db.get(
          "SELECT COUNT(*) AS n FROM events WHERE name = 'Smoke Spring Classic'");
        check(promote2.status === 302 && dupEvents.n === 1,
          'promoting twice is idempotent — one canonical event, not two', 'events=' + dupEvents.n);

        // Auto-merge: the other promotion path. The still-open twin from the
        // dedup cluster now matches the canonical event by org, year and name,
        // so the organizer-data path claims it without a reviewer.
        await sdb.run('UPDATE event_candidates SET org_id = ? WHERE id = ?', [org.id, ce3Json.candidate.id]);
        const { run: autoMerge } = require('../scripts/merge_event_candidates');
        const mergeReport = await autoMerge({ apply: true });
        const twin = await sdb.get('SELECT * FROM event_candidates WHERE id = ?', [ce3Json.candidate.id]);
        check(twin.status === 'merged' && twin.promoted_event_id === newEvent.id &&
              mergeReport.merged.some(m => m.candidate_id === ce3Json.candidate.id),
          'a candidate matching the organizer\'s own event auto-merges into it, no reviewer needed',
          'status=' + twin.status + ' event=' + twin.promoted_event_id);
      } finally {
        await db.run("DELETE FROM award_dancer_removals WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM award_dancers WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM dancer_studios WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM dancers WHERE name LIKE 'Smoke Dancer%'").catch(() => {});
        if (ids.promotedEventId) await db.run('DELETE FROM events WHERE id = ?', [ids.promotedEventId]).catch(() => {});
        for (const id of ids.claims) await db.run('DELETE FROM studio_claims WHERE id = ?', [id]).catch(() => {});
        for (const id of ids.awards) await db.run('DELETE FROM awards WHERE id = ?', [id]).catch(() => {});
        for (const id of ids.studios) await db.run('DELETE FROM studios WHERE id = ?', [id]).catch(() => {});
        for (const id of ids.users) await db.run('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
      }
      // Anti-scrape burst: profile pages share a per-IP limiter (PROFILE_RATE_LIMIT
    // above). Normal browsing volume must pass, then a rapid burst must 429.
    if (burstPath) {
      let first = null, last = null;
      for (let i = 0; i < 30; i++) {
        const res = await fetch(BASE + burstPath, { redirect: 'manual' });
        if (first === null) first = res.status;
        last = res.status;
      }
      const burstOk = first === 200 && last === 429;
      if (!burstOk) failures++;
      console.log(`${burstOk ? 'PASS' : 'FAIL'}  GET  ${burstPath} x30  -> first ${first}, last ${last} (expected 200 then 429)  profile enumeration rate-limited`);
    }

  } catch (e) {
      failures++;
      console.log('FAIL  owner-flow checks errored: ' + e.message);
    }
  } catch (e) {
    failures++;
    console.error('FATAL:', e.message);
    console.error('--- server output ---\n' + serverLog);
  } finally {
    server.kill();
    // Leave the flag exactly as it was found — the smoke suite runs against
    // the developer's real local database.
    try {
      const { openDb } = require('../database');
      const db = await openDb();
      if (priorFlagState === null) await db.run("DELETE FROM feature_flags WHERE key = 'family_submissions'");
      else await db.run("UPDATE feature_flags SET state = ? WHERE key = 'family_submissions'", [priorFlagState]);
    } catch (e) { /* nothing to restore */ }
    for (const ext of ['', '-wal', '-shm']) require('fs').rmSync(SUBMISSIONS_DB + ext, { force: true });
  }

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
