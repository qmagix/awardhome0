// Repairs awards whose legacy dancer_id points at a deleted dancer, by
// restoring it from the award_dancers join table (the authoritative link).
// Only touches rows with exactly ONE valid linked dancer; anything
// ambiguous is reported and left alone. Idempotent — safe to re-run.
const { openDb } = require('../database');

async function main() {
  const db = await openDb();

  const before = await db.get(
    `SELECT COUNT(*) AS c FROM awards a
     WHERE a.dancer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dancers d WHERE d.id = a.dancer_id)`
  );
  console.log(`Orphaned awards.dancer_id rows: ${before.c}`);
  if (before.c === 0) return console.log('Nothing to do.');

  const result = await db.run(
    `UPDATE awards SET dancer_id = (
       SELECT ad.dancer_id FROM award_dancers ad
       JOIN dancers d2 ON d2.id = ad.dancer_id
       WHERE ad.award_id = awards.id
     )
     WHERE dancer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dancers d WHERE d.id = awards.dancer_id)
       AND (SELECT COUNT(*) FROM award_dancers ad2
            JOIN dancers d3 ON d3.id = ad2.dancer_id
            WHERE ad2.award_id = awards.id) = 1`
  );
  console.log(`Repaired from award_dancers: ${result.changes}`);

  const after = await db.get(
    `SELECT COUNT(*) AS c FROM awards a
     WHERE a.dancer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dancers d WHERE d.id = a.dancer_id)`
  );
  console.log(`Remaining orphans (ambiguous, left untouched): ${after.c}`);

  const fk = await db.all('PRAGMA foreign_key_check');
  console.log(`PRAGMA foreign_key_check violations: ${fk.length}`);
  process.exit(after.c === 0 && fk.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
