// Repair: the StarQuest importer used to stash the published dancer name in
// awards.notes ("(Dancer: Faye Gu)") without creating or linking a dancer —
// ~18k awards on 2026-08-29. This promotes those names into real links:
// match by name+studio, tie-break by routine (see utils/resolveDancer.js),
// create-and-roster when no confident match, then set awards.dancer_id (solo
// convention) + the award_dancers junction row. Idempotent: repaired awards
// drop out of the scan (dancer_id set). Tombstoned pairs are skipped.
//
// Usage: node scripts/repair_starquest_notes_dancers.js [--apply]
//   (dry-run by default; DB_PATH honored)

const { openDb } = require('../database');
const { resolveOrCreateDancer } = require('../utils/resolveDancer');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  const rows = await db.all(`
    SELECT a.id, a.studio_id, a.performance_name, a.notes, e.year AS event_year
    FROM awards a JOIN events e ON a.event_id = e.id
    WHERE e.org_id = (SELECT id FROM organizations WHERE slug = 'starquest')
      AND a.dancer_id IS NULL
      AND a.notes LIKE '%Dancer:%'
      AND NOT EXISTS (SELECT 1 FROM award_dancers ad WHERE ad.award_id = a.id)
    ORDER BY a.performance_name, a.id`);

  console.log(`StarQuest awards with a notes-stashed dancer and no link: ${rows.length}`);

  let linked = 0, createdProfiles = 0, matchedExisting = 0, skippedNoName = 0, skippedTombstoned = 0;
  for (const row of rows) {
    const m = /Dancer:\s*([^)|]+)/.exec(row.notes || '');
    const name = m ? m[1].replace(/\s+/g, ' ').trim() : '';
    if (!name || name.toUpperCase() === 'N/A' || !row.studio_id) { skippedNoName++; continue; }
    if (!apply) continue;

    const resolved = await resolveOrCreateDancer(db, { name, studioId: row.studio_id, routine: row.performance_name, year: row.event_year });
    if (!resolved) { skippedNoName++; continue; }
    if (resolved.created) createdProfiles++; else matchedExisting++;

    const removed = await db.get(
      'SELECT 1 FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [row.id, resolved.id]);
    if (removed) { skippedTombstoned++; continue; }

    await db.run('UPDATE awards SET dancer_id = ? WHERE id = ?', [resolved.id, row.id]);
    await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [row.id, resolved.id]);
    linked++;
  }

  if (!apply) {
    const parseable = rows.length - skippedNoName;
    console.log(`Parseable names: ${parseable}, unparseable/blank: ${skippedNoName}`);
    console.log('\nDry run — re-run with --apply to write.');
    return;
  }

  console.log(`\nLinked ${linked} awards (${matchedExisting} to existing dancers, ${createdProfiles} new profiles created).`);
  console.log(`Skipped: ${skippedNoName} unparseable, ${skippedTombstoned} tombstoned.`);
  const remaining = await db.get(`
    SELECT COUNT(*) AS n FROM awards a JOIN events e ON a.event_id = e.id
    WHERE e.org_id = (SELECT id FROM organizations WHERE slug = 'starquest')
      AND a.dancer_id IS NULL AND a.notes LIKE '%Dancer:%'
      AND NOT EXISTS (SELECT 1 FROM award_dancers ad WHERE ad.award_id = a.id)`);
  console.log(`Remaining unlinked notes-dancers: ${remaining.n} (should equal unparseable + tombstoned).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
