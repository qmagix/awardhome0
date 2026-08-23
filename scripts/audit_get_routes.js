// Refactor audit: boots the app, logs in as superadmin + studio/org owner
// fixtures, hits EVERY GET route with real ids, and reports any 5xx —
// catches "code references something a refactor deleted" breakage that
// anonymous smoke checks can't reach. Run after big refactors:
//   node scripts/audit_get_routes.js
// One-off refactor audit: hit every GET route with authenticated sessions
// and report 500s (the /history bug class). Run from repo root.
const { spawn } = require('child_process');
const path = require('path');
const ROOT = require('path').join(__dirname, '..');
const PORT = 3995;
const BASE = `http://localhost:${PORT}`;

async function main() {
  const bcrypt = require(path.join(ROOT, 'node_modules/bcrypt'));
  const { openDb } = require(path.join(ROOT, 'database'));
  const db = await openDb();

  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), EMAIL_PROVIDER: '', ENABLE_NIGHTLY_BACKUPS: 'false', BETA_MODE: 'false', PROFILE_RATE_LIMIT: '5000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', d => serverLog += d);
  server.stderr.on('data', d => serverLog += d);
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }

  // ---- fixtures ----
  const hash = bcrypt.hashSync('audit-pass-1', 4);
  await db.run("DELETE FROM users WHERE email LIKE 'audit-%@test.invalid'");
  await db.run("DELETE FROM studios WHERE unique_id = 'audit-studio'");
  await db.run("DELETE FROM dancers WHERE unique_id = 'DNC-audit-dancer'");
  const admin = await db.run("INSERT INTO users (email, password_hash, role, is_verified) VALUES ('audit-admin@test.invalid', ?, 'superadmin', 1)", [hash]);
  const owner = await db.run("INSERT INTO users (email, password_hash, role, is_verified) VALUES ('audit-owner@test.invalid', ?, 'studio_owner', 1)", [hash]);
  const st = await db.run("INSERT INTO studios (unique_id, name, status, is_claimed, owner_id) VALUES ('audit-studio', 'Audit Studio Fixture', 'active', 1, ?)", [owner.lastID]);
  const event = await db.get('SELECT id, year FROM events WHERE year IS NOT NULL ORDER BY id LIMIT 1');
  await db.run("INSERT INTO awards (event_id, studio_id, performance_name, award_type, category, place, award_class) VALUES (?, ?, 'Audit Routine', 'Top Audit Group', '', '1st', 'adjudication')", [event.id, st.lastID]);
  const dn = await db.run("INSERT INTO dancers (unique_id, name, is_claimed, claimed_by_user_id) VALUES ('DNC-audit-dancer', 'Audit Dancer', 1, ?)", [owner.lastID]);
  await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [dn.lastID, st.lastID]);
  const realStudio = await db.get("SELECT id, unique_id FROM studios WHERE status = 'active' ORDER BY id LIMIT 1");
  const realDancer = await db.get('SELECT id, unique_id FROM dancers ORDER BY id LIMIT 1');
  const realOrg = await db.get('SELECT id, slug FROM organizations ORDER BY id LIMIT 1');
  // temporarily own the org for /manage/org checks; remember prior owner
  const priorOrgOwner = (await db.get('SELECT owner_id FROM organizations WHERE id = ?', [realOrg.id])).owner_id;
  await db.run('UPDATE organizations SET owner_id = ? WHERE id = ?', [owner.lastID, realOrg.id]);

  const login = async (email) => {
    const page = await fetch(BASE + '/login');
    let cookie = page.headers.getSetCookie().filter(Boolean).map(c => c.split(';')[0]).join('; ');
    const token = (await page.text()).match(/csrf-token" content="([^"]+)"/)[1];
    await new Promise(r => setTimeout(r, 200)); // let the session write flush
    const res = await fetch(BASE + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
      body: `email=${encodeURIComponent(email)}&password=audit-pass-1&_csrf=${encodeURIComponent(token)}`
    });
    // If login regenerated the session, adopt the fresh cookie
    const fresh = (res.headers.getSetCookie() || []).filter(Boolean).map(c => c.split(';')[0]);
    if (fresh.length) cookie = fresh.join('; ');
    if ((res.headers.get('location') || '').startsWith('/login')) throw new Error('login failed for ' + email);
    return cookie;
  };

  try {
    const adminCookie = await login('audit-admin@test.invalid');
    const ownerCookie = await login('audit-owner@test.invalid');

    const sub = {
      // manage surfaces → fixture ids owned by the audit owner
      '/manage/studio/:id': `/manage/studio/${st.lastID}`,
      '/manage/dancer/:id': `/manage/dancer/${dn.lastID}`,
      '/manage/org/:id': `/manage/org/${realOrg.id}`,
      '/api/dancer/:id': `/api/dancer/${dn.lastID}`,
      '/api/studio/:id/history/org/:org_id': `/api/studio/${st.lastID}/history/org/${realOrg.id}`,
      '/api/studio/:id/year/:year': `/api/studio/${realStudio.unique_id}/year/${event.year}`,
      // public/admin surfaces → real data
      '/dance/studio/:id': `/dance/studio/${realStudio.unique_id}`,
      '/dance/org/:slug': `/dance/org/${realOrg.slug}`,
      '/dance/event/:id': `/dance/event/${event.id}`,
      '/dance/leaderboard/:board': '/dance/leaderboard/studios-alltime',
      '/dancer/:unique_id': `/dancer/${realDancer.unique_id}`,
      '/widget/studio/:id': `/widget/studio/${realStudio.unique_id}`,
      '/claim/studio/:id': `/claim/studio/${realStudio.unique_id}`,
      '/claim/dancer/:id': `/claim/dancer/${realDancer.id}`,
      '/claim/org/:token': '/claim/org/bogustoken',
      '/login/impersonate/:token': '/login/impersonate/bogustoken',
      '/admin/event/:id': `/admin/event/${event.id}`,
      '/admin/org/:slug': `/admin/org/${realOrg.slug}`,
      '/admin/orgs/:id': `/admin/orgs/${realOrg.id}`,
      '/admin/marketing/studios/:id': `/admin/marketing/studios/${realStudio.id}`,
      '/admin/import-review/report/:file': '/admin/import-review/report/bogus.md',
      // legacy 301 redirects to /dance/*
      '/event/:id': `/event/${event.id}`,
      '/org/:slug': `/org/${realOrg.slug}`,
      '/studio/:id/first-places': `/studio/${realStudio.id}/first-places`,
      '/studio/:id': `/studio/${realStudio.id}`,
    };

    // Extract GET routes from source
    const fs = require('fs');
    const routes = new Set();
    const files = fs.readdirSync(path.join(ROOT, 'routes')).map(f => path.join(ROOT, 'routes', f))
      .concat(fs.readdirSync(path.join(ROOT, 'routes/dance')).map(f => path.join(ROOT, 'routes/dance', f)))
      .filter(f => f.endsWith('.js'));
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/router\.get\(\s*(\[[^\]]+\]|'[^']+')/g)) {
        const spec = m[1];
        if (spec.startsWith('[')) {
          for (const p of spec.matchAll(/'([^']+)'/g)) routes.add(p[1]);
        } else {
          routes.add(spec.slice(1, -1));
        }
      }
    }

    const problems = [];
    for (const route of [...routes].sort()) {
      if (route === '/logout') { console.log('skip /logout (would kill the audit session)'); continue; }
      let url = route;
      for (const [pat, rep] of Object.entries(sub)) {
        if (url.startsWith(pat)) { url = rep + url.slice(pat.length); break; }
      }
      if (url.includes(':')) { problems.push(['UNSUBSTITUTED', route, '-']); continue; }
      const cookie = url.startsWith('/admin') ? adminCookie : ownerCookie;
      try {
        const res = await fetch(BASE + url, { redirect: 'manual', headers: { Cookie: cookie } });
        if (res.status >= 500) {
          const body = (await res.text()).slice(0, 120).replace(/\n/g, ' ');
          problems.push([res.status, route, url, body]);
        } else {
          const loc = res.status >= 300 && res.status < 400 ? '  -> ' + res.headers.get('location') : '';
          console.log(`ok ${String(res.status).padEnd(4)} ${url}${loc}`);
        }
      } catch (e) {
        problems.push(['ERR', route, url, e.message]);
      }
    }

    console.log('\n==== PROBLEMS ====');
    if (!problems.length) console.log('none — every GET route responded without a server error');
    for (const p of problems) console.log(p.join('  '));
    const errLines = serverLog.split('\n').filter(l => /Error|error:/.test(l)).slice(0, 40);
    if (errLines.length) console.log('\n==== SERVER LOG ERRORS ====\n' + errLines.join('\n'));
  } finally {
    server.kill();
    await db.run('UPDATE organizations SET owner_id = ? WHERE id = ?', [priorOrgOwner, realOrg.id]);
    await db.run("DELETE FROM award_dancers WHERE dancer_id = ?", [dn.lastID]);
    await db.run("DELETE FROM dancer_studios WHERE dancer_id = ?", [dn.lastID]);
    await db.run("DELETE FROM dancers WHERE id = ?", [dn.lastID]);
    await db.run("DELETE FROM awards WHERE studio_id = ?", [st.lastID]);
    await db.run("DELETE FROM studios WHERE id = ?", [st.lastID]);
    await db.run("DELETE FROM users WHERE email LIKE 'audit-%@test.invalid'");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
