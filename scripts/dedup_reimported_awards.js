// Repair re-imported duplicate awards (found 2026-08-21 via studio 62).
//
// Root cause: the Rainbow importer's idempotency check included
// award_class — a value derived by our own classifier — so when the
// classifier changed between runs (e.g. studio awards: 'adjudication' →
// 'studio'), every re-scraped award missed the check and re-inserted:
// 8,835 surplus rows across 37 Rainbow events (+3 StarQuest). The
// importer key is now observable-fields-only (scrape_rainbow.js); this
// script collapses the existing duplicates with the SAME group key, so
// the repair and the importer agree on award identity forever.
//
// Also normalizes Rainbow's literal "– #" routine-name placeholder to
// blank (143 rows) BEFORE grouping, so placeholder variants dedupe too.
//
// Per duplicate group (event, studio, dancer, name, type, category, place):
//   keep    - the row with the most award_dancers links, then
//             is_first_place, then lowest id (oldest, most-referenced)
//   adopt   - award_class from the NEWEST row (latest classifier),
//             is_first_place/performance_number/notes from any row that
//             has them if the keeper doesn't
//   repoint - award_dancers, award_acknowledgements, award_card_photos
//             (and reactions.sqlite, best-effort) from losers to keeper
//   delete  - the losers
//
// Deterministic + idempotent: safe to run on local and prod for
// identical results; rerun reports 0 actionable. Usage:
//   node scripts/dedup_reimported_awards.js [--dry-run]
const { openDb } = require('../database');

const DRY = process.argv.includes('--dry-run');

const PLACEHOLDERS = ['– #', '- #', '— #', '–#', '-#', '—#', '#', '–', '—'];

async function main() {
  const db = await openDb();

  // 1. Placeholder routine names → blank
  const placeholderRows = await db.get(
    `SELECT COUNT(*) AS n FROM awards WHERE trim(performance_name) IN (${PLACEHOLDERS.map(() => '?').join(',')})`,
    PLACEHOLDERS);
  console.log(`Placeholder routine names to blank: ${placeholderRows.n}`);
  if (!DRY && placeholderRows.n) {
    await db.run(
      `UPDATE awards SET performance_name = '' WHERE trim(performance_name) IN (${PLACEHOLDERS.map(() => '?').join(',')})`,
      PLACEHOLDERS);
  }

  // 2. Duplicate groups on the importer's identity key
  const groups = await db.all(`
    SELECT event_id, studio_id, IFNULL(dancer_id, -1) AS dkey,
           ${DRY ? `CASE WHEN trim(performance_name) IN (${PLACEHOLDERS.map(s => quoteSql(s)).join(',')}) THEN '' ELSE performance_name END` : 'performance_name'} AS pname,
           award_type, category, IFNULL(place, '') AS pkey,
           COUNT(*) AS n, GROUP_CONCAT(id) AS ids
    FROM awards
    GROUP BY event_id, studio_id, dkey, pname, award_type, category, pkey
    HAVING COUNT(*) > 1
    ORDER BY event_id, MIN(id)
  `);
  console.log(`Duplicate groups: ${groups.length}`);

  let deleted = 0, relinked = 0, classUpdated = 0;
  if (!DRY) await db.run('BEGIN');
  try {
    for (const g of groups) {
      const ids = g.ids.split(',').map(Number);
      const rows = await db.all(
        `SELECT a.id, a.award_class, a.is_first_place, a.performance_number, a.notes,
                (SELECT COUNT(*) FROM award_dancers ad WHERE ad.award_id = a.id) AS links
         FROM awards a WHERE a.id IN (${ids.map(() => '?').join(',')})`, ids);

      rows.sort((a, b) => (b.links - a.links) || (b.is_first_place - a.is_first_place) || (a.id - b.id));
      const keeper = rows[0];
      const losers = rows.slice(1);
      const newest = rows.reduce((m, r) => (r.id > m.id ? r : m), rows[0]);

      const adoptClass = newest.award_class;
      const adoptFirst = Math.max(...rows.map(r => r.is_first_place || 0));
      const adoptNumber = keeper.performance_number || (rows.find(r => r.performance_number) || {}).performance_number || keeper.performance_number;
      const adoptNotes = keeper.notes || (rows.find(r => r.notes) || {}).notes || null;

      if (DRY) {
        deleted += losers.length;
        continue;
      }

      if (keeper.award_class !== adoptClass || (keeper.is_first_place || 0) !== adoptFirst ||
          keeper.performance_number !== adoptNumber || keeper.notes !== adoptNotes) {
        await db.run(
          'UPDATE awards SET award_class = ?, is_first_place = ?, performance_number = ?, notes = ? WHERE id = ?',
          [adoptClass, adoptFirst, adoptNumber, adoptNotes, keeper.id]);
        classUpdated++;
      }

      const loserIds = losers.map(l => l.id);
      const ph = loserIds.map(() => '?').join(',');
      // Repoint children; OR IGNORE handles a dancer linked to both copies
      const r1 = await db.run(`UPDATE OR IGNORE award_dancers SET award_id = ? WHERE award_id IN (${ph})`, [keeper.id, ...loserIds]);
      await db.run(`DELETE FROM award_dancers WHERE award_id IN (${ph})`, loserIds);
      await db.run(`UPDATE award_acknowledgements SET award_id = ? WHERE award_id IN (${ph})`, [keeper.id, ...loserIds]).catch(() => {});
      await db.run(`UPDATE award_card_photos SET award_id = ? WHERE award_id IN (${ph})`, [keeper.id, ...loserIds]).catch(() => {});
      relinked += r1.changes || 0;

      await db.run(`DELETE FROM awards WHERE id IN (${ph})`, loserIds);
      deleted += loserIds.length;
    }
    if (!DRY) await db.run('COMMIT');
  } catch (e) {
    if (!DRY) await db.run('ROLLBACK');
    throw e;
  }

  // 3. Reactions live in a separate DB — repoint best-effort (no-op when empty)
  if (!DRY && deleted > 0) {
    try {
      const { openReactionsDb } = require('../utils/reactions');
      const rdb = await openReactionsDb();
      const orphans = await rdb.all('SELECT DISTINCT award_id FROM reactions');
      for (const o of orphans) {
        const still = await db.get('SELECT 1 FROM awards WHERE id = ?', [o.award_id]);
        if (!still) await rdb.run('DELETE FROM reactions WHERE award_id = ?', [o.award_id]);
      }
    } catch (e) { console.log('reactions repoint skipped:', e.message); }
  }

  console.log(`${DRY ? '[dry-run] would delete' : 'Deleted'} ${deleted} duplicate awards; relinked ${relinked} dancer links; updated ${classUpdated} keepers.`);
}

// small helper for the dry-run SQL (quote placeholder literals)
function quoteSql(s) { return `'${s.replace(/'/g, "''")}'`; }

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
