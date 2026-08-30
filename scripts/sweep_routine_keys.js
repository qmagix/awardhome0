// Fill/refresh awards.performance_name_key from utils/routineKey.js —
// the machine-canonical routine key (unicode punctuation folds, whitespace,
// case). Idempotent, chunked, safe to run any time; wired into the weekly
// pipeline and run once at deploy. Never touches performance_name itself.
//
// Usage: node scripts/sweep_routine_keys.js [--apply]

const { openDb } = require('../database');
const { canonicalizeRoutine } = require('../utils/routineKey');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  let lastId = 0, scanned = 0, stale = 0;
  for (;;) {
    const rows = await db.all(
      'SELECT id, performance_name, performance_name_key FROM awards WHERE id > ? ORDER BY id LIMIT 50000', [lastId]);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    const changes = [];
    for (const r of rows) {
      scanned++;
      const key = canonicalizeRoutine(r.performance_name);
      if (key !== (r.performance_name_key || null)) changes.push([key, r.id]);
    }
    stale += changes.length;
    if (apply && changes.length) {
      await db.run('BEGIN TRANSACTION');
      for (const [k, id] of changes) {
        await db.run('UPDATE awards SET performance_name_key = ? WHERE id = ?', [k, id]);
      }
      await db.run('COMMIT');
    }
  }

  console.log(`Scanned ${scanned} awards; ${apply ? 'updated' : 'stale keys'}: ${stale}.`);
  if (!apply) console.log('Dry run — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
