// Pre-deploy gate — Layer 1 of the render-bug defense. Run BEFORE every
// deploy (npm run gate):
//
//   1. smoke suite (test/smoke.js) against the local DB
//   2. mobile API contract test (test/api_mobile.js) against its OWN
//      throwaway copy — the API's write paths mint awards, claims and
//      evidence, so it must never touch a working database
//   3. builds a THROWAWAY adversarial copy of the local DB — every pending
//      ack/photo approved, a coin approved on a big logo-bearing org with a
//      hostile colophon message, one org's custom_icons corrupted — the
//      worst-case data states that single-entity checks never hit
//   4. scripts/sweep_public_pages.js against the adversarial copy
//      (data-state coverage: coin/corrupt/ack/photo/collab/... strata)
//   5. scripts/audit_get_routes.js against the adversarial copy
//      (route coverage: every GET, superadmin + owner sessions, and the
//      mobile API with a real bearer token)
//
// Any stage failing => non-zero exit; do not deploy.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GATE_PORT = 3997;
const GATE_DB = path.join(os.tmpdir(), 'awardhome_gate.sqlite');
// Family submissions stage in their own SQLite file; the gate gets a
// throwaway one so a sweep or audit never touches a real staging database.
const GATE_SUBMISSIONS_DB = path.join(os.tmpdir(), 'awardhome_gate_submissions.sqlite');
// Mobile auth state and evidence get throwaways too: the route audit mints a
// real bearer session, and that must not land in the developer's sessions.sqlite.
const GATE_AUTH_DB = path.join(os.tmpdir(), 'awardhome_gate_auth.sqlite');
const GATE_EVIDENCE_DIR = path.join(os.tmpdir(), 'awardhome_gate_evidence');

const run = (cmd, args, opts = {}) => new Promise(resolve => {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  child.on('close', code => resolve(code));
});

async function main() {
  const results = {};

  console.log('=== GATE 1/5: smoke suite ===');
  results.smoke = await run('node', [path.join('test', 'smoke.js')]);
  if (results.smoke !== 0) return finish(results);

  console.log('=== GATE 2/5: mobile API contract test ===');
  results.api = await run('node', [path.join('test', 'api_mobile.js')]);
  if (results.api !== 0) return finish(results);

  console.log('=== GATE 3/5: building adversarial DB copy ===');
  for (const ext of ['', '-wal', '-shm']) {
    const src = path.join(ROOT, 'database.sqlite' + ext);
    if (fs.existsSync(src)) fs.copyFileSync(src, GATE_DB + ext);
    else fs.rmSync(GATE_DB + ext, { force: true });
  }
  const sql = `
    PRAGMA wal_checkpoint(TRUNCATE);
    UPDATE award_acknowledgements SET status='approved';
    UPDATE award_card_photos SET status='approved';
    UPDATE dancers SET card_photo_status='approved' WHERE card_photo_url IS NOT NULL;
    UPDATE feature_flags SET state='on';
    UPDATE organizations SET custom_icons = json_set(COALESCE(NULLIF(custom_icons,''),'{}'),
        '$.logo_approved', json('true'), '$.colophon_message', 'Gate QA "msg" & <3')
      WHERE logo_url IS NOT NULL AND id IN (
        SELECT o.id FROM organizations o JOIN events e ON e.org_id=o.id
        JOIN awards a ON a.event_id=e.id GROUP BY o.id ORDER BY COUNT(*) DESC LIMIT 3);
    INSERT OR IGNORE INTO dancer_card_hidden (dancer_id, award_id)
      SELECT dancer_id, award_id FROM award_dancers LIMIT 200;
    UPDATE dancers SET hide_from_rankings = 1
      WHERE id IN (SELECT dancer_id FROM award_dancers LIMIT 50);
    UPDATE dancers SET hide_from_search = 1
      WHERE id IN (SELECT dancer_id FROM award_dancers LIMIT 51 OFFSET 25);
    UPDATE dancers SET suppressed_at = datetime('now'), suppressed_reason = 'gate QA'
      WHERE id IN (
        SELECT ad.dancer_id FROM award_dancers ad
        WHERE ad.award_id IN (
          SELECT award_id FROM award_dancers GROUP BY award_id HAVING COUNT(*) > 1 LIMIT 15)
        LIMIT 30);
    UPDATE organizations SET custom_icons = '{corrupt json'
      WHERE id = (SELECT o.id FROM organizations o JOIN events e ON e.org_id=o.id
        JOIN awards a ON a.event_id=e.id GROUP BY o.id ORDER BY COUNT(*) DESC LIMIT 1 OFFSET 3);
  `;
  // feed SQL over stdin
  const mut2 = await new Promise(resolve => {
    const child = spawn('sqlite3', [GATE_DB], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => out += d);
    child.on('close', code => resolve({ code, out }));
    child.stdin.write(sql);
    child.stdin.end();
  });
  if (mut2.code !== 0) {
    console.error('adversarial mutations failed:', mut2.out);
    results.mutate = 1;
    return finish(results);
  }
  results.mutate = 0;

  console.log('=== GATE 4/5: adversarial page sweep ===');
  const env = {
    ...process.env, DB_PATH: GATE_DB, SUBMISSIONS_DB_PATH: GATE_SUBMISSIONS_DB,
    MOBILE_AUTH_DB_PATH: GATE_AUTH_DB, EVIDENCE_DIR: GATE_EVIDENCE_DIR,
    PORT: String(GATE_PORT), BETA_MODE: 'false',
    PROFILE_RATE_LIMIT: '50000', ENABLE_NIGHTLY_BACKUPS: 'false', ENABLE_WEEKLY_SCRAPE: 'false',
    ENABLE_SENTINEL: 'false', EMAIL_PROVIDER: '',
  };
  const server = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', d => serverLog += d);
  server.stderr.on('data', d => serverLog += d);
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://localhost:${GATE_PORT}/healthz`); up = true; break; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!up) {
    console.error('gate server failed to boot:\n', serverLog.slice(-1500));
    server.kill(); results.sweep = 1; return finish(results);
  }
  results.sweep = await run('node', [path.join('scripts', 'sweep_public_pages.js')],
    { env: { ...env, SWEEP_BASE: `http://localhost:${GATE_PORT}` } });
  server.kill();
  if (results.sweep !== 0) return finish(results);

  console.log('=== GATE 5/5: authenticated route audit ===');
  results.audit = await run('node', [path.join('scripts', 'audit_get_routes.js')], { env });

  return finish(results);
}

function finish(results) {
  for (const ext of ['', '-wal', '-shm']) {
    fs.rmSync(GATE_DB + ext, { force: true });
    fs.rmSync(GATE_SUBMISSIONS_DB + ext, { force: true });
    fs.rmSync(GATE_AUTH_DB + ext, { force: true });
  }
  fs.rmSync(GATE_EVIDENCE_DIR, { recursive: true, force: true });
  const failed = Object.entries(results).filter(([, c]) => c !== 0);
  console.log('\n=== GATE SUMMARY ===');
  for (const [stage, code] of Object.entries(results)) {
    console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${stage}`);
  }
  if (failed.length) { console.log('GATE FAILED — do not deploy.'); process.exit(1); }
  console.log('GATE CLEAN — safe to deploy.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
