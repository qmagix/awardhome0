// Collapse whitespace damage in dancer names (tabs/multi-spaces from PDF
// extraction) — mirror of normalize_performance_whitespace.js. Pure collapse,
// never the word-glue heuristic (names like "de la Cruz" must survive).
//
// Usage: node scripts/normalize_dancer_whitespace.js [--apply]

const { openDb } = require('../database');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();
  const rows = await db.all(`
    SELECT id, name FROM dancers
    WHERE name LIKE '%' || CHAR(9) || '%' OR name LIKE '%  %' OR name != TRIM(name)`);
  console.log(`Dancers with whitespace-damaged names: ${rows.length}`);
  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }
  let changed = 0;
  for (const r of rows) {
    const clean = String(r.name).replace(/\s+/g, ' ').trim();
    if (clean && clean !== r.name) {
      await db.run('UPDATE dancers SET name = ? WHERE id = ?', [clean, r.id]);
      changed++;
    }
  }
  console.log(`Normalized ${changed} dancer names.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
