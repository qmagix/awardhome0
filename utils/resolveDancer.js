const { generateDancerId } = require('../utils.js');

// Resolve a published dancer name to a dancer id for a studio's award, per
// the data rules: match by name+studio; when several same-name dancers are
// rostered, the routine is the tie-breaker (name+routine+studio collisions
// are vanishingly rare — Q, 2026-08-29); otherwise create a fresh profile
// and let the roster duplicates widget surface the ambiguity to a human
// instead of guessing silently.
//
// Note for batch callers: link each award as you resolve it — a created
// profile then wins the routine tie-break for that routine's later awards,
// so one routine never mints two profiles.
async function resolveOrCreateDancer(db, { name, studioId, routine, year }) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  if (!clean || !studioId) return null;

  const candidates = await db.all(`
    SELECT d.id FROM dancers d JOIN dancer_studios ds ON ds.dancer_id = d.id
    WHERE ds.studio_id = ? AND LOWER(d.name) = LOWER(?)`, [studioId, clean]);
  if (candidates.length === 1) return { id: candidates[0].id, created: false };

  if (candidates.length > 1 && routine) {
    const { resolveRoutineKey } = require('./routineKey');
    const r = await resolveRoutineKey(db, studioId, routine);
    // Evidence = same routine at the same studio in the SAME YEAR when the
    // award's year is known (Q, 2026-08-30: name+routine+studio+year is much
    // safer than dropping the year — casts and even dancers change season to
    // season). Undated awards fall back to routine+studio.
    const yearCond = year != null && String(year).trim() !== ''
      ? "AND IFNULL(e.year, 'U') = ?" : '';
    const matched = [];
    for (const c of candidates) {
      const params = [c.id, studioId, r];
      if (yearCond) params.push(String(year));
      const params2 = [c.id, studioId, r];
      if (yearCond) params2.push(String(year));
      const hit = await db.get(`
        SELECT 1 FROM award_dancers ad JOIN awards a ON a.id = ad.award_id
        LEFT JOIN events e ON e.id = a.event_id
        WHERE ad.dancer_id = ? AND a.studio_id = ?
          AND IFNULL(a.performance_name_key, LOWER(TRIM(IFNULL(a.performance_name, '')))) = ? ${yearCond}
        UNION
        SELECT 1 FROM awards a2
        LEFT JOIN events e ON e.id = a2.event_id
        WHERE a2.dancer_id = ? AND a2.studio_id = ?
          AND IFNULL(a2.performance_name_key, LOWER(TRIM(IFNULL(a2.performance_name, '')))) = ? ${yearCond}
        LIMIT 1`, [...params, ...params2]);
      if (hit) matched.push(c);
    }
    // ANY routine match wins — if several same-name candidates all carry this
    // routine, then by the evidence rule (name+routine+studio+year collisions
    // are vanishingly rare) they are duplicates of EACH OTHER; the weekly
    // auto-merge will unify them, so linking to one is correct and minting a
    // third profile is strictly worse. (The old ===1 rule created one new
    // profile per routine whenever the roster already held duplicate
    // profiles — the Ina Su amplification, 2026-08-30.)
    if (matched.length >= 1) return { id: matched[0].id, created: false };
  }

  // Zero rostered, or irreducibly ambiguous: new profile, visible + reviewable.
  const ins = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [generateDancerId(clean), clean]);
  await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [ins.lastID, studioId]);
  return { id: ins.lastID, created: true };
}

module.exports = { resolveOrCreateDancer };
