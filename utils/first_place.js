// Shared first-place heuristics. The leaderboard "1st places" stat is
// awards.is_first_place; these rules decide what counts as a competitive 1st
// (vs special awards like scholarships/photogenic). Used by the admin audit
// pages (suspicion flags) and by weekly_update.js to mark newly imported
// events — keep them in ONE place so the two never drift.
// SQL fragments assume the awards table is aliased `a`.
const FIRSTISH_SQL = "LOWER(TRIM(a.place)) IN ('1', '1st', 'winner', '1st place', 'first place')";
const EXCLUDED_TERMS = [
  'invite', 'invitation', 'scholar', 'photogenic', 'headshot', 'entertainment',
  'choreography', 'costume', 'sportsmanship', 'spirit', 'class act', 'wild one',
  'wild $', 'discovery spotlight', 'palooza', 'battle', 'voucher', 'kindness', 'nominations'
];
const NOT_EXCLUDED_SQL = EXCLUDED_TERMS
  .map(t => `LOWER(COALESCE(a.category, '')) NOT LIKE '%${t}%'`).join(' AND ');

// Marks first places for specific events only — never the global
// reset+remark of scripts/mark_first_places.js, which would wipe superadmin
// hand-curation on other events. New events' awards default to 0, so
// marking-up is all that's needed; org_first_place_rules apply afterwards.
async function markFirstPlacesForEvents(db, eventIds) {
  if (!eventIds || !eventIds.length) return 0;
  const placeholders = eventIds.map(() => '?').join(',');
  const res = await db.run(`
    UPDATE awards SET is_first_place = 1
    WHERE is_first_place = 0 AND id IN (
      SELECT a.id FROM awards a
      WHERE a.event_id IN (${placeholders})
        AND ${FIRSTISH_SQL} AND ${NOT_EXCLUDED_SQL})`, eventIds);
  return res.changes;
}

module.exports = { FIRSTISH_SQL, NOT_EXCLUDED_SQL, EXCLUDED_TERMS, markFirstPlacesForEvents };
