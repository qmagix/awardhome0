// Merge studios that are the SAME studio spelled differently -- case, spacing
// and punctuation variants: "4PM Dance" / "4pm Dance", "HappyFeet Dance
// Company" / "Happy Feet Dance Company", "5-6-7-8 Dance" / "5678 Dance".
//
// Why this matters beyond tidiness:
//  * 1,211 groups differ only by CASE and 1,683 only by case+spacing. Each one
//    is a studio whose awards, roster and claim state are split across two
//    public pages.
//  * It BLOCKS re-importing any org whose extractor has been corrected. The
//    StarQuest PDFs say "HappyFeet Dance Company" (verified in the source --
//    it is one word there) while the DB also holds "Happy Feet Dance Company"
//    from another import, so getOrCreateStudio mints a second studio and every
//    award under it duplicates. Soft-merging the variants makes the old
//    spelling resolve to the survivor instead
//    (import_starquest_txt.js follows merged_into_id).
//
// SOFT merge, matching utils/studioMerge.js: the loser keeps its row with
// status='merged' + merged_into_id, so its public URL redirects
// (routes/dance/public.js) and importers resolve through it. Awards record
// merged_from_studio_id as provenance.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/merge_studio_aliases.js [--tier=case|space|punct]   # dry run
//   node scripts/merge_studio_aliases.js --tier=space --apply
//
// Tiers, least to most aggressive. `case` is unambiguous; `space` additionally
// joins "HappyFeet"/"Happy Feet"; `punct` also ignores . , ' - & which merges
// "5-6-7-8 Dance" with "5678 Dance". Default is `case`: the safe one must be
// what you get by accident.
const { openDb } = require('../database');

const KEYS = {
  case: (n) => n.trim().toLowerCase().replace(/\s+/g, ' '),
  space: (n) => n.toLowerCase().replace(/\s+/g, ''),
  punct: (n) => n.toLowerCase().replace(/[\s.,'’\-&!]/g, ''),
};

// Prefer the best-SPELLED name when nothing else separates two rows: a name
// carrying both cases reads as intentional, ALL CAPS and all-lower are usually
// extraction artefacts.
const wellCased = (n) => (/[a-z]/.test(n) && /[A-Z]/.test(n) ? 1 : 0);

async function studioRefs(db) {
  const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name <> 'studios'`);
  const refs = [];
  for (const t of tables) {
    const cols = await db.all(`SELECT name FROM pragma_table_info(?)`, [t.name]);
    for (const c of cols) if (/studio_id$/.test(c.name)) refs.push({ table: t.name, col: c.name });
  }
  return refs;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tierArg = (process.argv.find(a => a.startsWith('--tier=')) || '').split('=')[1] || 'case';
  const keyOf = KEYS[tierArg];
  if (!keyOf) { console.error(`Unknown --tier=${tierArg}. Use case | space | punct.`); process.exit(1); }

  const db = await openDb();
  const refs = await studioRefs(db);

  const studios = await db.all(`
    SELECT s.id, s.name, s.owner_id, s.rejected_merges,
           (SELECT COUNT(*) FROM awards a WHERE a.studio_id = s.id) AS awards
    FROM studios s WHERE IFNULL(s.status,'') <> 'merged'`);

  const groups = new Map();
  for (const s of studios) {
    const k = keyOf(s.name || '');
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  const plans = [], conflicts = [];
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    const claimed = members.filter(m => m.owner_id);
    if (claimed.length > 1) { conflicts.push({ members, why: 'two or more CLAIMED studios' }); continue; }
    // survivor: the claimed one, else most awards, else best-cased, else lowest id
    const survivor = claimed[0] || members.slice().sort((a, b) =>
      (b.awards - a.awards) || (wellCased(b.name) - wellCased(a.name)) || (a.id - b.id))[0];
    const losers = members.filter(m => m.id !== survivor.id);
    // honour a human's earlier "these are NOT the same studio" decision
    const rejected = new Set(String(survivor.rejected_merges || '').split(',').filter(Boolean).map(Number));
    const keep = losers.filter(l => !rejected.has(l.id));
    if (!keep.length) continue;
    plans.push({ survivor, losers: keep });
  }

  const totalLosers = plans.reduce((n, p) => n + p.losers.length, 0);
  console.log(`Studio alias merge — tier "${tierArg}"`);
  console.log(`  live studios:            ${studios.length}`);
  console.log(`  variant groups:          ${plans.length}`);
  console.log(`  studios to merge away:   ${totalLosers}`);
  console.log(`  CONFLICTS (skipped):     ${conflicts.length}`);
  plans.slice(0, 8).forEach(p =>
    console.log(`    keep #${p.survivor.id} ${JSON.stringify(p.survivor.name)} (${p.survivor.awards} awards)  <-  ${p.losers.map(l => JSON.stringify(l.name) + ` (${l.awards})`).join(', ')}`));
  conflicts.slice(0, 5).forEach(c =>
    console.log(`    CONFLICT: ${c.members.map(m => `#${m.id} ${JSON.stringify(m.name)}`).join(' vs ')} — ${c.why}`));

  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }
  if (!plans.length) { console.log('\nNothing to merge.'); return; }

  await db.run('BEGIN IMMEDIATE');
  try {
    for (const p of plans) {
      for (const l of p.losers) {
        for (const r of refs) {
          if (r.table === 'awards' && r.col === 'studio_id') {
            await db.run(`UPDATE awards SET studio_id = ?, merged_from_studio_id = ? WHERE studio_id = ?`,
              [p.survivor.id, l.id, l.id]);
            continue;
          }
          // never DELETE from awards: merged_from_studio_id is provenance
          await db.run(`UPDATE OR IGNORE ${r.table} SET ${r.col} = ? WHERE ${r.col} = ?`, [p.survivor.id, l.id]);
          if (r.table !== 'awards') await db.run(`DELETE FROM ${r.table} WHERE ${r.col} = ?`, [l.id]);
        }
        await db.run(`UPDATE studios SET status = 'merged', merged_into_id = ? WHERE id = ?`, [p.survivor.id, l.id]);
      }
    }
    // Flatten chains: a row merged earlier may point at a studio that has now
    // merged too. Both readers of merged_into_id follow exactly ONE hop
    // (import_starquest_txt.js:40, routes/dance/public.js:969), so a chain
    // resolves to a dead studio.
    let flattened = 0;
    const chained = await db.all(`
      SELECT s.id, s.merged_into_id FROM studios s
      JOIN studios t ON t.id = s.merged_into_id
      WHERE s.status = 'merged' AND t.status = 'merged'`);
    for (const c of chained) {
      let target = c.merged_into_id, hops = 0;
      while (hops++ < 20) {
        const nxt = await db.get(`SELECT merged_into_id, status FROM studios WHERE id = ?`, [target]);
        if (!nxt || nxt.status !== 'merged' || !nxt.merged_into_id || nxt.merged_into_id === target) break;
        target = nxt.merged_into_id;
      }
      if (target !== c.merged_into_id) {
        await db.run('UPDATE studios SET merged_into_id = ? WHERE id = ?', [target, c.id]);
        flattened++;
      }
    }
    await db.run('COMMIT');
    if (flattened) console.log(`  flattened ${flattened} merge chain(s)`);
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
  console.log(`\n✓ APPLIED: ${totalLosers} studios merged into ${plans.length} survivors.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
