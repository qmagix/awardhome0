// Weekly-pipeline wrapper for the txt-flow orgs (Ultra, Refresh): scrape
// the year's results into reviewable txt, then import the txt with
// --apply into whatever DB openDb() resolves — during the weekly staged
// run that is the staging copy (DB_PATH), so the delta still goes through
// validate_import.js scoring and the green/amber/red gate like every
// other org. Idempotent end to end: unchanged events import zero rows.
//
// Usage: node scripts/update_txt_org.js <ultra|refresh> <year>
const { spawnSync } = require('child_process');
const path = require('path');

const ORGS = {
  ultra: { scrape: 'scrape_ultra_to_txt.js', import: 'import_ultra_txt.js' },
  refresh: { scrape: 'scrape_refresh_to_txt.js', import: 'import_refresh_txt.js' },
};

const key = process.argv[2];
const year = process.argv[3];
const org = ORGS[key];
if (!org || !/^\d{4}$/.test(year || '')) {
  console.error('Usage: node scripts/update_txt_org.js <ultra|refresh> <year>');
  process.exit(2);
}

function run(script, args) {
  const res = spawnSync('node', [path.join(__dirname, script), ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');
  return res.status;
}

let status = run(org.scrape, [year]);
if (status !== 0) {
  console.error(`${org.scrape} ${year} failed (exit ${status}) — skipping import`);
  process.exit(status);
}
status = run(org.import, ['--apply']);
process.exit(status);
