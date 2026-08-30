// Repair PDF-extraction whitespace damage in routine titles: tabs between
// words ("Beyond\tSilence") and multi-space runs make visually-identical
// routines group separately on every routine-keyed surface (group-dancers
// cards, All Routines, acknowledgement/photo propagation). Pure whitespace
// collapse only — normalizeName's word-glue heuristic is for category
// headers and would corrupt free-form titles.
//
// Usage: node scripts/normalize_performance_whitespace.js [--apply]
//   (dry-run by default; DB_PATH honored; idempotent)

const { openDb } = require('../database');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  const rows = await db.all(`
    SELECT id, performance_name FROM awards
    WHERE performance_name LIKE '%' || CHAR(9) || '%'
       OR performance_name LIKE '%  %'
       OR performance_name != TRIM(performance_name)`);
  console.log(`Awards with whitespace-damaged routine titles: ${rows.length}`);

  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }

  let changed = 0;
  for (const r of rows) {
    const clean = String(r.performance_name).replace(/\s+/g, ' ').trim();
    if (clean !== r.performance_name) {
      await db.run('UPDATE awards SET performance_name = ? WHERE id = ?', [clean, r.id]);
      changed++;
    }
  }
  const remaining = await db.get(`
    SELECT COUNT(*) AS n FROM awards
    WHERE performance_name LIKE '%' || CHAR(9) || '%' OR performance_name LIKE '%  %'`);
  console.log(`Normalized ${changed} routine titles. Remaining damaged: ${remaining.n} (should be 0).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
