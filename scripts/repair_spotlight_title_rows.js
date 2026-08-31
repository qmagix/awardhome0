// Remove the Spotlight title rows left corrupted by the placement-pattern bug
// (fixed 2026-08-30 in scripts/import_spotlight_pdfs.js).
//
// THE BUG: the placement pattern lacked "Miss"/"Mr" (how Spotlight records the
// ACTUAL title winner -- so every winner row was silently dropped) and
// Spotlight's "1st Run Up" / "1st Runner-Up" spellings of "1st Runner Up". The
// regex fell through to the bare "1st", leaving the placement's own tail as the
// first token -- which the Title Winner branch took as the STUDIO. Result:
//
//   place "1st"   studio "Run Up"   dancer "Dance Images West ARIANA CAMPBELL"
//
// i.e. a phantom studio, a dancer name with the real studio fused onto the
// front, and a RUNNER-UP recorded as a first-place win.
//
// The importer is insert-only, so re-running it with the fixed parser ADDS the
// correct rows (and the 184 winners that were never imported at all) but cannot
// remove the old ones. That is this script's job.
//
// SAFETY: a corrupted row is only deleted when its corrected replacement is
// already present -- same event, same category, and place equal to the old
// place plus " Runner Up". Nothing is removed on the strength of the phantom
// studio name alone.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/repair_spotlight_title_rows.js           # dry run
//   node scripts/repair_spotlight_title_rows.js --apply
//   (run AFTER: node scripts/import_spotlight_pdfs.js)
const { openDb } = require('../database');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  // Phantom studios are the placement tail, not a studio name.
  const phantoms = await db.all(`
    SELECT id, name FROM studios
    WHERE name IN ('Run Up', 'Runner-Up', 'Runner Up', 'RunUp')`);
  if (!phantoms.length) { console.log('No placement-fragment studios found — nothing to do.'); return; }
  const pIds = phantoms.map(p => p.id);

  const bad = await db.all(`
    SELECT a.id, a.event_id, a.category, a.place, e.name AS event
    FROM awards a JOIN events e ON e.id = a.event_id
    WHERE a.studio_id IN (${pIds.join(',')})`);

  const deletable = [], keep = [];
  for (const b of bad) {
    const fixed = await db.get(
      `SELECT id FROM awards WHERE event_id = ? AND category = ? AND place = ?`,
      [b.event_id, b.category, `${b.place} Runner Up`]);
    (fixed ? deletable : keep).push(b);
  }

  const fused = deletable.length ? await db.all(`
    SELECT DISTINCT d.id, d.name FROM award_dancers ad JOIN dancers d ON d.id = ad.dancer_id
    WHERE ad.award_id IN (${deletable.map(d => d.id).join(',')})`) : [];
  // only delete a profile that exists solely for these rows
  const orphans = [];
  for (const f of fused) {
    const other = await db.get(
      `SELECT COUNT(*) n FROM award_dancers WHERE dancer_id = ? AND award_id NOT IN (${deletable.map(d => d.id).join(',')})`,
      [f.id]);
    if (other.n === 0) orphans.push(f);
  }

  console.log('Spotlight corrupted title rows');
  console.log(`  placement-fragment studios: ${phantoms.map(p => `"${p.name}"`).join(', ')}`);
  console.log(`  corrupted awards:                       ${bad.length}`);
  console.log(`  ... with a corrected replacement (DELETE): ${deletable.length}`);
  console.log(`  ... WITHOUT one (kept, re-run the importer first): ${keep.length}`);
  console.log(`  fused dancer profiles to delete:        ${orphans.length} of ${fused.length}`);
  deletable.slice(0, 5).forEach(d => console.log(`    #${d.id} [${d.place}] ${d.event} / ${d.category}`));
  if (orphans.length) console.log(`  sample fused names: ${orphans.slice(0, 4).map(o => `"${o.name}"`).join(', ')}`);

  if (keep.length) {
    console.log(`\n  ⚠ ${keep.length} corrupted row(s) have no replacement — run`);
    console.log('    node scripts/import_spotlight_pdfs.js   first, then re-run this.');
  }
  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }
  if (!deletable.length) { console.log('\nNothing deletable.'); return; }

  await db.run('BEGIN IMMEDIATE');
  try {
    for (const d of deletable) {
      await db.run('DELETE FROM award_dancers WHERE award_id = ?', [d.id]);
      await db.run('DELETE FROM awards WHERE id = ?', [d.id]);
    }
    for (const o of orphans) {
      await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [o.id]);
      await db.run('UPDATE awards SET dancer_id = NULL WHERE dancer_id = ?', [o.id]);
      await db.run('DELETE FROM dancers WHERE id = ?', [o.id]);
    }
    // the phantom studios exist only for these rows
    for (const p of phantoms) {
      const left = await db.get('SELECT COUNT(*) n FROM awards WHERE studio_id = ?', [p.id]);
      if (left.n === 0) {
        await db.run('DELETE FROM dancer_studios WHERE studio_id = ?', [p.id]);
        await db.run('DELETE FROM studios WHERE id = ?', [p.id]);
      }
    }
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
  console.log(`\n✓ APPLIED: ${deletable.length} corrupted rows removed, ${orphans.length} fused dancer profiles deleted.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
