// Promote a SOLO's junction link into the legacy primary column
// (award_dancers -> awards.dancer_id). The mirror of
// backfill_legacy_dancer_links.js, which only ever ran the other direction —
// which is why 67.5k solos sat with a junction row and no primary dancer.
//
// Symptom Q reported: on /manage/studio/:id/awards those dancers appear under
// "Group Dancers" instead of "Primary Dancer", because the two columns read
// two different tables. It is not only cosmetic — public queries that join
// `a.dancer_id` (Hall of Fame, card surfaces) render a blank dancer for them.
//
// Cause: NOT owner editing (only 6 of 67,574 rows came from source=
// 'studio_owner'). It is the importers — Showstopper, Starpower, NYCDA and the
// shared DanceBug importer behind Imagine/Believe/DreamMaker/Rainbow write the
// junction only. Those are fixed to double-write via utils/soloPrimary.js;
// this script repairs the history, and runs weekly so any regression heals.
//
// Safety: identification is POSITIVE (see utils/soloPrimary.js) — the label
// must say solo/title. Awards are never promoted just because they happen to
// have one linked dancer, since 1,874 group-worded awards do too (partly
// entered casts) and promoting those would turn real groups into solos.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/backfill_solo_primary_dancer.js           # dry run
//   node scripts/backfill_solo_primary_dancer.js --apply
const { openDb } = require('../database');
const { individualAwardSql } = require('../utils/soloPrimary');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  const IND = individualAwardSql('a');
  // the award's single junction link
  const ONE_LINK = `(SELECT COUNT(*) FROM award_dancers ad WHERE ad.award_id = a.id) = 1`;
  const THE_DANCER = `(SELECT ad.dancer_id FROM award_dancers ad WHERE ad.award_id = a.id)`;

  const eligible = `
    FROM awards a
    WHERE a.dancer_id IS NULL
      AND ${IND}
      AND ${ONE_LINK}
      AND EXISTS (SELECT 1 FROM dancers d WHERE d.id = ${THE_DANCER})
      AND NOT EXISTS (SELECT 1 FROM award_dancer_removals r
                       WHERE r.award_id = a.id AND r.dancer_id = ${THE_DANCER})`;

  const total = await db.get(`SELECT COUNT(*) AS n ${eligible}`);

  // Reported for visibility, never auto-fixed: an award whose label says solo
  // but which has 2+ DIFFERENT dancers linked is a real data error (e.g.
  // "Fabulous" -> Kenzie Sagerman | Olivia Altieri), not a missing primary.
  const anomalies = await db.get(`
    SELECT COUNT(*) AS n FROM awards a
    WHERE a.dancer_id IS NULL AND ${IND}
      AND (SELECT COUNT(*) FROM award_dancers ad WHERE ad.award_id = a.id) > 1`);

  const denied = await db.get(`
    SELECT COUNT(*) AS n FROM awards a
    WHERE a.dancer_id IS NULL AND ${IND} AND ${ONE_LINK}
      AND EXISTS (SELECT 1 FROM award_dancer_removals r
                   WHERE r.award_id = a.id AND r.dancer_id = ${THE_DANCER})`);

  console.log(`Solo/title awards with a junction link but no primary dancer: ${total.n}`);
  console.log(`  director-denied, will NOT be promoted:                      ${denied.n}`);
  console.log(`  solo-labelled but 2+ dancers linked (needs review, skipped): ${anomalies.n}`);

  if (total.n) {
    const byOrg = await db.all(`
      SELECT o.name AS org, COUNT(*) AS n
      FROM awards a
      JOIN events e ON e.id = a.event_id
      JOIN organizations o ON o.id = e.org_id
      WHERE a.dancer_id IS NULL
        AND ${IND}
        AND ${ONE_LINK}
        AND EXISTS (SELECT 1 FROM dancers d WHERE d.id = ${THE_DANCER})
        AND NOT EXISTS (SELECT 1 FROM award_dancer_removals r
                         WHERE r.award_id = a.id AND r.dancer_id = ${THE_DANCER})
      GROUP BY o.name ORDER BY n DESC LIMIT 10`);
    console.log('\n  by organization:');
    byOrg.forEach(r => console.log(`    ${String(r.n).padStart(7)}  ${r.org}`));

    const sample = await db.all(`
      SELECT a.id, a.award_type, a.category, a.performance_name,
             (SELECT d.name FROM award_dancers ad JOIN dancers d ON d.id = ad.dancer_id
               WHERE ad.award_id = a.id) AS dancer
      ${eligible} ORDER BY a.id LIMIT 5`);
    console.log('\n  sample:');
    sample.forEach(r => console.log(`    #${r.id} [${r.award_type || r.category || '?'}] "${r.performance_name || ''}" -> ${r.dancer}`));
  }

  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }
  if (!total.n) { console.log('\nNothing to do.'); return; }

  const res = await db.run(`
    UPDATE awards SET dancer_id = (SELECT ad.dancer_id FROM award_dancers ad WHERE ad.award_id = awards.id)
    WHERE awards.id IN (SELECT a.id ${eligible})`);
  console.log(`\n✓ APPLIED: ${res.changes} solo/title awards given their primary dancer.`);
  if (anomalies.n) console.log(`  (${anomalies.n} multi-dancer "solo" awards left for review — see docs/db_operations.md)`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
