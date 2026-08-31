// Repair the damage from the Showstopper apostrophe bug (fixed 2026-08-30 in
// scripts/extract_showstopper_pdfs.js).
//
// THE BUG: a typographic apostrophe inside a studio name ("Chassé's Dance
// Company") decodes as control char U+0019, and pdf2json emits it as its own
// text object. That phantom column shifted every column after it, so the
// extractor wrote:
//
//   Routine: Glimpse of Us | Dancer: s Dance Company - Theodore, Al, 112.45,
//   Alana McCarroll | Studio: Chassé
//
// instead of  Dancer: Alana McCarroll | Studio: Chassé's Dance Company.
//
// Consequences in the DB:
//   * 5 PHANTOM STUDIOS -- the truncated prefixes America / Bianca / Chassé /
//     Dan / GG -- holding 65 awards between them (and nothing else: every
//     award under them is corrupt, and none are claimed);
//   * FAKE DANCER PROFILES minted from the studio-name tail, the state code
//     and the SCORE ("s Dance Company - Theodore", "Al", "112.45"), some with
//     public unique_id URLs;
//   * those fakes then propagated onto further awards by backfill_utils.js.
//
// THE REPAIR is driven by the corruption's own signature, so it needs no
// event mapping: phantom studio name + "'" + the tail fragment reconstructs
// the true studio ("Chassé" + "'" + "s Dance Company - Theodore" ->
// "Chassé's Dance Company - Theodore"), which the extractor then truncates at
// " - " exactly as it does for every healthy row.
//
// SCOPING, deliberately narrow: a fake profile is only one that appears on an
// award which also carries a tail fragment. A 2-letter name is NOT junk on its
// own -- "Wu" is a real dancer elsewhere -- and the importer keys dancers by
// name+studio, so the bogus "Al" under a phantom studio is a different row
// from any real "Al".
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/repair_showstopper_apostrophe.js           # dry run
//   node scripts/repair_showstopper_apostrophe.js --apply
const { openDb } = require('../database');
const { generateStudioId } = require('../utils');

const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);

const isTail = (n) => /^s\s+\S/.test(n);
const isState = (n) => US_STATES.has(String(n).trim().toUpperCase()) && String(n).trim().length === 2;
const isScore = (n) => /^\d{1,3}(\.\d{1,2})?$/.test(String(n).trim());
const isJunk = (n) => isTail(n) || isState(n) || isScore(n);

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  // 1. The corrupted awards: those carrying a tail fragment.
  const tailAwards = await db.all(`
    SELECT DISTINCT ad.award_id AS id FROM award_dancers ad
    JOIN dancers d ON d.id = ad.dancer_id WHERE d.name LIKE 's %'`);
  // No early return when the tail set is empty: the numeric sweep below is an
  // independent phase and must still run (on a re-run the tail set is empty by
  // definition, while score artifacts on non-tail awards may remain).
  const tailIds = tailAwards.map(r => r.id);

  // 2. Fake profiles = junk-shaped names appearing on those awards.
  const candidates = await db.all(`
    SELECT DISTINCT d.id, d.name, d.unique_id FROM award_dancers ad
    JOIN dancers d ON d.id = ad.dancer_id
    WHERE ad.award_id IN (${tailIds.join(',') || '-1'})`);
  const fakes = candidates.filter(d => isJunk(d.name));
  const real = candidates.filter(d => !isJunk(d.name));

  // 3. Phantom studios and their true names, reconstructed from the tail.
  const phantoms = await db.all(`
    SELECT DISTINCT s.id, s.name AS phantom, d.name AS tail
    FROM award_dancers ad
    JOIN dancers d ON d.id = ad.dancer_id
    JOIN awards a ON a.id = ad.award_id
    JOIN studios s ON s.id = a.studio_id
    WHERE d.name LIKE 's %'`);
  for (const p of phantoms) {
    p.trueName = `${p.phantom}'${p.tail}`.split(' - ')[0].trim();
    const existing = await db.get('SELECT id, name FROM studios WHERE name = ?', [p.trueName]);
    p.targetId = existing ? existing.id : null;
    p.awards = (await db.get('SELECT COUNT(*) n FROM awards WHERE studio_id = ?', [p.id])).n;
    p.roster = (await db.get('SELECT COUNT(*) n FROM dancer_studios WHERE studio_id = ?', [p.id])).n;
    p.owned = (await db.get('SELECT owner_id FROM studios WHERE id = ?', [p.id])).owner_id;
  }

  const junkLinks = await db.get(`
    SELECT COUNT(*) n FROM award_dancers WHERE dancer_id IN (${fakes.map(f => f.id).join(',') || '-1'})`);

  // Score fragments also reached awards that carry no tail (the column shift
  // has more than one trigger). A PURELY NUMERIC name is never a person, so
  // these are safe to sweep wherever they appear -- unlike a 2-letter name,
  // which can be real ("Wu") and is therefore only treated as junk when it
  // sits on a tail award above.
  const numeric = await db.all(`
    SELECT d.id, d.name, (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS links
    FROM dancers d
    WHERE d.name GLOB '*[0-9]' AND d.name NOT GLOB '*[A-Za-z]*'
      AND d.id NOT IN (${fakes.map(f => f.id).join(',') || '-1'})`);

  console.log(`Showstopper apostrophe artifacts`);
  console.log(`  corrupted awards (carry a tail fragment): ${tailIds.length}`);
  console.log(`  fake dancer profiles to delete:           ${fakes.length} (${fakes.filter(f => f.unique_id).length} with public URLs)`);
  console.log(`  their award links to delete:              ${junkLinks.n}`);
  console.log(`  real dancers preserved on those awards:   ${real.length}`);
  console.log(`\n  phantom studios -> true name:`);
  for (const p of phantoms) {
    const fate = p.targetId ? `MERGE into existing #${p.targetId}` : 'RENAME in place';
    console.log(`    #${p.id} "${p.phantom}" -> "${p.trueName}"  [${fate}; ${p.awards} awards, ${p.roster} roster rows${p.owned ? ', CLAIMED!' : ''}]`);
  }
  console.log(`\n  sample fakes: ${fakes.slice(0, 8).map(f => `"${f.name}"`).join(', ')}`);
  console.log(`  numeric-named profiles to sweep (score artifacts): ${numeric.length}` +
    (numeric.length ? ` -> ${numeric.map(x => `"${x.name}"`).join(', ')}` : ''));

  const claimed = phantoms.filter(p => p.owned);
  if (claimed.length) {
    console.error(`\n✗ REFUSING: ${claimed.length} phantom studio(s) are CLAIMED by an owner — resolve by hand.`);
    process.exitCode = 1;
    return;
  }

  if (!fakes.length && !numeric.length && !phantoms.length) {
    console.log('\nNothing to repair.'); return;
  }
  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }

  await db.run('BEGIN IMMEDIATE');
  try {
    for (const p of phantoms) {
      let target = p.targetId;
      if (!target) {
        await db.run('UPDATE studios SET name = ? WHERE id = ?', [p.trueName, p.id]);
        target = p.id;
      } else {
        // repoint everything, then drop the now-empty phantom
        await db.run('UPDATE awards SET studio_id = ? WHERE studio_id = ?', [target, p.id]);
        await db.run('UPDATE OR IGNORE dancer_studios SET studio_id = ? WHERE studio_id = ?', [target, p.id]);
        await db.run('DELETE FROM dancer_studios WHERE studio_id = ?', [p.id]);
        await db.run('DELETE FROM studios WHERE id = ?', [p.id]);
      }
    }
    for (const f of fakes.concat(numeric)) {
      await db.run('DELETE FROM award_dancers WHERE dancer_id = ?', [f.id]);
      await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [f.id]);
      await db.run('UPDATE awards SET dancer_id = NULL WHERE dancer_id = ?', [f.id]);
      await db.run('DELETE FROM dancers WHERE id = ?', [f.id]);
    }
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
  console.log(`\n✓ APPLIED: ${fakes.length + numeric.length} fake dancers removed (${numeric.length} numeric), ${phantoms.length} studios corrected.`);
  console.log('  Re-run scripts/backfill_solo_primary_dancer.js afterwards to seat the real solo dancers.');
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error(err); process.exit(1); });
