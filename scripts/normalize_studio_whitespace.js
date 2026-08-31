// Collapse whitespace damage in STUDIO names — the missing sibling of
// normalize_dancer_whitespace.js and normalize_performance_whitespace.js.
// Dancers and routine titles were normalised in an earlier pass; studios never
// were, so 1,169 studios still carry tab-separated names ("Pure\tMovement\t
// Dance") straight from the PDF extractors.
//
// Two reasons this matters beyond tidiness:
//
//  * 877 of them are DUPLICATES. A clean-named studio already exists, so the
//    same studio appears twice on the platform, splitting its awards and its
//    roster across two rows.
//  * It BLOCKS re-importing StarQuest. The hardened extractor now emits
//    "Pure Movement Dance", which would not match the tab-laden DB row, so the
//    importer would mint a second studio for every one of them and then insert
//    duplicate awards under it (the importer dedupes on studio_id).
//
// Merging is more consequential than renaming a dancer: studios carry claims,
// public unique_id URLs, rosters and 14 foreign-key references. So a merge
// only happens into an existing clean-named studio, and a CLAIMED studio is
// never dissolved — it is reported for a human instead.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/normalize_studio_whitespace.js           # dry run
//   node scripts/normalize_studio_whitespace.js --apply
const { openDb } = require('../database');

// Discover every column that points at a studio, rather than hand-listing
// them: a maintained list silently orphans rows the day someone adds a table.
// This also catches the non-obvious names -- studio_merge_requests uses
// target_studio_id and source_studio_id, not studio_id, which a hand-written
// list got wrong on the first attempt.
async function studioRefs(db) {
  const tables = await db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'studios'`);
  const refs = [];
  for (const t of tables) {
    const cols = await db.all(`SELECT name FROM pragma_table_info(?)`, [t.name]);
    for (const c of cols) {
      if (/studio_id$/.test(c.name)) refs.push({ table: t.name, col: c.name });
    }
  }
  return refs;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  const refs = await studioRefs(db);
  const rows = await db.all(`
    SELECT id, name, owner_id FROM studios
    WHERE name LIKE '%' || CHAR(9) || '%' OR name LIKE '%  %' OR name != TRIM(name)`);

  const merges = [], renames = [], blocked = [];
  for (const r of rows) {
    const clean = String(r.name).replace(/\s+/g, ' ').trim();
    if (!clean || clean === r.name) continue;
    const target = await db.get(
      'SELECT id, name, owner_id FROM studios WHERE name = ? AND id <> ? ORDER BY id LIMIT 1', [clean, r.id]);
    if (!target) { renames.push({ ...r, clean }); continue; }
    // Never dissolve a claimed studio: its owner, URL and history are real.
    if (r.owner_id) { blocked.push({ ...r, clean, target, why: 'damaged studio is CLAIMED' }); continue; }
    merges.push({ ...r, clean, target });
  }

  console.log(`Studio-referencing columns discovered: ${refs.length} (${refs.map(r => r.table + '.' + r.col).join(', ')})`);
  console.log(`Studios with whitespace-damaged names: ${rows.length}`);
  console.log(`  MERGE into the existing clean-named studio: ${merges.length}`);
  console.log(`  RENAME in place (no clean twin):            ${renames.length}`);
  console.log(`  BLOCKED (needs a human):                    ${blocked.length}`);
  merges.slice(0, 5).forEach(m => console.log(`    #${m.id} ${JSON.stringify(m.name)} -> merge into #${m.target.id} ${JSON.stringify(m.target.name)}`));
  renames.slice(0, 3).forEach(m => console.log(`    #${m.id} ${JSON.stringify(m.name)} -> rename ${JSON.stringify(m.clean)}`));
  blocked.forEach(b => console.log(`    KEPT #${b.id} ${JSON.stringify(b.name)} (${b.why})`));

  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }
  if (!merges.length && !renames.length) { console.log('\nNothing to do.'); return; }

  // Re-resolve each studio against the LIVE state instead of replaying the
  // precomputed plan: two damaged names can collapse to the same clean one
  // ("A\tB" and "A  B"), so the second would collide with the first's rename
  // (UNIQUE studios.name). Looking up inside the loop turns that second one
  // into a merge, which is what it always was.
  let mergedN = 0, renamedN = 0;
  await db.run('BEGIN IMMEDIATE');
  try {
    for (const m of merges.concat(renames)) {
      const live = await db.get('SELECT id, owner_id FROM studios WHERE id = ?', [m.id]);
      if (!live) continue;
      const target = await db.get(
        'SELECT id FROM studios WHERE name = ? AND id <> ? ORDER BY id LIMIT 1', [m.clean, m.id]);
      if (!target) {
        await db.run('UPDATE studios SET name = ? WHERE id = ?', [m.clean, m.id]);
        renamedN++;
        continue;
      }
      if (live.owner_id) continue;   // never dissolve a claimed studio
      mergedN++;
      m.target = target;
      for (const r of refs) {
        await db.run(`UPDATE OR IGNORE ${r.table} SET ${r.col} = ? WHERE ${r.col} = ?`, [m.target.id, m.id]);
        // The follow-up DELETE only exists to clear rows an OR IGNORE skipped
        // because the target already holds the equivalent link row. NEVER run
        // it against `awards`: awards.merged_from_studio_id is provenance, not
        // ownership, and deleting an award because its provenance points at a
        // merged studio would destroy real results. A stale provenance pointer
        // is harmless -- foreign keys are off by design in this schema.
        if (r.table === 'awards') continue;
        await db.run(`DELETE FROM ${r.table} WHERE ${r.col} = ?`, [m.id]);
      }
      await db.run('DELETE FROM studios WHERE id = ?', [m.id]);
    }
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
  console.log(`\n✓ APPLIED: ${mergedN} merged, ${renamedN} renamed, ${blocked.length} left for review.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
