// Partner API contract test. Runs against a THROWAWAY COPY of the database,
// like test/api_mobile.js and for the same reason: tests that touch a
// working database are tests people learn to skip.
//
// The acceptance criteria it exists to prove:
//   * the API never issues a session cookie (mounted before the session store);
//   * it ships dark: with the partner_api flag off, everything 404s;
//   * no key, a bogus key, and a revoked key are the same 401 — no oracle;
//   * search is exact-match name+studio only — no browse, no prefix reach;
//   * a safety-suppressed dancer does not exist here, in search or detail;
//   * numeric ids are refused (the enumeration-oracle rule survives auth);
//   * every lookup lands in the append-only audit log with the ids returned;
//   * the daily quota, counted from that log, actually stops the caller.
//
// Run: node test/api_partner.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PARTNER_TEST_PORT || 3995;
const BASE = `http://localhost:${PORT}/api/v1/partner`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'awardhome-partner-'));
const API_DB = path.join(TMP, 'partner.sqlite');

let failures = 0;
const check = (ok, desc, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${desc}${detail ? '  [' + detail + ']' : ''}`);
};

async function main() {
  for (const ext of ['', '-wal', '-shm']) {
    const src = path.join(ROOT, 'database.sqlite' + ext);
    if (fs.existsSync(src)) fs.copyFileSync(src, API_DB + ext);
  }
  spawnSync('sqlite3', [API_DB, 'PRAGMA wal_checkpoint(TRUNCATE);']);

  process.env.DB_PATH = API_DB;
  const { openDb } = require('../database');
  const db = await openDb();

  // ---- fixtures ----
  await db.run("INSERT INTO feature_flags (key, state) VALUES ('partner_api', 'off') " +
    "ON CONFLICT(key) DO UPDATE SET state = 'off'");
  const st = await db.run(
    "INSERT INTO studios (unique_id, name, status) VALUES ('partner-studio', 'Partner Test Studio', 'active')");
  const dn = await db.run(
    "INSERT INTO dancers (unique_id, name) VALUES ('DNC-partner-dancer', 'Partner Test Dancer')");
  await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [dn.lastID, st.lastID]);
  // A same-name second dancer at the same studio — the disambiguation case.
  const twin = await db.run(
    "INSERT INTO dancers (unique_id, name) VALUES ('DNC-partner-twin', 'Partner Test Dancer')");
  await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [twin.lastID, st.lastID]);
  // A suppressed dancer at the same studio (utils/suppression.js).
  const sup = await db.run(
    "INSERT INTO dancers (unique_id, name, suppressed_at) VALUES ('DNC-partner-suppressed', 'Partner Hidden Dancer', datetime('now'))");
  await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [sup.lastID, st.lastID]);
  const seasons = [];
  for (const y of [2024, 2026, 2025]) {
    const ev = await db.run('INSERT INTO events (name, year) VALUES (?, ?)', [`Partner Season ${y}`, y]);
    const aw = await db.run(
      "INSERT INTO awards (event_id, place, performance_name, studio_id) VALUES (?, '1', ?, ?)",
      [ev.lastID, `Partner Routine ${y}`, st.lastID]);
    await db.run('INSERT INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [aw.lastID, dn.lastID]);
    seasons.push({ year: y, awardId: aw.lastID });
  }

  const { issueKey, revokeKey } = require('../utils/partnerAuth');
  const good = await issueKey({ partnerName: 'Test School', agreementNote: 'test agreement' });
  const tiny = await issueKey({ partnerName: 'Tiny Quota School', dailyQuota: 3, agreementNote: 'test agreement' });
  const dead = await issueKey({ partnerName: 'Revoked School', agreementNote: 'test agreement' });
  await revokeKey(dead.keyId, 'test');

  // ---- boot ----
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), DB_PATH: API_DB,
      SUBMISSIONS_DB_PATH: path.join(TMP, 'submissions.sqlite'),
      MOBILE_AUTH_DB_PATH: path.join(TMP, 'auth.sqlite'),
      EMAIL_PROVIDER: '', BETA_MODE: 'false',
      ENABLE_NIGHTLY_BACKUPS: 'false', ENABLE_WEEKLY_SCRAPE: 'false', ENABLE_SENTINEL: 'false',
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
  if (!up) { console.error('server did not start\n' + log.slice(-2000)); process.exit(1); }

  const cookiesSeen = [];
  const api = async (p, key) => {
    const res = await fetch(BASE + p, {
      headers: key ? { Authorization: 'Bearer ' + key } : {},
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookie && setCookie.length) cookiesSeen.push(p);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* non-JSON is itself a failure surface */ }
    return { status: res.status, json, text };
  };

  try {
    // ---- dark by default ----
    const dark = await api('/dancers?name=Partner%20Test%20Dancer&studio=Partner%20Test%20Studio', good.rawKey);
    check(dark.status === 404, 'the API ships dark — flag off means 404 even with a valid key', 'status ' + dark.status);
    const contract = await api('/openapi.json');
    check(contract.status === 200 && contract.json && contract.json.openapi,
      'the contract itself is served even while dark — documentation, not data', 'status ' + contract.status);

    // Flip the flag on. The flag cache is 15s stale-while-revalidate, so
    // wait it out and prod it once — same behavior an admin flip has live.
    await db.run("UPDATE feature_flags SET state = 'on' WHERE key = 'partner_api'");
    await new Promise(r => setTimeout(r, 15500));
    await api('/dancers?name=x&studio=y', good.rawKey); // triggers the background refresh
    await new Promise(r => setTimeout(r, 750));

    // ---- auth: one 401, no oracle ----
    const noKey = await api('/dancers?name=a&studio=b');
    const badKey = await api('/dancers?name=a&studio=b', 'apk_' + '0'.repeat(64));
    const revoked = await api('/dancers?name=a&studio=b', dead.rawKey);
    check(noKey.status === 401 && badKey.status === 401 && revoked.status === 401 &&
          JSON.stringify(noKey.json) === JSON.stringify(badKey.json) &&
          JSON.stringify(badKey.json) === JSON.stringify(revoked.json),
      'missing, bogus and revoked keys get byte-identical 401s — no key-state oracle',
      `${noKey.status}/${badKey.status}/${revoked.status}`);

    // ---- search: exact-match only ----
    const missing = await api('/dancers?name=Partner%20Test%20Dancer', good.rawKey);
    check(missing.status === 400, 'search without a studio is refused — no browse', 'status ' + missing.status);
    const found = await api('/dancers?name=partner%20test%20dancer&studio=PARTNER%20TEST%20STUDIO', good.rawKey);
    check(found.status === 200 && found.json.studio_matched === true &&
          found.json.dancers.length === 2 &&
          found.json.dancers.every(d => ['DNC-partner-dancer', 'DNC-partner-twin'].includes(d.unique_id)),
      'exact name + studio finds BOTH same-name dancers for disambiguation (case-insensitively)',
      'n=' + (found.json.dancers || []).length);
    const summary = (found.json.dancers || []).find(d => d.unique_id === 'DNC-partner-dancer') || {};
    check(summary.award_count === 3 && summary.first_year === 2024 && summary.last_year === 2026,
      'summaries carry enough to disambiguate — award count and seasons active',
      JSON.stringify({ n: summary.award_count, from: summary.first_year, to: summary.last_year }));
    const prefix = await api('/dancers?name=Partner%20Test&studio=Partner%20Test%20Studio', good.rawKey);
    check(prefix.status === 200 && prefix.json.dancers.length === 0,
      'a partial name matches nothing — exact-match is the whole contract', 'n=' + prefix.json.dancers.length);
    const noStudio = await api('/dancers?name=Partner%20Test%20Dancer&studio=No%20Such%20Studio%20Anywhere', good.rawKey);
    check(noStudio.status === 200 && noStudio.json.studio_matched === false && noStudio.json.dancers.length === 0,
      'an unknown studio reports studio_matched=false and runs no dancer search', JSON.stringify(noStudio.json));

    // ---- suppression ----
    const supSearch = await api('/dancers?name=Partner%20Hidden%20Dancer&studio=Partner%20Test%20Studio', good.rawKey);
    check(supSearch.status === 200 && supSearch.json.dancers.length === 0,
      'a safety-suppressed dancer does not exist in partner search');
    const supDetail = await api('/dancers/DNC-partner-suppressed/awards', good.rawKey);
    check(supDetail.status === 404, 'a suppressed detail record reads 404 — same as nonexistent', 'status ' + supDetail.status);

    // ---- detail ----
    const numeric = await api(`/dancers/${dn.lastID}/awards`, good.rawKey);
    check(numeric.status === 404, 'numeric ids are refused — the enumeration-oracle rule survives auth', 'status ' + numeric.status);
    const detail = await api('/dancers/DNC-partner-dancer/awards', good.rawKey);
    const years = ((detail.json || {}).awards || []).map(a => parseInt(a.event_year, 10));
    check(detail.status === 200 && detail.json.dancer.unique_id === 'DNC-partner-dancer' &&
          years.length === 3 && years.every((y, i) => i === 0 || years[i - 1] >= y) &&
          detail.json.awards.every(a => a.place_display),
      'the detail record returns the full public trophy case, newest season first, placements formatted',
      'years=' + years.join(','));

    // ---- audit log ----
    const audits = await db.all(
      'SELECT endpoint, query_name, dancer_unique_ids, status FROM partner_query_log WHERE key_id = ? ORDER BY id',
      [good.keyId]);
    const searchRow = audits.find(a => a.endpoint === '/dancers' && a.query_name === 'partner test dancer');
    const detailRow = audits.find(a => a.endpoint === '/dancers/:uniqueId/awards' && a.dancer_unique_ids === 'DNC-partner-dancer');
    check(!!searchRow && searchRow.dancer_unique_ids.split(',').length === 2 && !!detailRow,
      'every lookup is in the append-only audit log with the dancer ids it returned',
      'rows=' + audits.length);

    // ---- quota, counted from the log ----
    let last;
    for (let i = 0; i < 4; i++) {
      last = await api('/dancers?name=Partner%20Test%20Dancer&studio=Partner%20Test%20Studio', tiny.rawKey);
    }
    check(last.status === 429 && last.json.error === 'quota_exceeded',
      'the daily quota stops the fourth lookup on a 3/day key', 'status ' + last.status);
    const quotaRow = await db.get(
      "SELECT COUNT(*) AS n FROM partner_query_log WHERE key_id = ? AND status = 'quota_exceeded'", [tiny.keyId]);
    check(quotaRow.n >= 1, 'the refused lookup is audited too — refusals are part of the record');

    // ---- pre-auth flood control (LAST: it poisons this IP's window) ----
    // A buggy retry loop — or no key at all — must hit a 429 before the
    // key-lookup database read, not hammer it for a month.
    let flood = null;
    for (let i = 0; i < 130 && (!flood || flood.status !== 429); i++) {
      flood = await api('/openapi.json');
    }
    check(flood.status === 429 && flood.json.error === 'rate_limited',
      'a keyless flood is refused per-IP before authentication', 'status ' + flood.status);

    // ---- the property the mount position exists for ----
    check(cookiesSeen.length === 0,
      'no partner API response ever set a cookie (mounted before the session store)',
      cookiesSeen.join(', ') || 'none');
  } finally {
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures ? `${failures} partner API check(s) FAILED.` : 'All partner API checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
