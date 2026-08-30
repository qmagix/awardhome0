// Fill/refresh awards.performance_name_key from utils/routineKey.js —
// the machine-canonical routine key (unicode punctuation folds, whitespace,
// case). Idempotent, chunked, safe to run any time; wired into the weekly
// pipeline and run once at deploy. Never touches performance_name itself.
//
// Usage: node scripts/sweep_routine_keys.js [--apply]

const { openDb } = require('../database');
const { canonicalizeRoutine, ensureRoutineAliasTable } = require('../utils/routineKey');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  // Owner-declared aliases redirect keys per studio (phase 2) — the sweep
  // must apply them or it would undo owner merges on every run.
  await ensureRoutineAliasTable(db);
  const aliasRows = await db.all('SELECT studio_id, from_key, to_key FROM studio_routine_aliases');
  const aliases = new Map(aliasRows.map(r => [r.studio_id + '|' + r.from_key, r.to_key]));

  let lastId = 0, scanned = 0, stale = 0;
  for (;;) {
    const rows = await db.all(
      'SELECT id, studio_id, performance_name, performance_name_key FROM awards WHERE id > ? ORDER BY id LIMIT 50000', [lastId]);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    const changes = [];
    for (const r of rows) {
      scanned++;
      let key = canonicalizeRoutine(r.performance_name);
      if (key && aliases.has(r.studio_id + '|' + key)) key = aliases.get(r.studio_id + '|' + key);
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
