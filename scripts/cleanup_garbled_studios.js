// Cleanup for garbled scraped studio names (TODOS_and_DONE.md item):
//  (a) award-category headers scraped as studios -> deactivate (awards kept,
//      reported; they are dancer-less "High Score/GUYS" scrape noise)
//  (b) whole result lines scraped as studio names ("– routine – studio –
//      dancer", en-dash separated, with embedded tabs / OCR mid-word spaces)
//      -> find the embedded studio segment, match it letters-only against
//      real studios and merge (same SQL as the admin merge path), or rename
//      the record to the cleaned segment when no studio exists yet
//  (c) legit odd names ("(on)Stage Workshop", "École…", "“Floria…") -> untouched
//      (the script only selects names starting with "–" or "’")
// Anything ambiguous is flagged needs_investigation=1 and listed for manual
// review — nothing destructive happens to it.
//
// Idempotent. Dry-run by default; pass --apply to write.
//   node scripts/cleanup_garbled_studios.js          # preview
//   node scripts/cleanup_garbled_studios.js --apply  # execute
const { openDb } = require('../database');

const APPLY = process.argv.includes('--apply');

// Class (a): scraped award-category headers, ids stable across local/prod
// (same seed). Matched by id AND exact name so a diverged DB can't misfire.
const HEADER_STUDIOS = [
  { id: 12620, name: '- OUTSTANDING DANCERS' },
  { id: 12623, name: '- RUNNERS-UP' },
  { id: 10306, name: 'OUTSTANDING CONTEMPORARY SCHOOL' },
];

const STUDIO_KEYWORDS = /\b(danc\w*|studio|academy|arts|company|co|centre|center|performing|productions?|project|complex|conservatory|ballet|collective|workshop|theatre|theater|school|team|alliance|connection)\b/i;

// Letters-and-digits-only lowercase: immune to tabs, OCR mid-word spaces,
// curly vs straight apostrophes, and case.
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Human-readable cleanup: tabs/runs of whitespace -> single space.
const cleanSpaces = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function main() {
  const db = await openDb();

  const plan = { deactivate: [], merge: [], rename: [], review: [] };

  // ---- Class (a): header rows ----
  for (const h of HEADER_STUDIOS) {
    const row = await db.get(
      "SELECT id, name, status FROM studios WHERE id = ? AND name = ?", [h.id, h.name]);
    if (!row) { console.log(`note: header studio ${h.id} "${h.name}" not found (already handled?)`); continue; }
    if (row.status !== 'active') { console.log(`note: header studio ${h.id} already ${row.status}`); continue; }
    const awards = await db.get('SELECT COUNT(*) n, SUM(dancer_id IS NOT NULL) with_dancer FROM awards WHERE studio_id = ?', [h.id]);
    plan.deactivate.push({ ...row, awards: awards.n, awardsWithDancer: awards.with_dancer || 0 });
  }

  // ---- Class (b): en-dash result lines + leading-apostrophe fragments ----
  const garbled = await db.all(
    "SELECT id, name FROM studios WHERE status = 'active' AND (name LIKE '–%' OR name LIKE '’%')");
  const garbledIds = new Set(garbled.map(g => g.id));

  // Index of real active studios by normalized name (may be non-unique: the
  // same import that produced the garbled rows also created tab-embedded
  // duplicates of clean studios, and same-named studios exist in different
  // cities). Award counts feed the person-record guard below.
  const real = await db.all(`
    SELECT s.id, s.name, (SELECT COUNT(*) FROM awards a WHERE a.studio_id = s.id) AS awards
    FROM studios s WHERE s.status = 'active'`);
  const byNorm = new Map();
  for (const s of real) {
    if (garbledIds.has(s.id)) continue;
    const k = norm(s.name);
    if (!k) continue;
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(s);
  }

  // Multiple same-named candidates: prefer the studio that already has awards
  // at the same event as this garbled row's award (its import-batch siblings),
  // then the same org. If several same-org variants remain (the import created
  // multiple tab/OCR spellings of one studio), take the clearly dominant one
  // by award count — the variants are due to be merged together eventually,
  // so the stray award belongs with the biggest sibling. Returns the single
  // survivor or null.
  async function disambiguate(candidates, eventId, orgId) {
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0 || !eventId) return null;
    let pool = candidates;
    const ph = pool.map(() => '?').join(',');
    const sameEvent = await db.all(
      `SELECT DISTINCT studio_id FROM awards WHERE event_id = ? AND studio_id IN (${ph})`, [eventId, ...pool.map(c => c.id)]);
    if (sameEvent.length === 1) return pool.find(c => c.id === sameEvent[0].studio_id);
    if (sameEvent.length > 1) {
      pool = pool.filter(c => sameEvent.some(r => r.studio_id === c.id));
    } else if (orgId) {
      const ph2 = pool.map(() => '?').join(',');
      const sameOrg = await db.all(`
        SELECT DISTINCT a.studio_id FROM awards a JOIN events e ON e.id = a.event_id
        WHERE e.org_id = ? AND a.studio_id IN (${ph2})`, [orgId, ...pool.map(c => c.id)]);
      if (sameOrg.length === 0) return null; // no import-batch sibling — refuse to guess
      if (sameOrg.length === 1) return pool.find(c => c.id === sameOrg[0].studio_id);
      pool = pool.filter(c => sameOrg.some(r => r.studio_id === c.id));
    } else {
      return null;
    }
    const ranked = [...pool].sort((a, b) => b.awards - a.awards);
    if (ranked[0].awards >= 5 && ranked[0].awards >= 3 * (ranked[1].awards || 1)) return ranked[0];
    return null;
  }

  // In-batch rename dedupe: first garbled row claiming a cleaned name becomes
  // the rename target; later rows with the same norm merge into it.
  const pendingRenames = new Map(); // norm -> garbled row already renaming to it

  for (const g of garbled) {
    const source = await db.get(
      'SELECT COUNT(*) n FROM awards WHERE studio_id = ?', [g.id]);
    const evidence = await db.get(`
      SELECT a.event_id, e.org_id, e.name AS event_name, e.url AS event_url FROM awards a
      LEFT JOIN events e ON e.id = a.event_id WHERE a.studio_id = ? LIMIT 1`, [g.id]);
    const eventId = evidence && evidence.event_id;
    const orgId = evidence && evidence.org_id;
    const meta = { awards: source.n, event: evidence && evidence.event_name, url: evidence && evidence.event_url };

    const segments = g.name.split('–').map(cleanSpaces).filter(Boolean);

    // 1) Segment letters-only-equals a real studio. The same bad import also
    //    created teachers/dancers as studio rows, so when the line contains a
    //    studio-like segment ("… Dance Academy"), only studio-like segments
    //    may decide the merge — a person segment matching a person-record
    //    must never outvote the actual studio. Lines with no studio-like
    //    segment at all (e.g. "– PACE – …") fall back to any segment, but
    //    only toward targets with a real award history (person-records have
    //    1–2 awards).
    const studioLikeSegs = segments.filter(s => STUDIO_KEYWORDS.test(s));
    const decidingSegs = studioLikeSegs.length > 0 ? studioLikeSegs : segments;
    let resolved = null, resolvedSeg = null, sawHits = false, hitNotes = [];
    for (const seg of decidingSegs) {
      let hits = byNorm.get(norm(seg)) || [];
      if (studioLikeSegs.length === 0) hits = hits.filter(h => h.awards >= 5);
      if (hits.length === 0) continue;
      sawHits = true;
      const winner = await disambiguate(hits, eventId, orgId);
      if (!winner) { hitNotes.push(`${seg}: ${hits.length} candidates, no same-event/org tiebreak`); continue; }
      if (resolved && resolved.id !== winner.id) { resolved = 'CONFLICT'; break; }
      resolved = winner; resolvedSeg = seg;
    }
    if (resolved && resolved !== 'CONFLICT') {
      plan.merge.push({ ...g, ...meta, segment: resolvedSeg, target: resolved });
      continue;
    }
    if (resolved === 'CONFLICT' || sawHits) {
      plan.review.push({ ...g, ...meta, reason: resolved === 'CONFLICT'
        ? 'segments resolve to different studios'
        : 'match(es) found but ambiguous — ' + hitNotes.join('; ') });
      continue;
    }

    // 2) Suffix fallback for fragments like "’ s Dance Craze": a real studio
    //    whose normalized name ends with the segment (len >= 8), same
    //    same-event/org disambiguation.
    let suffixResolved = null, suffixSeg = null, suffixSaw = false;
    for (const seg of segments) {
      const k = norm(seg);
      if (k.length < 8) continue;
      const ends = [];
      for (const [rk, list] of byNorm) if (rk.endsWith(k)) ends.push(...list);
      if (ends.length === 0) continue;
      suffixSaw = true;
      const winner = await disambiguate(ends, eventId, orgId);
      if (winner) { suffixResolved = winner; suffixSeg = seg; break; }
    }
    if (suffixResolved) {
      plan.merge.push({ ...g, ...meta, segment: suffixSeg + ' (suffix match)', target: suffixResolved });
      continue;
    }
    if (suffixSaw) {
      plan.review.push({ ...g, ...meta, reason: 'fragment suffix matches multiple studios, no same-event/org tiebreak' });
      continue;
    }

    // 3) No existing studio: if exactly one segment looks like a studio name,
    //    rename this record to the cleaned segment.
    const studioLike = segments.filter(s => STUDIO_KEYWORDS.test(s));
    if (studioLike.length === 1) {
      const newName = cleanSpaces(studioLike[0]);
      const k = norm(newName);
      const prior = pendingRenames.get(k);
      if (prior) {
        plan.merge.push({ ...g, ...meta, segment: newName + ' (dup of in-batch rename)', target: prior });
      } else {
        pendingRenames.set(k, g);
        plan.rename.push({ ...g, ...meta, newName });
      }
      continue;
    }

    plan.review.push({ ...g, ...meta, reason: studioLike.length === 0
      ? 'no studio-like segment'
      : 'multiple studio-like segments: ' + studioLike.join('; ') });
  }

  // ---- Report ----
  const show = (r) => `#${r.id} "${r.name.replace(/\t/g, '⇥')}" (${r.awards} award${r.awards === 1 ? '' : 's'}${r.event ? ', ' + r.event : ''})`;
  console.log(`\n=== DEACTIVATE (scraped category headers) — ${plan.deactivate.length} ===`);
  for (const r of plan.deactivate) console.log(`  ${show(r)}${r.awardsWithDancer ? ` WARNING: ${r.awardsWithDancer} award(s) have dancers` : ' — awards are dancer-less scrape noise, kept for traceability'}`);
  console.log(`\n=== MERGE into existing studio — ${plan.merge.length} ===`);
  for (const r of plan.merge) console.log(`  ${show(r)}\n    -> #${r.target.id} "${r.target.name}"  [via "${r.segment}"]`);
  console.log(`\n=== RENAME to cleaned studio segment — ${plan.rename.length} ===`);
  for (const r of plan.rename) console.log(`  ${show(r)}\n    -> "${r.newName}"`);
  console.log(`\n=== NEEDS MANUAL REVIEW — ${plan.review.length} ===`);
  for (const r of plan.review) console.log(`  ${show(r)}\n    reason: ${r.reason}${r.url ? '\n    source: ' + r.url : ''}`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to execute.');
    return;
  }

  // ---- Apply ----
  await db.run('BEGIN TRANSACTION');
  try {
    for (const r of plan.deactivate) {
      await db.run("UPDATE studios SET status = 'inactive' WHERE id = ?", [r.id]);
    }
    for (const r of plan.merge) {
      // Same steps as the admin merge path (routes/admin.js /api/merge/studios)
      await db.run('UPDATE awards SET studio_id = ?, merged_from_studio_id = ? WHERE studio_id = ?', [r.target.id, r.id, r.id]);
      const links = await db.all('SELECT dancer_id FROM dancer_studios WHERE studio_id = ?', [r.id]);
      for (const link of links) {
        const exists = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [link.dancer_id, r.target.id]);
        if (!exists) await db.run('UPDATE dancer_studios SET studio_id = ? WHERE dancer_id = ? AND studio_id = ?', [r.target.id, link.dancer_id, r.id]);
        else await db.run('DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [link.dancer_id, r.id]);
      }
      await db.run("UPDATE studios SET status = 'merged', merged_into_id = ? WHERE id = ?", [r.target.id, r.id]);
      // Best-effort: clean tab-embedded whitespace in the target's own name
      // (skip if the cleaned name is taken — that duplicate is a separate,
      // larger tab-name dedup project).
      const cleanedTarget = cleanSpaces(r.target.name);
      if (cleanedTarget !== r.target.name) {
        const clash = await db.get('SELECT id FROM studios WHERE name = ? AND id != ?', [cleanedTarget, r.target.id]);
        if (!clash) await db.run('UPDATE studios SET name = ? WHERE id = ?', [cleanedTarget, r.target.id]);
      }
    }
    for (const r of plan.rename) {
      const clash = await db.get('SELECT id FROM studios WHERE name = ? AND id != ?', [r.newName, r.id]);
      if (clash) throw new Error(`rename clash: "${r.newName}" already exists as #${clash.id}`);
      await db.run('UPDATE studios SET name = ? WHERE id = ?', [r.newName, r.id]);
    }
    for (const r of plan.review) {
      await db.run('UPDATE studios SET needs_investigation = 1 WHERE id = ?', [r.id]);
    }
    await db.run('COMMIT');
    console.log(`\nApplied: ${plan.deactivate.length} deactivated, ${plan.merge.length} merged, ${plan.rename.length} renamed, ${plan.review.length} flagged for review.`);
  } catch (e) {
    await db.run('ROLLBACK');
    console.error('\nROLLED BACK:', e.message);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
