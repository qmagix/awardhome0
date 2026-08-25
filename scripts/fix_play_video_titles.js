// One-off cleanup: strip the "Play Video" suffix that the KAR/Rainbow
// results site leaked into routine titles (a nested "Play Video" link
// inside the routine cell, concatenated by .text() — scrapers fixed
// 2026-08-25 in scrape_kar_year.js / scrape_rainbow.js / scrape_dancekar.js).
//
// Verified before writing this script: none of the suffixed rows has a
// clean twin (same event/studio/type/place/category), so this is a pure
// in-place rename with no duplicate-merging needed. Idempotent — a second
// run finds nothing to do.
//
// Usage (from repo root, same on local and prod for data parity):
//   node scripts/fix_play_video_titles.js           # dry run: counts only
//   node scripts/fix_play_video_titles.js --apply   # perform the rename
const { openDb } = require('../database');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  const byOrg = await db.all(`
    SELECT o.name AS org, COUNT(*) AS count
    FROM awards a
    JOIN events e ON a.event_id = e.id
    JOIN organizations o ON e.org_id = o.id
    WHERE a.performance_name LIKE '% Play Video'
    GROUP BY o.name ORDER BY count DESC
  `);
  const total = byOrg.reduce((s, r) => s + r.count, 0);

  console.log(`Rows with a trailing " Play Video": ${total.toLocaleString()}`);
  byOrg.forEach(r => console.log(`  ${r.org}: ${r.count.toLocaleString()}`));

  if (!total) { console.log('Nothing to do.'); return; }
  if (!apply) { console.log('\nDry run — re-run with --apply to fix.'); return; }

  // Repeated suffixes ("X Play Video Play Video") would survive a single
  // pass, so loop until clean. Verified zero at time of writing; the loop
  // is insurance.
  let pass = 0;
  for (;;) {
    const result = await db.run(`
      UPDATE awards
      SET performance_name = TRIM(SUBSTR(performance_name, 1, LENGTH(performance_name) - LENGTH(' Play Video')))
      WHERE performance_name LIKE '% Play Video'
    `);
    pass++;
    console.log(`Pass ${pass}: renamed ${result.changes.toLocaleString()} rows`);
    if (!result.changes) break;
  }

  const leftover = await db.get(`SELECT COUNT(*) AS c FROM awards WHERE performance_name LIKE '% Play Video'`);
  console.log(`Remaining suffixed rows: ${leftover.c} ${leftover.c === 0 ? '✓' : '— INVESTIGATE'}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
