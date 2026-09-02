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
  ['GET', '/manage/studio/1/submissions', [302], 'anonymous reviewer inbox redirected to login'],
  ['POST', '/manage/studio/1/submissions/1/confirm', [403], 'anonymous submission confirm blocked (CSRF)'],
  ['POST', '/manage/studio/1/submissions/1/reject', [403], 'anonymous submission reject blocked (CSRF)'],
  ['POST', '/manage/studio/1/verifications/card-photo/1/approve', [403], 'anonymous studio photo approval blocked (CSRF)'],
  ['POST', '/api/card-photo/1/object', [403], 'anonymous photo objection blocked (CSRF)'],
  ['GET', '/admin/submissions', [403], 'anonymous AwardHome submission queue blocked'],
  ['POST', '/admin/submissions/1/confirm', [403], 'anonymous AwardHome confirm blocked'],
  ['GET', '/admin/corrections', [403], 'anonymous corrections queue blocked'],
  ['POST', '/admin/corrections/1/accept', [403], 'anonymous correction accept blocked'],
  ['POST', '/api/award/1/correction', [403], 'anonymous correction proposal blocked (CSRF)'],
  // Universal links: 404 until the real app IDs are configured. A placeholder
  // association file is worse than none — the platforms cache it, and a wrong
  // one breaks deep linking in a way that looks like an app bug.
  ['GET', '/.well-known/apple-app-site-association', [200, 404], 'apple association file responds (404 until configured)'],
  ['GET', '/.well-known/assetlinks.json', [200, 404], 'android association file responds (404 until configured)'],
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
  const SMOKE_FLAGS = ['family_submissions', 'award_photos'];
  const priorFlagState = {};
  try {
    const { openDb } = require('../database');
    const db = await openDb();
    for (const key of SMOKE_FLAGS) {
      const row = await db.get('SELECT state FROM feature_flags WHERE key = ?', [key]);
      priorFlagState[key] = row ? row.state : null;
      await db.run("INSERT INTO feature_flags (key, state) VALUES (?, 'on') " +
        "ON CONFLICT(key) DO UPDATE SET state = 'on'", [key]);
    }
  } catch (e) {
    console.log('NOTE: could not enable smoke feature flags (' + e.message + ')');
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

        // ---- M3: the studio reviewer inbox and promotion ----
        // The write path is the whole milestone: a solo double-writes
        // awards.dancer_id AND the junction; a group writes the junction
        // only. Getting this wrong is what left 79,181 solos with no primary
        // dancer and 1,874 groups indistinguishable from solos.
        const inbox = await fetch(BASE + `/manage/studio/${s1.lastID}/submissions`, { headers: { Cookie: owner.cookie } });
        const inboxHtml = await inbox.text();
        const groupSubId = r1.id;
        check(inbox.status === 200 && inboxHtml.includes(`data-submission-id="${groupSubId}"`) &&
              inboxHtml.includes('Smoke Dancer Family'),
          'the studio reviewer inbox lists this studio\'s pending family submissions', 'status ' + inbox.status);

        const reviewPost = (sid, action, body) => fetch(
          BASE + `/manage/studio/${s1.lastID}/submissions/${sid}/${action}`, {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
            body: new URLSearchParams({ _csrf: subToken, ...(body || {}) }).toString(),
          });

        // A submission whose event is still a family-added candidate cannot
        // become a canonical award — awards.event_id points at the canonical
        // table, and the event has to be settled first.
        const candSub = await sdb.get("SELECT id FROM award_submissions WHERE client_submission_id = 'smoke-idem-up-1'");
        const pendingEvent = await reviewPost(candSub.id, 'confirm', {});
        const stillPending = await sdb.get('SELECT status FROM award_submissions WHERE id = ?', [candSub.id]);
        check((pendingEvent.headers.get('location') || '').includes('error=') && stillPending.status === 'submitted',
          'a submission on an unconfirmed family event cannot be promoted',
          pendingEvent.headers.get('location'));

        // Confirm the GROUP: junction only, primary column untouched.
        const confirmGroup = await reviewPost(groupSubId, 'confirm', {});
        const groupSub = await sdb.get('SELECT * FROM award_submissions WHERE id = ?', [groupSubId]);
        const groupAward = groupSub.award_id
          ? await db.get('SELECT id, dancer_id, performance_name, is_self_added, verification_status FROM awards WHERE id = ?', [groupSub.award_id]) : null;
        const groupLink = groupAward
          ? await db.get('SELECT status, source FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [groupAward.id, famDancer.lastID]) : null;
        if (groupAward) ids.awards.push(groupAward.id);
        check(confirmGroup.status === 302 && groupSub.status === 'accepted' &&
              groupSub.verification_level === 'studio_confirmed' &&
              !!groupAward && groupAward.dancer_id === null && !!groupLink && groupLink.source === 'family_submission',
          'confirming a GROUP writes the junction only — awards.dancer_id stays empty',
          'status=' + groupSub.status + ' primary=' + (groupAward && groupAward.dancer_id) +
          ' link=' + JSON.stringify(groupLink));

        const prov = groupAward
          ? await db.get("SELECT * FROM award_provenance WHERE award_id = ? AND source_type = 'family_submission'", [groupAward.id]) : null;
        check(!!prov && prov.submission_id === groupSubId && prov.contributor_user_id === u1.lastID &&
              prov.verification_level === 'studio_confirmed' && prov.decided_by === u1.lastID,
          'promotion records provenance: who contributed it, who confirmed it, how strong it is',
          JSON.stringify(prov && { sub: prov.submission_id, by: prov.decided_by, level: prov.verification_level }));

        // Confirm a SOLO, with a reviewer correction applied on the way
        // through: the family said 2nd, the director knows it was 1st.
        await postSubmission({
          client_submission_id: 'smoke-idem-solo-1', group_size: 'solo',
          performance_name: 'Smoke Solo Confirm', place: '2nd',
        });
        const soloSub0 = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-idem-solo-1'");
        const confirmSolo = await reviewPost(soloSub0.id, 'confirm', {
          performance_name: 'Smoke Solo Confirm', place: '1st', category: '', award_type: '',
          age_division: '', teacher: '', choreographer: '',
        });
        const soloSub = await sdb.get('SELECT * FROM award_submissions WHERE id = ?', [soloSub0.id]);
        const soloAward = soloSub.award_id
          ? await db.get('SELECT id, dancer_id, place FROM awards WHERE id = ?', [soloSub.award_id]) : null;
        const soloLink = soloAward
          ? await db.get('SELECT 1 AS x FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [soloAward.id, famDancer.lastID]) : null;
        if (soloAward) ids.awards.push(soloAward.id);
        check(confirmSolo.status === 302 && !!soloAward && soloAward.dancer_id === famDancer.lastID &&
              !!soloLink && soloAward.place === '1st' && soloSub.place === '1st',
          'confirming a SOLO double-writes the primary dancer AND the junction, and the reviewer\'s correction sticks',
          'primary=' + (soloAward && soloAward.dancer_id) + ' place=' + (soloAward && soloAward.place));

        // It has to actually reach the public pages — the acceptance
        // criterion is the award appearing, not a row existing.
        const pubDancer = await fetch(BASE + '/dancer/smoke-dancer-fam');
        const pubDancerHtml = await pubDancer.text();
        check(pubDancer.status === 200 && pubDancerHtml.includes('Smoke Solo Confirm'),
          'a confirmed award appears on the dancer\'s public trophy case', 'status ' + pubDancer.status);

        // A tombstone is a human decision. Confirming must never undo it.
        const tombAward = await db.run(
          "INSERT INTO awards (event_id, studio_id, performance_name, performance_name_key, place) VALUES (?, ?, 'Smoke Tombstoned Routine', 'smoke tombstoned routine', '4th')",
          [event.id, s1.lastID]);
        ids.awards.push(tombAward.lastID);
        await db.run('INSERT OR IGNORE INTO award_dancer_removals (award_id, dancer_id) VALUES (?, ?)',
          [tombAward.lastID, famDancer.lastID]);
        await postSubmission({
          client_submission_id: 'smoke-idem-tomb-1', group_size: 'solo',
          performance_name: 'Smoke Tombstoned Routine', place: '4th',
        });
        const tombSub0 = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-idem-tomb-1'");
        const tombConfirm = await reviewPost(tombSub0.id, 'confirm', {});
        const tombSub = await sdb.get('SELECT status FROM award_submissions WHERE id = ?', [tombSub0.id]);
        const resurrected = await db.get('SELECT 1 AS x FROM award_dancers WHERE award_id = ? AND dancer_id = ?',
          [tombAward.lastID, famDancer.lastID]);
        check((tombConfirm.headers.get('location') || '').includes('error=') &&
              tombSub.status === 'submitted' && !resurrected,
          'confirming never resurrects a dancer a director removed from a routine',
          'status=' + tombSub.status + ' relinked=' + !!resurrected);

        // Scope: an owner may act only on their own studio's submissions.
        const foreignSub = await sdb.run(`
          INSERT INTO award_submissions (client_submission_id, user_id, dancer_id, studio_id, event_id,
                                         performance_name, performance_name_key, group_size, cast_complete)
          VALUES ('smoke-foreign-1', ?, ?, ?, ?, 'Smoke Foreign Routine', 'smoke foreign routine', 'solo', 0)`,
          [u2.lastID, famDancer2.lastID, s2.lastID, event.id]);
        const crossSee = !inboxHtml.includes('Smoke Foreign Routine');
        const crossAct = await reviewPost(foreignSub.lastID, 'confirm', {});
        const foreignAfter = await sdb.get('SELECT status FROM award_submissions WHERE id = ?', [foreignSub.lastID]);
        check(crossSee && crossAct.status === 404 && foreignAfter.status === 'submitted',
          'an owner can neither see nor act on another studio\'s submissions',
          'listed=' + !crossSee + ' act=' + crossAct.status);

        // ---- M3: card photos delegated to the studio ----
        // Ladder: team-visible on upload -> one objection from a cast family
        // stops it -> otherwise the studio publishes. Superadmin sees only
        // the exceptions.
        await db.run("INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status, source) VALUES (?, ?, 'verified', 'studio_owner')",
          [gaw.lastID, famDancer.lastID]);
        await db.run("INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status, source) VALUES (?, ?, 'verified', 'studio_owner')",
          [gaw.lastID, famDancer2.lastID]);
        const cleanPhoto = await db.run(
          "INSERT INTO award_card_photos (award_id, dancer_id, photo_url, status, uploaded_by) VALUES (?, ?, '/uploads/smoke-clean.jpg', 'pending', ?)",
          [gaw.lastID, famDancer.lastID, u1.lastID]);
        const objectedPhoto = await db.run(
          "INSERT INTO award_card_photos (award_id, dancer_id, photo_url, status, uploaded_by) VALUES (?, ?, '/uploads/smoke-objected.jpg', 'pending', ?)",
          [gaw.lastID, famDancer2.lastID, u2.lastID]);

        const verif = await fetch(BASE + `/manage/studio/${s1.lastID}/verifications`, { headers: { Cookie: owner.cookie } });
        const verifHtml = await verif.text();
        check(verif.status === 200 && verifHtml.includes(`data-card-photo="${cleanPhoto.lastID}"`),
          'card photos on a studio\'s routines now wait for the STUDIO, not a superadmin', 'status ' + verif.status);

        // A family in the routine objects to the other family's photo.
        const objectRes = await fetch(BASE + `/api/card-photo/${cleanPhoto.lastID}/object`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: claimant.cookie, 'X-CSRF-Token': claimToken },
        });
        // ...and someone with no dancer in the routine cannot.
        const outsiderRes = await fetch(BASE + `/api/card-photo/${cleanPhoto.lastID}/object`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: superUser.cookie, 'X-CSRF-Token': superToken },
        });
        check(objectRes.status === 200 && outsiderRes.status === 403,
          'only a family with a dancer in the routine can object to its photo',
          'cast=' + objectRes.status + ' outsider=' + outsiderRes.status);

        // One objection takes the decision away from the studio.
        const blocked = await fetch(BASE + `/manage/studio/${s1.lastID}/verifications/card-photo/${cleanPhoto.lastID}/approve`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
          body: new URLSearchParams({ _csrf: subToken }).toString(),
        });
        const blockedRow = await db.get('SELECT status FROM award_card_photos WHERE id = ?', [cleanPhoto.lastID]);
        check((blocked.headers.get('location') || '').includes('photo_error=') && blockedRow.status === 'pending',
          'one objection from a cast family blocks studio approval and routes it to AwardHome',
          'status=' + blockedRow.status);

        // No objection: the studio publishes it, no superadmin involved.
        const approved = await fetch(BASE + `/manage/studio/${s1.lastID}/verifications/card-photo/${objectedPhoto.lastID}/approve`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
          body: new URLSearchParams({ _csrf: subToken }).toString(),
        });
        const approvedRow = await db.get('SELECT status FROM award_card_photos WHERE id = ?', [objectedPhoto.lastID]);
        check(approved.status === 302 && approvedRow.status === 'approved',
          'an unobjected photo is published by the studio, with no superadmin step',
          'status=' + approvedRow.status);

        // ---- M4: convergence and corroboration ----
        // Two parents at one competition both submit the same group routine,
        // neither able to see the other's entry, and neither types it
        // identically. That has to be ONE award with two dancer links — not
        // two awards, and not one award missing half its cast.
        // Both households' dancers must be on the SAME studio roster — that is
        // what makes them teammates rather than two unrelated entries, and the
        // studio is derived from affiliation, never from what the form posts.
        await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)',
          [famDancer2.lastID, s1.lastID]);

        const CONV = { routine: 'Smoke Convergence Fireworks', size: 'small_group' };
        const convA = await postSubmission({
          client_submission_id: 'smoke-conv-a', group_size: CONV.size,
          performance_name: CONV.routine, place: '1st', category: 'Teen Contemporary',
        });
        // Read A back only AFTER B lands: corroboration promotes both, so a
        // snapshot taken before the second household exists is stale by
        // construction.
        const subAPending = await sdb.get("SELECT status FROM award_submissions WHERE client_submission_id = 'smoke-conv-a'");

        // Second household: different account, different dancer, and a
        // different spelling of the same placement with the category left
        // blank — exactly what two real people produce.
        const convB = await fetch(BASE + `/manage/dancer/${famDancer2.lastID}/submissions`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: claimant.cookie },
          body: new URLSearchParams({
            _csrf: claimToken, client_submission_id: 'smoke-conv-b',
            event_id: String(event.id), studio_id: String(s1.lastID),
            performance_name: CONV.routine, group_size: CONV.size, place: '1',
          }).toString(),
        });
        const subA = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-conv-a'");
        const subB = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-conv-b'");

        const convAwards = await db.all(
          "SELECT id, dancer_id, place, category FROM awards WHERE performance_name = ?", [CONV.routine]);
        convAwards.forEach(a => ids.awards.push(a.id));
        const convLinks = convAwards.length
          ? await db.all('SELECT dancer_id FROM award_dancers WHERE award_id = ?', [convAwards[0].id]) : [];

        check(convA.status === 302 && convB.status === 302 &&
              subAPending.status === 'submitted' &&
              subA.status === 'accepted' && subB.status === 'accepted' &&
              subA.verification_level === 'corroborated' && subB.verification_level === 'corroborated' &&
              convAwards.length === 1 && convLinks.length === 2,
          'two households describing the same routine reach ONE award with two dancer links, promoted as corroborated',
          'awards=' + convAwards.length + ' links=' + convLinks.length +
          ' levels=' + subA.verification_level + '/' + subB.verification_level);

        // "1st" vs "1" folded, and the blank category was FILLED from the
        // household that knew it rather than splitting the award in two.
        check(convAwards.length === 1 && convAwards[0].category === 'Teen Contemporary',
          'cosmetic spelling differences converge, and a blank field is enriched rather than forked',
          'category=' + (convAwards[0] && convAwards[0].category));

        // A genuinely DIFFERENT award on the same routine must stay separate.
        await postSubmission({
          client_submission_id: 'smoke-conv-c', group_size: CONV.size,
          performance_name: CONV.routine, place: '1st', category: 'Overall High Score',
        });
        const afterDistinct = await db.all(
          'SELECT id, category FROM awards WHERE performance_name = ?', [CONV.routine]);
        afterDistinct.forEach(a => { if (!ids.awards.includes(a.id)) ids.awards.push(a.id); });
        check(afterDistinct.length === 2,
          'a different award on the same routine stays a separate award, not a merge',
          'awards=' + afterDistinct.length + ' categories=' + JSON.stringify(afterDistinct.map(a => a.category)));

        // ---- M4: independents auto-approve, held out of rankings ----
        const indepStudio = await db.run(
          "INSERT INTO studios (unique_id, name, status, is_independent) VALUES ('smoke-indep-studio', 'Independent — Smoke Dancer Solo (smoke)', 'active', 1)");
        ids.studios.push(indepStudio.lastID);
        const indepDancer = await db.run(
          "INSERT INTO dancers (unique_id, name, is_claimed, claimed_by_user_id) VALUES ('smoke-dancer-indep', 'Smoke Dancer Indie', 1, ?)",
          [u1.lastID]);
        await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [indepDancer.lastID, indepStudio.lastID]);

        const indepSub = await fetch(BASE + `/manage/dancer/${indepDancer.lastID}/submissions`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
          body: new URLSearchParams({
            _csrf: subToken, client_submission_id: 'smoke-indep-1',
            event_id: String(event.id), performance_name: 'Smoke Indie Solo', group_size: 'solo', place: '1st',
          }).toString(),
        });
        // M9: an independent CURATES by default. Auto-approval existed because
        // no director exists to ask — not because anything had been checked,
        // which quietly made one weak decision (an AwardHome reviewer
        // approving a claim they cannot really verify) into an unbounded right
        // to publish unreviewed claims about a child on a public page.
        const indepRow = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-indep-1'");
        const noAwardYet = await db.get(
          "SELECT id FROM awards WHERE performance_name = 'Smoke Indie Solo'");
        check((indepSub.headers.get('location') || '').includes('auto=independent_curating') &&
              indepRow.status === 'submitted' && !indepRow.award_id && !noAwardYet,
          'an independent dancer\'s award is kept PRIVATELY by default — nothing publishes without a grant',
          'loc=' + (indepSub.headers.get('location') || '') + ' status=' + indepRow.status);

        // And it is genuinely private: not on the public trophy case, and not
        // in AwardHome's per-award queue either (the ask is one grant per
        // household, not a review of each award).
        const indepPublic = await fetch(BASE + '/dancer/smoke-dancer-indep');
        const indepPublicHtml = await indepPublic.text();
        const indepAdminQ = await fetch(BASE + '/admin/submissions', { headers: { Cookie: superUser.cookie } });
        const indepAdminHtml = await indepAdminQ.text();
        check(!indepPublicHtml.includes('Smoke Indie Solo'),
          'a curated independent award is absent from the public trophy case',
          'onPage=' + indepPublicHtml.includes('Smoke Indie Solo'));

        // The family asks; a SUPERADMIN grants; the whole private record
        // publishes at once. One considered decision instead of a queue of
        // reviews nobody can actually check.
        const askRes = await fetch(BASE + `/manage/dancer/${indepDancer.lastID}/publish-request`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
          body: new URLSearchParams({ _csrf: subToken }).toString(),
        });
        const askedRow = await db.get(
          'SELECT independent_publish_status AS st FROM dancers WHERE id = ?', [indepDancer.lastID]);
        const adminAfterAsk = await fetch(BASE + '/admin/submissions', { headers: { Cookie: superUser.cookie } });
        const adminAfterAskHtml = await adminAfterAsk.text();
        check(askRes.status === 302 && askedRow.st === 'requested' &&
              adminAfterAskHtml.includes('Smoke Dancer Indie'),
          'an independent family can ask AwardHome to publish, and the request reaches the superadmin queue',
          'status=' + askedRow.st + ' inQueue=' + adminAfterAskHtml.includes('Smoke Dancer Indie'));

        // A plain admin must not be able to grant it: this decides what the
        // public sees under AwardHome's name.
        const grantAsAdmin = await fetch(
          BASE + `/admin/independents/${indepDancer.lastID}/publish/approve`, {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
            body: new URLSearchParams({ _csrf: subToken }).toString(),
          });
        const stillRequested = await db.get(
          'SELECT independent_publish_status AS st FROM dancers WHERE id = ?', [indepDancer.lastID]);
        check(grantAsAdmin.status >= 400 || grantAsAdmin.status === 302
              ? stillRequested.st === 'requested' : false,
          'a non-superadmin cannot grant independent publishing',
          'status=' + grantAsAdmin.status + ' still=' + stillRequested.st);

        const grantRes = await fetch(
          BASE + `/admin/independents/${indepDancer.lastID}/publish/approve`, {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: superUser.cookie },
            body: new URLSearchParams({ _csrf: superToken }).toString(),
          });
        const indepRowAfter = await sdb.get("SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-indep-1'");
        const indepAward = indepRowAfter && indepRowAfter.award_id
          ? await db.get('SELECT id, verification_status FROM awards WHERE id = ?', [indepRowAfter.award_id]) : null;
        if (indepAward) ids.awards.push(indepAward.id);
        check(grantRes.status === 302 && indepRowAfter.status === 'accepted' &&
              indepRowAfter.verification_level === 'family_submitted' &&
              !!indepAward && indepAward.verification_status === 'family_submitted',
          'the grant is RETROACTIVE — the whole private record publishes on one decision',
          'status=' + indepRowAfter.status + ' award=' + (indepAward && indepAward.id));

        const { rankableAwardSql } = require('../utils/promotion');
        const ranked = await db.get(
          `SELECT COUNT(*) AS n FROM awards a WHERE a.id = ? AND ${rankableAwardSql('a')}`, [indepAward.id]);
        check(ranked.n === 0,
          'a family_submitted award is public but held OUT of competitive rankings until corroborated',
          'rankable=' + ranked.n);

        // ---- M4: contested claims go to AwardHome, never a studio ----
        const contestDancer = await db.run(
          "INSERT INTO dancers (unique_id, name) VALUES ('smoke-dancer-contest', 'Smoke Dancer Contested')");
        await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [contestDancer.lastID, s1.lastID]);
        const fileClaim = (cookie, token) => fetch(BASE + `/claim/dancer/${contestDancer.lastID}`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
          body: new URLSearchParams({ _csrf: token, relationship: 'parent', proof: 'smoke' }).toString(),
        });
        await fileClaim(owner.cookie, subToken);
        await fileClaim(claimant.cookie, claimToken);
        const claimRows = await db.all(
          'SELECT id, status FROM dancer_claims WHERE dancer_id = ?', [contestDancer.lastID]);
        claimRows.forEach(c => ids.claims.push(c.id));
        const allContested = claimRows.length === 2 && claimRows.every(c => c.status === 'contested');

        const studioVerif = await fetch(BASE + `/manage/studio/${s1.lastID}/verifications`, { headers: { Cookie: owner.cookie } });
        const studioVerifHtml = await studioVerif.text();
        const adminClaims = await fetch(BASE + '/admin/claims', { headers: { Cookie: superUser.cookie } });
        const adminClaimsHtml = await adminClaims.text();
        check(allContested && !studioVerifHtml.includes('Smoke Dancer Contested') &&
              adminClaimsHtml.includes('Smoke Dancer Contested') &&
              adminClaimsHtml.includes(`data-contested-claim="${claimRows[0].id}"`),
          'a second household claiming one dancer contests both, and it leaves the studio queue for AwardHome',
          'statuses=' + JSON.stringify(claimRows.map(c => c.status)) +
          ' inStudio=' + studioVerifHtml.includes('Smoke Dancer Contested'));

        // ---- M8: a pending claimant may QUEUE, but nothing promotes ----
        // A parent who just found her child cannot wait for an unclaimed
        // studio to appear before writing down a weekend she still remembers.
        // Staging is a separate file and nothing there is public, so letting
        // her queue costs nothing — as long as neither reviewer-less door
        // opens for her. Both are tested here, in both directions.
        const qDancer = await db.run(
          "INSERT INTO dancers (unique_id, name) VALUES ('smoke-dancer-queue', 'Smoke Dancer Queued')");
        // Cleaned up by the 'Smoke Dancer%' name sweep, like the others.
        await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)',
          [qDancer.lastID, s1.lastID]); // s1 has an owner, so the claim routes there and waits
        const qClaimRes = await fetch(BASE + `/claim/dancer/${qDancer.lastID}`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: claimant.cookie },
          body: new URLSearchParams({ _csrf: claimToken, relationship: 'parent', proof: 'smoke' }).toString(),
        });
        const qClaim = await db.get(
          "SELECT id, status FROM dancer_claims WHERE dancer_id = ? AND status = 'pending'", [qDancer.lastID]);
        if (qClaim) ids.claims.push(qClaim.id);

        const QROUTINE = 'Smoke Queued Routine';
        const qPost = (extra = {}) => fetch(BASE + `/manage/dancer/${qDancer.lastID}/submissions`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: claimant.cookie },
          body: new URLSearchParams({
            _csrf: claimToken, client_submission_id: 'smoke-queue-a',
            event_id: String(event.id), performance_name: QROUTINE,
            group_size: 'small_group', place: '1st', category: 'Teen Jazz', ...extra,
          }).toString(),
        });
        const qRes = await qPost();
        const qSub = await sdb.get(
          "SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-queue-a'");
        const qAwardsAfter = await db.all(
          'SELECT id FROM awards WHERE performance_name = ?', [QROUTINE]);
        check(qClaimRes.status < 400 && qRes.status === 302 &&
              (qRes.headers.get('location') || '').includes('queued=1') &&
              qSub && qSub.unverified_household === 1 && qSub.status === 'submitted' &&
              qAwardsAfter.length === 0,
          'a PENDING claimant can queue an award into staging, and nothing canonical is written',
          'post=' + qRes.status + ' loc=' + (qRes.headers.get('location') || '') +
          ' flagged=' + (qSub && qSub.unverified_household) +
          ' awards=' + qAwardsAfter.length);

        // Not in the director's queue: the claim in front of her IS the
        // prerequisite question, and answering it releases the whole queue.
        const qStudioQueue = await fetch(BASE + `/manage/studio/${s1.lastID}/submissions`,
          { headers: { Cookie: owner.cookie } });
        const qStudioHtml = await qStudioQueue.text();
        // Nor in AwardHome's, for the stronger reason: AwardHome cannot judge
        // parentage at all — that is why dancer claims route to studios.
        const qAdminQueue = await fetch(BASE + '/admin/submissions',
          { headers: { Cookie: superUser.cookie } });
        const qAdminHtml = await qAdminQueue.text();
        check(!qStudioHtml.includes(QROUTINE) && !qAdminHtml.includes(QROUTINE),
          'a pending claimant\'s queued award reaches neither the studio queue nor AwardHome\'s',
          'studio=' + qStudioHtml.includes(QROUTINE) + ' admin=' + qAdminHtml.includes(QROUTINE));

        // THE DIRECTION THAT IS EASY TO MISS. Corroboration promotes BOTH
        // partners, so an unverified entry left matchable would promote a
        // real household's submission — publishing an award on the say-so of
        // someone whose relationship to a child is still unestablished.
        const qMate = await fetch(BASE + `/manage/dancer/${famDancer.lastID}/submissions`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
          body: new URLSearchParams({
            _csrf: subToken, client_submission_id: 'smoke-queue-mate',
            event_id: String(event.id), performance_name: QROUTINE,
            group_size: 'small_group', place: '1st',
          }).toString(),
        });
        const mateSub = await sdb.get(
          "SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-queue-mate'");
        const afterMate = await db.all('SELECT id FROM awards WHERE performance_name = ?', [QROUTINE]);
        check(qMate.status === 302 && mateSub && mateSub.status === 'submitted' &&
              afterMate.length === 0,
          'an unverified entry cannot corroborate anyone — the other household stays unpublished too',
          'mate=' + (mateSub && mateSub.status) + ' awards=' + afterMate.length);

        // Approving the claim is the one decision that releases the queue —
        // and now the two households corroborate each other normally.
        const qApprove = await fetch(
          BASE + `/manage/studio/${s1.lastID}/verifications/profile/${qClaim.id}/approve`, {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: owner.cookie },
            body: new URLSearchParams({ _csrf: subToken }).toString(),
          });
        const qSubAfter = await sdb.get(
          "SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-queue-a'");
        const mateAfter = await sdb.get(
          "SELECT * FROM award_submissions WHERE client_submission_id = 'smoke-queue-mate'");
        const qAwardsFinal = await db.all(
          'SELECT id FROM awards WHERE performance_name = ?', [QROUTINE]);
        qAwardsFinal.forEach(a => ids.awards.push(a.id));
        const qLinks = qAwardsFinal.length
          ? await db.all('SELECT dancer_id FROM award_dancers WHERE award_id = ?', [qAwardsFinal[0].id]) : [];
        check(qApprove.status === 302 && qSubAfter.unverified_household === 0 &&
              qSubAfter.status === 'accepted' && mateAfter.status === 'accepted' &&
              qAwardsFinal.length === 1 && qLinks.length === 2,
          'approving the claim clears the marker and releases the queue — one decision, a season of entries',
          'approve=' + qApprove.status + ' claim=' + qClaim.id +
          ' flagged=' + qSubAfter.unverified_household + ' statuses=' + qSubAfter.status + '/' +
          mateAfter.status + ' awards=' + qAwardsFinal.length + ' links=' + qLinks.length);

        // ---- The standalone award card the mobile app embeds ----
        // Reuses views/partials/dancer_award_card.ejs, so a card in the app
        // and a card on the web cannot drift. Scoped to a (dancer, award)
        // pair because the per-card hide is per-pair and a solo card names
        // the dancer on its face.
        const cardAward = await db.get(
          'SELECT a.id FROM awards a JOIN award_dancers ad ON ad.award_id = a.id WHERE ad.dancer_id = ? LIMIT 1',
          [famDancer.lastID]);
        if (cardAward) {
          const cardRes = await fetch(BASE + `/dance/card/smoke-dancer-fam/${cardAward.id}`);
          const cardHtml = await cardRes.text();
          check(cardRes.status === 200 && cardHtml.includes('flip-card') &&
                cardHtml.includes('embed-stage'),
            'the embeddable award card renders the real card partial',
            'status ' + cardRes.status);

          // The container-query registration is load-bearing and easy to
          // forget: styles.css says every surface rendering a flip-card must
          // be listed, or cqw silently resolves against the VIEWPORT and the
          // card renders enormous. It did, the first time.
          const css = await (await fetch(BASE + '/css/styles.css')).text();
          check(css.includes('.embed-stage .flip-card'),
            'the embed surface is registered as a container, so cqw scales to the card not the viewport',
            'registered=' + css.includes('.embed-stage .flip-card'));

          // Scope: an award this dancer has no part in must not render under
          // their name, and probing ids must reveal nothing.
          const wrongPair = await fetch(BASE + `/dance/card/smoke-dancer-indep/${cardAward.id}`);
          check(wrongPair.status === 404,
            'a card is 404 for a dancer with no link to that award — never rendered under the wrong name',
            'status ' + wrongPair.status);
        }

        // ---- M4: correction proposals ----
        const corrTarget = convAwards[0];
        const corrRes = await fetch(BASE + `/api/award/${corrTarget.id}/correction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: owner.cookie, 'X-CSRF-Token': subToken },
          body: JSON.stringify({
            dancer_id: famDancer.lastID, field: 'place',
            proposed_value: '2nd', reason: 'We were second, not first.',
          }),
        });
        const corrJson = corrRes.status === 200 ? await corrRes.json() : {};
        const beforeApply = await db.get('SELECT place FROM awards WHERE id = ?', [corrTarget.id]);
        check(corrRes.status === 200 && !!corrJson.correctionId && beforeApply.place === '1st',
          'a family PROPOSES a correction — the published fact does not move until a reviewer agrees',
          corrRes.status + ' award still=' + beforeApply.place);

        // Someone with no dancer on the award cannot propose against it.
        const corrOutsider = await fetch(BASE + `/api/award/${corrTarget.id}/correction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: superUser.cookie, 'X-CSRF-Token': superToken },
          body: JSON.stringify({ dancer_id: famDancer.lastID, field: 'place', proposed_value: '3rd' }),
        });
        check(corrOutsider.status === 403,
          'only a household whose own dancer is on the award may propose a correction',
          'status=' + corrOutsider.status);

        const corrPage = await fetch(BASE + '/admin/corrections', { headers: { Cookie: superUser.cookie } });
        const corrPageHtml = await corrPage.text();
        const applyCorr = await fetch(BASE + `/admin/corrections/${corrJson.correctionId}/accept`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: superUser.cookie },
          body: new URLSearchParams({ _csrf: superToken, note: 'checked the results sheet' }).toString(),
        });
        const afterApply = await db.get('SELECT place FROM awards WHERE id = ?', [corrTarget.id]);
        const corrProv = await db.get(
          "SELECT note FROM award_provenance WHERE award_id = ? AND source_type = 'correction'", [corrTarget.id]);
        check(corrPage.status === 200 && corrPageHtml.includes(`data-correction-id="${corrJson.correctionId}"`) &&
              applyCorr.status === 302 && afterApply.place === '2nd' && !!corrProv,
          'accepting a correction applies it AND records who asked and who approved',
          'place=' + afterApply.place + ' provenance=' + !!corrProv);

        // ---- M4: the AwardHome queue catches what no studio owner sees ----
        const orphanQueue = await fetch(BASE + '/admin/submissions', { headers: { Cookie: superUser.cookie } });
        const orphanHtml = await orphanQueue.text();
        check(orphanQueue.status === 200 && !orphanHtml.includes(`data-submission-id="${r1.id}"`),
          'submissions with a real studio owner stay in THEIR inbox and never reach the AwardHome queue',
          'status ' + orphanQueue.status);

        // ---- Rankings are objective: featuring is a bonus, never a swap ----
        // Regression guard for the bug where the homepage subtracted featured
        // studio ids from every leaderboard, so the studio holding a rotation
        // slot silently vanished from the Top 100 for its whole tenure. Pins
        // the true #1 studio as featured and requires it in BOTH the Marquee
        // and the all-time board. Operates on a real studio (nothing seeded
        // can reach the top 100), so the pin is always restored.
        const topStudio = await db.get(`
          SELECT s.id, s.unique_id, s.name, s.is_featured, COUNT(a.id) AS total_awards
          FROM studios s
          LEFT JOIN awards a ON s.id = a.studio_id
          WHERE COALESCE(s.is_independent, 0) = 0
            AND COALESCE(a.verification_status, '') != 'family_submitted'
          GROUP BY s.id ORDER BY total_awards DESC LIMIT 1`);
        if (!topStudio || !topStudio.unique_id) {
          check(false, 'ranking fixture: a top studio exists to pin as featured', 'none found');
        } else {
          const setFeatured = (on) => fetch(BASE + `/api/studios/${topStudio.id}/feature`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: superUser.cookie, 'X-CSRF-Token': superToken },
            body: JSON.stringify({ feature: on }),
          });
          try {
            const featRes = await setFeatured(true);
            // The feature toggle kicks a BACKGROUND homepage refresh (see
            // utils/cache.js) — poll rather than assume it has landed.
            const link = `/dance/studio/${topStudio.unique_id}`;
            // Slice on section ids, not bare anchors: the page's jump nav
            // emits "#v2h-rafters" *above* the Marquee, so a bare-string
            // search finds the nav link and cuts the section off.
            const between = (html, from, to) => {
              const a = html.indexOf(from), b = html.indexOf(to);
              return a >= 0 && b > a ? html.slice(a, b) : '';
            };
            let html = '', marquee = false, board = false;
            for (let i = 0; i < 40; i++) {
              await new Promise(r => setTimeout(r, 500));
              html = await (await fetch(BASE + '/dance')).text();
              marquee = between(html, 'id="v2h-marquee"', 'id="v2h-rafters"').includes(link);
              board = between(html, 'id="leaderboard-alltime"', 'id="leaderboard-thisyear"').includes(link);
              if (marquee) break;
            }
            const dbFlag = await db.get('SELECT is_featured FROM studios WHERE id = ?', [topStudio.id]);
            check(featRes.status === 200 && marquee && board,
              'a featured studio keeps its earned rank — the Marquee is a bonus, not a substitute for the leaderboard',
              `${topStudio.name}: post=${featRes.status} dbFlag=${dbFlag && dbFlag.is_featured} marquee=${marquee} board=${board}`);
          } finally {
            await setFeatured(!!topStudio.is_featured).catch(() => {});
            await db.run('UPDATE studios SET is_featured = ? WHERE id = ?',
              [topStudio.is_featured || 0, topStudio.id]).catch(() => {});
          }
        }
      } finally {
        await db.run("DELETE FROM award_dancer_removals WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM award_dancers WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM dancer_studios WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM dancers WHERE name LIKE 'Smoke Dancer%'").catch(() => {});
        await db.run("DELETE FROM award_card_photos WHERE photo_url LIKE '/uploads/smoke-%'").catch(() => {});
        await db.run("DELETE FROM content_flags WHERE content_type = 'award_photo' AND content_id NOT IN (SELECT id FROM award_card_photos)").catch(() => {});
        for (const id of ids.awards) {
          await db.run('DELETE FROM award_provenance WHERE award_id = ?', [id]).catch(() => {});
          await db.run('DELETE FROM award_dancers WHERE award_id = ?', [id]).catch(() => {});
          await db.run('DELETE FROM award_dancer_removals WHERE award_id = ?', [id]).catch(() => {});
        }
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
      for (const key of SMOKE_FLAGS) {
        if (priorFlagState[key] == null) await db.run('DELETE FROM feature_flags WHERE key = ?', [key]);
        else await db.run('UPDATE feature_flags SET state = ? WHERE key = ?', [priorFlagState[key], key]);
      }
    } catch (e) { /* nothing to restore */ }
    for (const ext of ['', '-wal', '-shm']) require('fs').rmSync(SUBMISSIONS_DB + ext, { force: true });
  }

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
