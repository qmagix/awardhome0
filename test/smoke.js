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
  ['GET', '/register', [200], 'register page'],
  ['GET', '/faq/dancer', [200], 'dancer FAQ'],
  ['GET', '/verify-email?token=bogus', [400], 'bogus verification token rejected'],
  ['POST', '/api/merge/studios', [403], 'anonymous studio merge blocked'],
  ['POST', '/api/merge/dancers', [403], 'anonymous dancer merge blocked'],
  ['POST', '/api/reject-merge/studios', [403], 'anonymous reject-merge blocked'],
  ['POST', '/api/studios/1/investigate', [403], 'anonymous investigate blocked'],
  ['POST', '/api/studios/1/feature', [403], 'anonymous feature blocked'],
  ['GET', '/admin/compare/studios', [403], 'anonymous compare blocked'],
  ['POST', '/admin/backfill-dancers/1', [403], 'anonymous backfill blocked'],
  ['GET', '/admin', [403], 'anonymous admin dashboard blocked'],
  ['GET', '/admin/users', [403], 'anonymous user management blocked'],
  ['PUT', '/api/studio/ai-summary/1', [403], 'anonymous ai-summary edit blocked (CSRF)'],
  ['GET', '/manage/studio/1', [302], 'anonymous studio manage redirected to login'],
  ['POST', '/manage/studio/1/onboarding/dismiss', [403], 'anonymous onboarding dismiss blocked (CSRF)'],
  ['GET', '/manage/org/1', [302], 'anonymous org manage redirected to login'],
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
];

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
  const server = spawn('node', ['server.js'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
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
      if (dancer) CHECKS.push(['GET', `/claim/dancer/${dancer.id}`, [200], 'dancer claim page public (one-page apply)']);
      if (event) CHECKS.push(['GET', `/dance/event/${event.id}`, [403], 'event detail stays admin-gated']);
      if (studio) CHECKS.push(['GET', `/widget/studio/${studio.unique_id}`, [200], 'embeddable widget renders']);
      const org = await db.get('SELECT slug FROM organizations ORDER BY id LIMIT 1');
      if (org) CHECKS.push(['GET', `/dance/org/${org.slug}`, [200], 'org page is public']);
      if (org) CHECKS.push(['GET', `/dance/org/${org.slug}?design=rafters`, [200], 'org Rafters design preview renders (?design=rafters)']);
      CHECKS.push(['GET', '/?design=rafters', [200], 'Front Door landing preview renders (?design=rafters)']);
      CHECKS.push(['GET', '/dance?design=rafters', [200], 'Hall homepage preview renders (?design=rafters)']);
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
        ids.users.push(u1.lastID, u2.lastID);
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
      } finally {
        await db.run("DELETE FROM award_dancer_removals WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM award_dancers WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM dancer_studios WHERE dancer_id IN (SELECT id FROM dancers WHERE name LIKE 'Smoke Dancer%')").catch(() => {});
        await db.run("DELETE FROM dancers WHERE name LIKE 'Smoke Dancer%'").catch(() => {});
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
  }

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
