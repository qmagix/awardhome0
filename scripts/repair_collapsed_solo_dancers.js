// Repair solo/title awards that carry MORE THAN ONE dancer.
//
// THE BUG (found 2026-08-30): import_dancebug_awards.js deduped its Choice
// awards on (event, category, routine, place) -- omitting studio_id and
// performance_number. Two different studios routinely enter same-titled
// routines at one event, so the second collapsed into the first. Traced fully
// from source at Believe Louisville 2022:
//
//   entry 259  "Burlesque"  Aubrey Sears   Dance Designs Dance Complex
//   entry 330  "Burlesque"  Laney Wheeler  All About Dance Studio
//
// Both dancers ended up on Dance Designs' award, while All About Dance's own
// "Burlesque" placement (7th) was left with NO dancer at all. backfill_utils.js
// then propagated the bad pair onto every award sharing that routine+studio.
// Both are fixed at the source; this repairs the history.
//
// THE REPAIR KEY is the dancer's own studio: a dancer performs for the studio
// that entered the routine, so of the linked dancers, the one whose
// dancer_studios includes the award's studio is the true performer. Applied
// ONLY when exactly one dancer matches -- where several linked dancers share
// the award's studio the source genuinely cannot be resolved this way, so
// those are reported for review and left untouched.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/repair_collapsed_solo_dancers.js           # dry run
//   node scripts/repair_collapsed_solo_dancers.js --apply
const { openDb } = require('../database');
const { individualAwardSql } = require('../utils/soloPrimary');

// Individual awards left with NO dancer, whose routine appears elsewhere in the
// same event under a DIFFERENT studio, linked to a dancer who belongs to THIS
// award's studio. That is the collapse signature exactly: the dancer was parked
// on the other studio's award, leaving her own placement empty.
//
// The `a2.studio_id <> e.studio_id` condition is load-bearing. Without it the
// rule matches any empty individual award whose routine appears anywhere in the
// event (1,128 of them) and starts ASSERTING links from thin evidence — the
// same over-reach that produced this bug. Restricted to the cross-studio case
// it only undoes the collapse.
async function reattachOrphans(db, IND, apply) {
  const empties = await db.all(`
    SELECT a.id, a.event_id, a.studio_id, a.performance_name
    FROM awards a
    WHERE ${IND}
      AND a.studio_id IS NOT NULL
      AND IFNULL(a.performance_name,'') <> ''
      AND NOT EXISTS (SELECT 1 FROM award_dancers ad WHERE ad.award_id = a.id)`);

  let n = 0;
  for (const e of empties) {
    const cands = await db.all(`
      SELECT DISTINCT d.id, d.name
      FROM awards a2
      JOIN award_dancers ad ON ad.award_id = a2.id
      JOIN dancers d ON d.id = ad.dancer_id
      JOIN dancer_studios ds ON ds.dancer_id = d.id AND ds.studio_id = ?
      WHERE a2.event_id = ? AND LOWER(a2.performance_name) = LOWER(?) AND a2.id <> ?
        AND IFNULL(a2.studio_id, -1) <> ?`,
      [e.studio_id, e.event_id, e.performance_name, e.id, e.studio_id]);
    if (cands.length !== 1) continue;
    const denied = await db.get(
      'SELECT 1 AS x FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [e.id, cands[0].id]);
    if (denied) continue;
    if (apply) {
      await db.run(
        `INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, 'backfill')`,
        [e.id, cands[0].id]);
    }
    n++;
  }
  return n;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();
  const IND = individualAwardSql('a');

  const rows = await db.all(`
    SELECT a.id, a.studio_id, a.category, a.award_type, a.performance_name, o.name AS org
    FROM awards a
    JOIN events e ON e.id = a.event_id
    JOIN organizations o ON o.id = e.org_id
    WHERE ${IND}
      AND (SELECT COUNT(*) FROM award_dancers ad WHERE ad.award_id = a.id) > 1
    ORDER BY o.name, a.id`);

  if (!rows.length) { console.log('No multi-dancer solo/title awards found — nothing to do.'); return; }

  const fixes = [], ambiguous = [], orphaned = [];
  for (const r of rows) {
    const linked = await db.all(`
      SELECT d.id, d.name FROM award_dancers ad JOIN dancers d ON d.id = ad.dancer_id
      WHERE ad.award_id = ?`, [r.id]);
    const keep = [];
    for (const d of linked) {
      const m = await db.get(
        'SELECT 1 AS x FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [d.id, r.studio_id]);
      if (m) keep.push(d);
    }
    if (keep.length === 1) fixes.push({ ...r, keep: keep[0], drop: linked.filter(d => d.id !== keep[0].id) });
    else if (keep.length === 0) orphaned.push({ ...r, linked });
    else ambiguous.push({ ...r, keep });
  }

  console.log(`Multi-dancer solo/title awards: ${rows.length}`);
  console.log(`  RESOLVABLE (exactly one linked dancer is on the award's studio): ${fixes.length}`);
  console.log(`  ambiguous  (several linked dancers share that studio):           ${ambiguous.length}`);
  console.log(`  orphaned   (no linked dancer is on that studio):                 ${orphaned.length}`);

  const byOrg = new Map();
  fixes.forEach(f => byOrg.set(f.org, (byOrg.get(f.org) || 0) + 1));
  if (byOrg.size) {
    console.log('\n  fixes by organization:');
    [...byOrg.entries()].sort((a, b) => b[1] - a[1]).forEach(([o, n]) => console.log(`    ${String(n).padStart(4)}  ${o}`));
  }
  console.log('\n  sample fixes:');
  fixes.slice(0, 6).forEach(f =>
    console.log(`    #${f.id} "${f.performance_name}" [${f.category || f.award_type}] keep ${f.keep.name}; drop ${f.drop.map(d => d.name).join(', ')}`));
  if (ambiguous.length) {
    console.log('\n  AMBIGUOUS — left alone, need review:');
    ambiguous.slice(0, 10).forEach(a =>
      console.log(`    #${a.id} "${a.performance_name}" [${a.org}] -> ${a.keep.map(d => d.name).join(' | ')}`));
    if (ambiguous.length > 10) console.log(`    ... ${ambiguous.length - 10} more`);
  }
  if (orphaned.length) {
    console.log('\n  ORPHANED — left alone (no linked dancer belongs to the award\'s studio):');
    orphaned.slice(0, 5).forEach(a =>
      console.log(`    #${a.id} "${a.performance_name}" [${a.org}] -> ${a.linked.map(d => d.name).join(' | ')}`));
  }

  const wouldReattach = await reattachOrphans(db, IND, false);
  console.log(`\n  empty placements that would be REATTACHED to their studio's dancer: ${wouldReattach}`);

  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }

  // Phase 1 having nothing left to do must NOT skip phase 2: the two are
  // independent halves of the same repair, and on a re-run phase 1 is empty
  // by definition while phase 2 may still have counterparts to reattach.
  if (fixes.length) {
    await db.run('BEGIN IMMEDIATE');
    try {
      for (const f of fixes) {
        for (const d of f.drop) {
          await db.run('DELETE FROM award_dancers WHERE award_id = ? AND dancer_id = ?', [f.id, d.id]);
        }
      }
      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  }
  console.log(`\n✓ APPLIED: ${fixes.length} awards reduced to their true single dancer.`);

  // PHASE 2 -- reattach. Removing the wrong link only does half the job: the
  // dancer who was mis-attached usually has her OWN placement sitting empty.
  // Believe Louisville: dropping Laney Wheeler from Dance Designs' "Burlesque"
  // leaves All About Dance's "Burlesque" (7th) -- HER result -- with no dancer.
  // Same key as the repair: same event, same routine title, and the dancer
  // belongs to that award's studio. Only acts when exactly one dancer
  // qualifies, and never resurrects a director-denied link.
  const reattached = await reattachOrphans(db, IND, true);
  console.log(`✓ REATTACHED: ${reattached} empty placements given the dancer whose studio entered them.`);
  console.log('  Run scripts/backfill_solo_primary_dancer.js next to seat them as Primary Dancer.');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
