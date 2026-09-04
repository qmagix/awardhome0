// Auto-merge duplicate dancer profiles on strong evidence (Q's rule,
// 2026-08-30): same cleaned name + same studio + at least one shared
// canonical routine (performance_name_key) in the same year.
//
// Single-pass design (Q, 2026-08-30): three full-table reads — rostered
// dancers, junction evidence, legacy evidence — grouped in memory; no
// per-group queries (function predicates like LOWER(TRIM(name)) = ? can't
// use indexes, so per-group querying degenerates into thousands of scans).
// Only the merge writes touch the DB.
//
// Safety rails:
// - components with MORE THAN ONE claimed profile are skipped (humans only);
// - a duplicate owning family content (claims, acknowledgements, photos) is
//   never deleted — it can only be the primary;
// - primary = claimed profile, else most awards, else oldest id.
//
// Idempotent. Weekly pipeline runs it after the routine-key sweep.
// Usage: node scripts/auto_merge_dancer_profiles.js [--apply]

const { openDb } = require('../database');
const { carrySuppressionOnMerge } = require('../utils/suppression');

async function mergeInto(db, primaryId, dupId) {
  await db.run(`INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status, source, created_at)
                SELECT award_id, ?, status, source, created_at FROM award_dancers WHERE dancer_id = ?`, [primaryId, dupId]);
  await db.run('DELETE FROM award_dancers WHERE dancer_id = ?', [dupId]);
  await db.run('UPDATE awards SET dancer_id = ? WHERE dancer_id = ?', [primaryId, dupId]);
  await db.run(`INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status, source)
                SELECT ?, studio_id, status, source FROM dancer_studios WHERE dancer_id = ?`, [primaryId, dupId]);
  await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [dupId]);
  await carrySuppressionOnMerge(db, dupId, primaryId);
  await db.run('DELETE FROM dancers WHERE id = ?', [dupId]);
}

async function loadIdSet(db, sql) {
  const set = new Set();
  try { for (const r of await db.all(sql)) set.add(r.dancer_id); } catch (e) {}
  return set;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();
  const t0 = process.hrtime.bigint();

  // Pass 1: rostered dancers -> groups keyed (studio_id, clean name)
  const roster = await db.all(`
    SELECT ds.studio_id, d.id, d.claimed_by_user_id, LOWER(TRIM(d.name)) AS cname
    FROM dancer_studios ds JOIN dancers d ON d.id = ds.dancer_id`);
  const groups = new Map(); // studio|cname -> [{id, claimed}]
  for (const r of roster) {
    if (!r.cname) continue;
    const key = r.studio_id + '|' + r.cname;
    (groups.get(key) || groups.set(key, []).get(key)).push(r);
  }
  for (const [k, v] of groups) if (new Set(v.map(m => m.id)).size < 2) groups.delete(k);

  // Pass 2+3: routine-year evidence per (dancer, studio); award counts ride along
  const evidence = new Map(); // dancerId|studioId -> Set('routineKey|year')
  const awardCount = new Map(); // dancerId -> n
  const addEv = (did, sid, ev) => {
    const key = did + '|' + sid;
    (evidence.get(key) || evidence.set(key, new Set()).get(key)).add(ev);
    awardCount.set(did, (awardCount.get(did) || 0) + 1);
  };
  const evJunction = await db.all(`
    SELECT ad.dancer_id AS did, aw.studio_id AS sid,
           aw.performance_name_key || '|' || IFNULL(e.year, 'U') AS ev
    FROM award_dancers ad JOIN awards aw ON aw.id = ad.award_id
    LEFT JOIN events e ON e.id = aw.event_id
    WHERE aw.performance_name_key IS NOT NULL AND aw.studio_id IS NOT NULL`);
  for (const r of evJunction) addEv(r.did, r.sid, r.ev);
  const evLegacy = await db.all(`
    SELECT aw.dancer_id AS did, aw.studio_id AS sid,
           aw.performance_name_key || '|' || IFNULL(e.year, 'U') AS ev
    FROM awards aw LEFT JOIN events e ON e.id = aw.event_id
    WHERE aw.dancer_id IS NOT NULL AND aw.performance_name_key IS NOT NULL AND aw.studio_id IS NOT NULL`);
  for (const r of evLegacy) addEv(r.did, r.sid, r.ev);

  // Guard sets: profiles owning family content are never deleted
  const protectedIds = new Set();
  for (const sql of [
    'SELECT DISTINCT dancer_id FROM dancer_claims',
    'SELECT DISTINCT dancer_id FROM award_acknowledgements',
    'SELECT DISTINCT dancer_id FROM award_card_photos',
  ]) for (const id of await loadIdSet(db, sql)) protectedIds.add(id);

  let merged = 0, components = 0, skippedClaimed = 0, skippedProtected = 0;
  for (const [key, membersRaw] of groups) {
    const studioId = parseInt(key.split('|')[0], 10);
    const members = [...new Map(membersRaw.map(m => [m.id, m])).values()];
    const ids = members.map(m => m.id);

    // Union-find on shared routine-year evidence at this studio
    const parent = new Map(ids.map(id => [id, id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (let i = 0; i < ids.length; i++) {
      const a = evidence.get(ids[i] + '|' + studioId);
      if (!a) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const b = evidence.get(ids[j] + '|' + studioId);
        if (!b) continue;
        for (const ev of a) if (b.has(ev)) { parent.set(find(ids[i]), find(ids[j])); break; }
      }
    }
    const comps = new Map();
    for (const id of ids) { const r = find(id); (comps.get(r) || comps.set(r, []).get(r)).push(id); }

    for (const comp of comps.values()) {
      if (comp.length < 2) continue;
      const claimed = comp.filter(id => members.find(m => m.id === id).claimed_by_user_id);
      if (claimed.length > 1) { skippedClaimed++; continue; }
      let primary = claimed[0];
      if (!primary) {
        primary = comp.slice().sort((x, y) =>
          (awardCount.get(y) || 0) - (awardCount.get(x) || 0) || x - y)[0];
      }
      let mergedHere = 0;
      for (const dupId of comp) {
        if (dupId === primary) continue;
        if (protectedIds.has(dupId)) { skippedProtected++; continue; }
        if (apply) await mergeInto(db, primary, dupId);
        mergedHere++;
      }
      if (mergedHere) { components++; merged += mergedHere; }
    }
  }

  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  console.log(`Same-name groups on a shared roster: ${groups.size}`);
  console.log(`${apply ? 'Merged' : 'Would merge'} ${merged} duplicate profiles across ${components} dancers (${ms}ms).`);
  console.log(`Skipped: ${skippedClaimed} components with multiple claimed profiles, ${skippedProtected} protected dups.`);
  if (!apply) console.log('\nDry run — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
