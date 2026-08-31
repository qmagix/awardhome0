// Collapse whitespace damage in the award fields the importers DEDUPE on:
// category, award_type, place and notes. Completes the set alongside
// normalize_performance_whitespace.js (routine titles),
// normalize_dancer_whitespace.js and normalize_studio_whitespace.js.
//
// Why it matters beyond tidiness: these three columns are the idempotency key
// for several importers (StarQuest dedupes on event + studio + category +
// award_type + place). 17,162 awards carry tab-separated categories and 5,009
// tab-separated places, straight from the PDF extractors. Once an extractor is
// fixed to emit clean text, NOTHING matches the damaged rows -- re-running the
// importer silently inserts a full duplicate set instead of recognising its
// own earlier work. That is exactly what happened on the first StarQuest
// re-import attempt: 21,732 duplicate awards, rolled back from a snapshot.
//
// Pure whitespace collapse, never the word-glue heuristic: category names are
// real words and must not be re-spelled.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/normalize_award_field_whitespace.js           # dry run
//   node scripts/normalize_award_field_whitespace.js --apply
const { openDb } = require('../database');

// `notes` is in this list for a non-obvious reason: several importers put the
// published dancer name in notes and then dedupe with `notes LIKE '%name%'`.
// If notes keeps a tab-damaged name, a re-import with clean text never matches
// and inserts a full duplicate set -- which is precisely what happened twice
// on StarQuest (21,732 then 21,723 phantom awards, both rolled back).
const FIELDS = ['category', 'award_type', 'place', 'notes'];

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  let total = 0;
  const plan = [];
  for (const f of FIELDS) {
    const rows = await db.all(`
      SELECT id, ${f} AS val FROM awards
      WHERE ${f} IS NOT NULL
        AND (${f} LIKE '%' || CHAR(9) || '%' OR ${f} LIKE '%  %' OR ${f} <> TRIM(${f}))`);
    const changes = rows
      .map(r => ({ id: r.id, field: f, from: r.val, to: String(r.val).replace(/\s+/g, ' ').trim() }))
      .filter(c => c.to !== c.from);
    plan.push(...changes);
    total += changes.length;
    console.log(`  ${f.padEnd(12)} ${changes.length} row(s) to clean`);
    changes.slice(0, 2).forEach(c => console.log(`      ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`));
  }

  console.log(`\nTotal award fields to normalise: ${total}`);
  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }
  if (!total) { console.log('Nothing to do.'); return; }

  await db.run('BEGIN IMMEDIATE');
  try {
    for (const c of plan) {
      await db.run(`UPDATE awards SET ${c.field} = ? WHERE id = ?`, [c.to, c.id]);
    }
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
  console.log(`\n✓ APPLIED: ${total} award field(s) normalised.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
