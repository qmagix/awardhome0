// Dedup for the StarQuest import's tab-embedded studio names (~2,650 active
// studios with literal \t in the name, ids ~15556+). Many duplicate existing
// clean studios and split their award counts across variants.
//
// SAFETY MODEL — same-named studios are NOT assumed identical (e.g. a studio
// in Israel and one in the US can share a name). A merge requires positive
// dancer evidence:
//   - the StarQuest awards carry dancer names in notes "(Dancer: ...)"
//     (their dancer_id is always NULL), clean studios carry linked dancers;
//   - two same-normalized-name studios merge only if they share >= 2 distinct
//     dancer names, or 1 dancer name + 1 choreographer name
//     ("[Choreographer: ...]" notes).
// Claimed studios are never merge sources; a component with 2+ claimed
// members is skipped entirely.
//
// After merging, surviving tab studios get their name cleaned (tabs -> single
// space) when the cleaned name is free (case-insensitive); otherwise they are
// suspected-but-unproven duplicates: flagged needs_investigation=1 and listed.
//
// Idempotent. Dry-run by default; pass --apply to write.
//   node scripts/dedup_tab_studios.js [--apply] [--verbose]
const { openDb } = require('../database');

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const cleanSpaces = (s) => (s || '').replace(/\s+/g, ' ').trim();
const hasTab = (s) => s.includes('\t');

async function main() {
  const db = await openDb();

  const studios = await db.all(`
    SELECT s.id, s.name, s.is_claimed,
           (SELECT COUNT(*) FROM awards a WHERE a.studio_id = s.id) AS awards
    FROM studios s WHERE s.status = 'active'`);

  // Group by normalized name; only groups holding at least one tab member
  // are in scope (clean-vs-clean duplicates are a separate project).
  const groups = new Map();
  for (const s of studios) {
    const k = norm(s.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const inScope = [...groups.values()].filter(g => g.length > 1 && g.some(m => hasTab(m.name)));
  const cleanCleanDups = [...groups.values()].filter(g => g.length > 1 && !g.some(m => hasTab(m.name)));

  // Dancer/choreographer name sets per group member.
  async function nameSets(studioId) {
    const dancers = new Set(), choreos = new Set();
    const linked = await db.all(`
      SELECT d.name FROM dancers d WHERE d.id IN (
        SELECT dancer_id FROM awards WHERE studio_id = ? AND dancer_id IS NOT NULL
        UNION SELECT ad.dancer_id FROM award_dancers ad JOIN awards a ON a.id = ad.award_id WHERE a.studio_id = ?)`,
      [studioId, studioId]);
    for (const r of linked) {
      const k = normName(r.name);
      if (k.length >= 6) dancers.add(k);
    }
    const notes = await db.all(
      "SELECT notes FROM awards WHERE studio_id = ? AND notes IS NOT NULL AND notes != ''", [studioId]);
    for (const r of notes) {
      for (const m of r.notes.matchAll(/\(Dancers?:\s*([^)]+)\)/g)) {
        for (const part of m[1].split(',')) {
          const k = normName(part);
          if (k.length >= 6) dancers.add(k);
        }
      }
      for (const m of r.notes.matchAll(/\[Choreographers?:\s*([^\]]+)\]/g)) {
        for (const part of m[1].split(',')) {
          const k = normName(part);
          if (k.length >= 6) choreos.add(k);
        }
      }
    }
    return { dancers, choreos };
  }

  const intersect = (a, b) => { const out = []; for (const x of a) if (b.has(x)) out.push(x); return out; };

  const plan = { merge: [], rename: [], flag: [], skippedClaimed: [] };

  for (const group of inScope) {
    const sets = new Map();
    for (const m of group) sets.set(m.id, await nameSets(m.id));

    // Evidence edges + union-find
    const parent = new Map(group.map(m => [m.id, m.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { parent.set(find(a), find(b)); };
    const evidence = new Map(); // "a-b" -> shared names

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const A = group[i], B = group[j];
        if (!hasTab(A.name) && !hasTab(B.name)) continue; // clean-clean out of scope
        const sharedD = intersect(sets.get(A.id).dancers, sets.get(B.id).dancers);
        const sharedC = intersect(sets.get(A.id).choreos, sets.get(B.id).choreos);
        if (sharedD.length >= 2 || (sharedD.length === 1 && sharedC.length >= 1)) {
          union(A.id, B.id);
          evidence.set(`${A.id}-${B.id}`, { dancers: sharedD, choreos: sharedC });
        }
      }
    }

    // Components with >1 member -> merge tab members into the best target
    const comps = new Map();
    for (const m of group) {
      const root = find(m.id);
      if (!comps.has(root)) comps.set(root, []);
      comps.get(root).push(m);
    }
    for (const members of comps.values()) {
      if (members.length < 2) continue;
      const claimed = members.filter(m => m.is_claimed);
      if (claimed.length > 1) { plan.skippedClaimed.push(members); continue; }
      const target = claimed[0] ||
        [...members].sort((a, b) =>
          (hasTab(a.name) - hasTab(b.name)) || (b.awards - a.awards) || (a.id - b.id))[0];
      for (const m of members) {
        if (m.id === target.id) continue;
        if (!hasTab(m.name)) continue;       // only tab rows are merge sources
        if (m.is_claimed) continue;          // never auto-merge a claimed studio
        const ev = evidence.get(`${m.id}-${target.id}`) || evidence.get(`${target.id}-${m.id}`);
        plan.merge.push({ source: m, target, evidence: ev || { via: 'transitive within component' } });
      }
    }
  }

  // Rename pass: tab studios still active after the merges above.
  const mergedIds = new Set(plan.merge.map(r => r.source.id));
  const takenLower = new Map(); // lower(existing names) after planned merges/renames
  for (const s of studios) if (!mergedIds.has(s.id)) takenLower.set(s.name.toLowerCase(), s.id);
  for (const s of studios) {
    if (!hasTab(s.name) || mergedIds.has(s.id)) continue;
    const cleaned = cleanSpaces(s.name);
    const holder = takenLower.get(cleaned.toLowerCase());
    if (holder === undefined || holder === s.id) {
      plan.rename.push({ ...s, newName: cleaned });
      takenLower.delete(s.name.toLowerCase());
      takenLower.set(cleaned.toLowerCase(), s.id);
    } else {
      plan.flag.push({ ...s, cleaned, clashesWith: holder });
    }
  }

  // ---- Report ----
  const tabCount = studios.filter(s => hasTab(s.name)).length;
  console.log(`Active studios: ${studios.length}; with tabs: ${tabCount}; in-scope same-name groups: ${inScope.length}`);
  console.log(`(Out of scope: ${cleanCleanDups.length} same-normalized-name groups with no tab member — clean-vs-clean dup project.)\n`);

  console.log(`=== MERGE (dancer-evidence proven) — ${plan.merge.length} ===`);
  for (const r of plan.merge) {
    const ev = r.evidence.dancers
      ? `${r.evidence.dancers.length} shared dancer(s)${r.evidence.choreos.length ? `, ${r.evidence.choreos.length} shared choreo(s)` : ''}`
      : r.evidence.via;
    console.log(`  #${r.source.id} "${r.source.name.replace(/\t/g, '⇥')}" (${r.source.awards}) -> #${r.target.id} "${r.target.name.replace(/\t/g, '⇥')}" (${r.target.awards})  [${ev}]`);
    if (VERBOSE && r.evidence.dancers) console.log(`      dancers: ${r.evidence.dancers.join(', ')}`);
  }
  console.log(`\n=== RENAME (tabs -> spaces, name free) — ${plan.rename.length} ===`);
  if (VERBOSE) for (const r of plan.rename) console.log(`  #${r.id} "${r.name.replace(/\t/g, '⇥')}" -> "${r.newName}"`);
  else console.log('  (run with --verbose to list)');
  console.log(`\n=== FLAG needs_investigation (same name as #other, no dancer evidence — possibly a different studio) — ${plan.flag.length} ===`);
  for (const r of plan.flag) console.log(`  #${r.id} "${r.name.replace(/\t/g, '⇥')}" (${r.awards} awards) vs existing #${r.clashesWith}`);
  if (plan.skippedClaimed.length) console.log(`\n=== SKIPPED (2+ claimed studios in one evidence component) — ${plan.skippedClaimed.length} ===`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to execute.');
    return;
  }

  await db.run('BEGIN TRANSACTION');
  try {
    for (const r of plan.merge) {
      await db.run('UPDATE awards SET studio_id = ?, merged_from_studio_id = ? WHERE studio_id = ?', [r.target.id, r.source.id, r.source.id]);
      const links = await db.all('SELECT dancer_id FROM dancer_studios WHERE studio_id = ?', [r.source.id]);
      for (const link of links) {
        const exists = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [link.dancer_id, r.target.id]);
        if (!exists) await db.run('UPDATE dancer_studios SET studio_id = ? WHERE dancer_id = ? AND studio_id = ?', [r.target.id, link.dancer_id, r.source.id]);
        else await db.run('DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [link.dancer_id, r.source.id]);
      }
      await db.run("UPDATE studios SET status = 'merged', merged_into_id = ? WHERE id = ?", [r.target.id, r.source.id]);
    }
    for (const r of plan.rename) {
      await db.run('UPDATE studios SET name = ? WHERE id = ?', [r.newName, r.id]);
    }
    for (const r of plan.flag) {
      await db.run('UPDATE studios SET needs_investigation = 1 WHERE id = ?', [r.id]);
    }
    await db.run('COMMIT');
    console.log(`\nApplied: ${plan.merge.length} merged, ${plan.rename.length} renamed, ${plan.flag.length} flagged.`);
  } catch (e) {
    await db.run('ROLLBACK');
    console.error('\nROLLED BACK:', e.message);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
