// The event picker — "Are you at Starpower — San Jose today?" (mobile design
// v2 §6.4, development plan M2).
//
// Event identity is the hardest free-text problem in this domain, and the
// platform already owns the asset that mostly solves it: ~1,080 geocoded
// upcoming tour stops with real ISO dates, plus 4,214 canonical historical
// events. So the picker asks the cheapest question first and only falls back
// to typing when it must.
//
// THREE SOURCES, in the order a family should meet them:
//
//   1. `upcoming`  — the organizer's OWN announced tour stop. Geocoded and
//      dated, so "you are here, today" is a one-tap answer. Picking one seeds
//      a candidate at submit time (utils/eventCandidates.seedCandidateFromUpcoming)
//      rather than at browse time, so browsing never writes.
//   2. `candidate` — an event another family created. Labelled as such, so it
//      reads as provisional.
//   3. `event`     — a canonical historical event. These carry NO geography
//      and their `date_string` is free text ("March 22 - 24, 2024",
//      "Fox Performing Arts Center"), so they can only be found by name and
//      year. That is exactly why the geocoded upcoming table carries the
//      one-tap path.
//
// Nothing here writes. The picker is a read model over three tables in two
// databases, merged and ranked in JS because no SQL join spans them.
const { distanceMiles } = require('./upcoming');
const { LIFECYCLE, visibleCandidates, eventNameKey, nameSimilarity } = require('./eventCandidates');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A competition weekend plus slop: an awards ceremony that runs past midnight,
// a family entering on the Monday, a tour stop whose end date was never filled
// in. Generous on purpose — a missed match sends someone to the create form,
// which is the outcome this whole module exists to avoid.
const DATE_SLOP_DAYS = 3;

function daysFromRange(date, startDate, endDate) {
  if (!ISO_DATE.test(date || '') || !ISO_DATE.test(startDate || '')) return null;
  const t = Date.parse(date + 'T00:00:00Z');
  const s = Date.parse(startDate + 'T00:00:00Z');
  const e = ISO_DATE.test(endDate || '') ? Date.parse(endDate + 'T00:00:00Z') : s;
  if (t >= s && t <= e) return 0;
  return Math.min(Math.abs(t - s), Math.abs(t - e)) / 86400000;
}

function labelWhen(startDate, endDate) {
  if (!startDate) return null;
  if (endDate && endDate !== startDate) return `${startDate} – ${endDate}`;
  return startDate;
}

function labelWhere(city, state, venue) {
  return [venue, [city, state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || null;
}

// Organizer-announced stops near a place and date. Loaded in one query over a
// date window and filtered by distance in JS — the table is ~1,100 rows and
// SQLite has no spatial index here, so a scan is both simpler and faster than
// a bounding-box approximation would be.
async function nearbyUpcoming(db, { lat, lng, date, radiusMiles, limit = 12 }) {
  if (!ISO_DATE.test(date || '')) return [];
  const rows = await db.all(`
    SELECT u.id, u.org_id, u.name, u.city, u.state, u.venue, u.start_date, u.end_date,
           u.lat, u.lng, o.name AS org_name
    FROM org_upcoming_events u
    LEFT JOIN organizations o ON o.id = u.org_id
    WHERE u.status = 'active'
      AND ABS(julianday(u.start_date) - julianday(?)) <= ?
  `, [date, LIFECYCLE.visibilityDays + DATE_SLOP_DAYS]);

  const out = [];
  for (const r of rows) {
    const dayGap = daysFromRange(date, r.start_date, r.end_date);
    if (dayGap == null || dayGap > DATE_SLOP_DAYS) continue;
    let miles = null;
    if (lat != null && lng != null && r.lat != null && r.lng != null) {
      miles = distanceMiles(lat, lng, r.lat, r.lng);
      if (miles > radiusMiles) continue;
    } else if (lat != null && lng != null) {
      continue; // caller asked "near me" and this row has no coordinates
    }
    out.push({
      kind: 'upcoming',
      id: r.id,
      name: r.name,
      org_id: r.org_id,
      org_name: r.org_name,
      when: labelWhen(r.start_date, r.end_date),
      where: labelWhere(r.city, r.state, r.venue),
      distance_miles: miles == null ? null : Math.round(miles * 10) / 10,
      day_gap: dayGap,
      note: null,
    });
  }
  out.sort((a, b) =>
    (a.day_gap - b.day_gap) ||
    ((a.distance_miles == null ? 1e9 : a.distance_miles) - (b.distance_miles == null ? 1e9 : b.distance_miles)));
  return out.slice(0, limit);
}

function candidateOption(c) {
  return {
    kind: 'candidate',
    id: c.id,
    name: c.name,
    org_id: c.org_id,
    org_name: null,
    when: labelWhen(c.start_date, c.end_date),
    where: labelWhere(c.city, c.state, c.venue),
    distance_miles: c.distance_miles == null ? null : Math.round(c.distance_miles * 10) / 10,
    day_gap: null,
    // Reads as provisional in the picker, which is the honest label: another
    // family typed this, and no reviewer has confirmed it yet.
    note: 'Added by a family',
  };
}

// Canonical events by name. No geography exists on this table, so text is all
// there is; a supplied date narrows by YEAR only, which is the most the free-
// text date_string can support.
async function searchCanonicalEvents(db, { q, date, limit = 15 }) {
  if (!q || q.length < 2) return [];
  const like = `%${q}%`;
  const year = ISO_DATE.test(date || '') ? date.slice(0, 4) : null;
  const rows = await db.all(`
    SELECT e.id, e.name, e.year, e.date_string, e.org_id, o.name AS org_name
    FROM events e
    LEFT JOIN organizations o ON o.id = e.org_id
    WHERE (e.name LIKE ? OR o.name LIKE ?)
    ORDER BY (CASE WHEN ? IS NOT NULL AND e.year = ? THEN 0 ELSE 1 END),
             CAST(e.year AS INTEGER) DESC, e.name
    LIMIT ?
  `, [like, like, year, year, limit]);
  return rows.map(r => ({
    kind: 'event',
    id: r.id,
    name: r.name,
    org_id: r.org_id,
    org_name: r.org_name,
    when: r.date_string || (r.year ? String(r.year) : null),
    where: null,
    distance_miles: null,
    day_gap: null,
    note: null,
  }));
}

// The whole picker in one call.
//
// `lat`/`lng`/`date` present  -> the one-tap path: organizer stops and family
//                                candidates around here, right now.
// `q` present                 -> text fallback across all three sources, for
//                                when location is unavailable or declined.
// Both                        -> nearby first, then anything matching the text.
async function findEventOptions(db, sdb, { lat = null, lng = null, date = null, q = null, state = null } = {}) {
  const radiusMiles = LIFECYCLE.visibilityMiles;
  const query = (q || '').trim();
  const options = [];
  const seen = new Set();
  const push = (o) => {
    const key = o.kind + ':' + o.id;
    if (!seen.has(key)) { seen.add(key); options.push(o); }
  };

  const hasGeo = lat != null && lng != null;

  if (date) {
    if (hasGeo) (await nearbyUpcoming(db, { lat, lng, date, radiusMiles })).forEach(push);
    const cands = await visibleCandidates(sdb, { date, lat, lng, state });
    cands
      .sort((a, b) => (a.distance_miles == null ? 1e9 : a.distance_miles) - (b.distance_miles == null ? 1e9 : b.distance_miles))
      .slice(0, 12)
      .forEach(c => push(candidateOption(c)));
  }

  if (query.length >= 2) {
    const qk = eventNameKey(query);

    // Text search over candidates, so an event another family created is
    // findable by name even from a different town.
    const allCands = await sdb.all(
      "SELECT * FROM event_candidates WHERE status = 'open' ORDER BY created_at DESC LIMIT 200");
    allCands
      .filter(c => nameSimilarity(qk, c.name_key) >= 0.34 || (c.name || '').toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8)
      .forEach(c => push(candidateOption(c)));

    // Upcoming stops by name — how a family finds "next weekend's" event when
    // they are entering from home rather than from the venue.
    const ups = await db.all(`
      SELECT u.id, u.org_id, u.name, u.city, u.state, u.venue, u.start_date, u.end_date, o.name AS org_name
      FROM org_upcoming_events u
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE u.status = 'active' AND (u.name LIKE ? OR o.name LIKE ?)
      ORDER BY u.start_date DESC LIMIT 10`, [`%${query}%`, `%${query}%`]);
    ups.forEach(r => push({
      kind: 'upcoming', id: r.id, name: r.name, org_id: r.org_id, org_name: r.org_name,
      when: labelWhen(r.start_date, r.end_date), where: labelWhere(r.city, r.state, r.venue),
      distance_miles: null, day_gap: null, note: null,
    }));

    (await searchCanonicalEvents(db, { q: query, date })).forEach(push);
  }

  return options;
}

module.exports = {
  DATE_SLOP_DAYS,
  daysFromRange, labelWhen, labelWhere,
  nearbyUpcoming, searchCanonicalEvents, findEventOptions,
};
