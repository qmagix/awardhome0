// Promote legacy solo links (awards.dancer_id) into the canonical
// award_dancers junction table, making junction-only queries correct for
// solo awards (importers write solos to the legacy column by convention).
//
// - Idempotent: UNIQUE(award_id, dancer_id) + INSERT OR IGNORE.
// - Never resurrects a director-denied link (award_dancer_removals).
// - Additive only: no awards rows touched, legacy column left in place
//   (import idempotency checks match on it).
// - Backfilled rows carry source='backfill' so provenance-scoped tools
//   (freeze-and-release sweeps source='studio_owner') ignore them.
//
// Usage: node scripts/backfill_legacy_dancer_links.js [--apply]
//   (dry-run by default; DB_PATH honored, so the staged weekly import
//    runs it against the staging copy)

const { openDb } = require('../database');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  // Guard: only promote pointers to dancers that still exist — past merges
  // left stale legacy pointers to deleted dancer ids (FKs are deliberately
  // off), and promoting those would manufacture orphan junction rows.
  const gapSql = `
    FROM awards a
    WHERE a.dancer_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM dancers d WHERE d.id = a.dancer_id)
      AND NOT EXISTS (SELECT 1 FROM award_dancers ad
                       WHERE ad.award_id = a.id AND ad.dancer_id = a.dancer_id)
      AND NOT EXISTS (
        -- A same-named OTHER profile already junction-linked to this award is
        -- a duplicate-profile signal, not a missing teammate: promoting the
        -- legacy pointer would double-list the dancer and restyle the solo
        -- card as a group. Leave it to the duplicate-merge tools.
        SELECT 1 FROM award_dancers o
        JOIN dancers od ON od.id = o.dancer_id
        JOIN dancers ld ON ld.id = a.dancer_id
        WHERE o.award_id = a.id AND o.dancer_id != a.dancer_id
          AND LOWER(od.name) = LOWER(ld.name))`;
  const before = await db.get(`SELECT COUNT(*) AS n ${gapSql}`);
  const tombstoned = await db.get(`
    SELECT COUNT(*) AS n ${gapSql}
      AND EXISTS (SELECT 1 FROM award_dancer_removals r
                   WHERE r.award_id = a.id AND r.dancer_id = a.dancer_id)`);

  console.log(`Legacy-linked awards missing a junction row: ${before.n}`);
  console.log(`  of which director-denied (will NOT be promoted): ${tombstoned.n}`);
  console.log(`  to promote: ${before.n - tombstoned.n}`);

  if (!apply) {
    console.log('\nDry run — re-run with --apply to write.');
    return;
  }

  // Sweep any orphan junction rows this script created on an earlier run
  // (before the dancer-exists guard): dancer gone -> the row renders nowhere
  // but still inflates dancer_count (solo cards would style as groups).
  const swept = await db.run(`
    DELETE FROM award_dancers
    WHERE source = 'backfill'
      AND NOT EXISTS (SELECT 1 FROM dancers d WHERE d.id = award_dancers.dancer_id)`);
  if (swept.changes) console.log(`Swept ${swept.changes} orphan junction rows from earlier backfills.`);

  // Sweep backfill rows that double-list a dancer next to a same-named
  // duplicate profile (created before the guard below existed).
  const dupSwept = await db.run(`
    DELETE FROM award_dancers
    WHERE source = 'backfill'
      AND EXISTS (
        SELECT 1 FROM award_dancers o
        JOIN dancers od ON od.id = o.dancer_id
        JOIN dancers bd ON bd.id = award_dancers.dancer_id
        WHERE o.award_id = award_dancers.award_id
          AND o.id != award_dancers.id
          AND LOWER(od.name) = LOWER(bd.name))`);
  if (dupSwept.changes) console.log(`Swept ${dupSwept.changes} same-name duplicate-profile rows from earlier backfills.`);

  const res = await db.run(`
    INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status, source)
    SELECT a.id, a.dancer_id, 'imported', 'backfill'
    FROM awards a
    WHERE a.dancer_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM dancers d WHERE d.id = a.dancer_id)
      AND NOT EXISTS (SELECT 1 FROM award_dancer_removals r
                       WHERE r.award_id = a.id AND r.dancer_id = a.dancer_id)
      AND NOT EXISTS (
        SELECT 1 FROM award_dancers o
        JOIN dancers od ON od.id = o.dancer_id
        JOIN dancers ld ON ld.id = a.dancer_id
        WHERE o.award_id = a.id AND o.dancer_id != a.dancer_id
          AND LOWER(od.name) = LOWER(ld.name))`);
  const after = await db.get(`SELECT COUNT(*) AS n ${gapSql}`);

  console.log(`\nPromoted ${res.changes} legacy links into award_dancers.`);
  console.log(`Remaining gap: ${after.n} (should equal the director-denied count: ${tombstoned.n})`);
  if (after.n !== tombstoned.n) {
    console.error('WARNING: remaining gap does not match tombstoned count — investigate before re-running.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
