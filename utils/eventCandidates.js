// Event candidates — family-created events that are instantly usable but
// never canonical (mobile design v2 §6.4, development plan M2).
//
// THE TENSION THIS RESOLVES. A parent at a competition that AwardHome has
// never heard of must be able to record their child's award *now*; a second
// parent at the same competition must see that event twenty minutes later
// rather than creating a duplicate; and the archive must not fill with
// half-typed events. Making family-created events `event_candidates` rather
// than canonical `events` gets all three: immediately selectable, clearly
// provisional, and promoted only by a reviewer or by the organizer's own data
// arriving later.
//
// THE FIRM RULE, unchanged from v1: no submission without a matched event —
// candidate or canonical. An award floating free of an event is unreviewable
// and unmergeable.
//
// ---------------------------------------------------------------------------
// LIFECYCLE DECISIONS (development plan §9.2 — open at M0, closed here)
//
//   Visibility scope   75 miles and ±14 days of the candidate's date. Wide
//                      enough that a family entering from home that evening,
//                      or the following weekend, still finds it; narrow
//                      enough that provisional data stays local noise instead
//                      of national noise.
//   Dedup match        40 miles and ±3 days, plus a similar name. Tighter,
//                      because this decides "these are the same event" rather
//                      than "you might be interested".
//   Promotion          AwardHome reviewers only. A studio owner promoting a
//                      candidate would let one studio mint canonical events
//                      for the whole platform — that is exactly the class of
//                      decision plan §9.3 reserves.
//   Auto-merge         When an organizer's own import lands an event matching
//                      an open candidate, the candidate merges into it with no
//                      human step (scripts/merge_event_candidates.js). The
//                      organizer's data is higher authority by definition.
//
// All four are env-overridable so they can be tuned against real traffic
// without a deploy.
const crypto = require('crypto');
const { distanceMiles } = require('./upcoming');

const LIFECYCLE = {
  visibilityMiles: parseFloat(process.env.CANDIDATE_VISIBILITY_MILES) || 75,
  visibilityDays: parseInt(process.env.CANDIDATE_VISIBILITY_DAYS, 10) || 14,
  dedupMiles: parseFloat(process.env.CANDIDATE_DEDUP_MILES) || 40,
  dedupDays: parseInt(process.env.CANDIDATE_DEDUP_DAYS, 10) || 3,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- Name matching ---------------------------------------------------------

// Machine key for an event name. Deliberately aggressive — this compares
// what two strangers typed about the same competition, not what an importer
// emitted, so "Starquest Spring Classic 2027" and "StarQuest — Spring
// Classic" must land close together.
function eventNameKey(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Words that carry no identifying signal in a competition name — they appear
// in half the corpus, so counting them inflates every comparison.
const STOPWORDS = new Set(['dance', 'competition', 'the', 'and', 'of', 'a', 'an',
  'regional', 'regionals', 'national', 'nationals', 'finals', 'tour', 'stop', 'event']);

function nameTokens(key) {
  const all = key.split(' ').filter(Boolean);
  const meaningful = all.filter(t => !STOPWORDS.has(t) && t.length > 1);
  // If a name is nothing BUT stopwords ("Nationals"), compare on what's there
  // rather than on an empty set, which would match everything.
  return meaningful.length ? meaningful : all;
}

// Jaccard overlap, with containment as a shortcut: "Starquest" inside
// "Starquest Spring Classic" is the abbreviation a hurried parent types.
function nameSimilarity(keyA, keyB) {
  if (!keyA || !keyB) return 0;
  if (keyA === keyB) return 1;
  const a = new Set(nameTokens(keyA));
  const b = new Set(nameTokens(keyB));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const smaller = Math.min(a.size, b.size);
  if (shared === smaller) return 0.9; // one name's words are all in the other
  return shared / (a.size + b.size - shared);
}

const NAME_MATCH_THRESHOLD = parseFloat(process.env.CANDIDATE_NAME_THRESHOLD) || 0.5;

// ---- Geo / date helpers ----------------------------------------------------

function daysApart(isoA, isoB) {
  if (!ISO_DATE.test(isoA || '') || !ISO_DATE.test(isoB || '')) return null;
  return Math.abs((Date.parse(isoA + 'T00:00:00Z') - Date.parse(isoB + 'T00:00:00Z')) / 86400000);
}

// Same event? Used at creation time to offer an existing candidate first.
// Every axis that CAN be checked must agree; an axis nobody supplied is not
// evidence either way, so it neither confirms nor refutes.
function looksLikeSameEvent(a, b, opts = {}) {
  const miles = opts.miles != null ? opts.miles : LIFECYCLE.dedupMiles;
  const days = opts.days != null ? opts.days : LIFECYCLE.dedupDays;

  const gap = daysApart(a.start_date, b.start_date);
  if (gap != null && gap > days) return false;

  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    if (distanceMiles(a.lat, a.lng, b.lat, b.lng) > miles) return false;
  } else if (a.state && b.state && a.state !== b.state) {
    // No coordinates on one side: a state mismatch is still a clean refusal.
    return false;
  }

  return nameSimilarity(a.name_key || eventNameKey(a.name), b.name_key || eventNameKey(b.name))
    >= NAME_MATCH_THRESHOLD;
}

// ---- Input ----------------------------------------------------------------

// Normalise and validate what a family typed. Same contract as
// validateSubmission: never throws on user input.
function cleanCandidateInput(body) {
  const trim = (v, max) => {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
    return s || null;
  };
  const errors = [];
  const name = trim(body.name, 140);
  const start_date = trim(body.start_date, 10);
  let end_date = trim(body.end_date, 10);
  const city = trim(body.city, 80);
  const state = (trim(body.state, 2) || '').toUpperCase() || null;
  const venue = trim(body.venue, 140);

  if (!name) errors.push('The event needs a name.');
  if (!start_date || !ISO_DATE.test(start_date)) errors.push('When was it? Please give a date.');
  if (end_date && !ISO_DATE.test(end_date)) errors.push('The end date should look like 2027-03-14.');
  if (end_date && start_date && end_date < start_date) errors.push('The end date is before the start date.');
  if (state && !/^[A-Z]{2}$/.test(state)) errors.push('State should be a two-letter code.');
  if (!end_date) end_date = null;

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  let lat = num(body.lat), lng = num(body.lng);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) { lat = null; lng = null; }

  const orgId = parseInt(body.org_id, 10);

  return {
    ok: errors.length === 0,
    errors,
    values: {
      name, name_key: eventNameKey(name), start_date, end_date, city, state, venue,
      lat, lng, org_id: Number.isFinite(orgId) ? orgId : null,
    },
  };
}

// ---- Reads -----------------------------------------------------------------

// Open candidates a family could plausibly be looking at. The SQL narrows on
// date (indexed); geography is applied in JS because SQLite has no spatial
// index here and the candidate set is small by construction.
async function visibleCandidates(sdb, { date, lat, lng, state } = {}) {
  const params = [];
  let where = "status = 'open'";
  if (date && ISO_DATE.test(date)) {
    where += " AND start_date IS NOT NULL AND ABS(julianday(start_date) - julianday(?)) <= ?";
    params.push(date, LIFECYCLE.visibilityDays);
  }
  const rows = await sdb.all(
    `SELECT * FROM event_candidates WHERE ${where} ORDER BY start_date DESC, id DESC LIMIT 200`, params);

  return rows
    .map(r => {
      const d = (lat != null && lng != null && r.lat != null && r.lng != null)
        ? distanceMiles(lat, lng, r.lat, r.lng) : null;
      return { ...r, distance_miles: d };
    })
    .filter(r => {
      if (r.distance_miles != null) return r.distance_miles <= LIFECYCLE.visibilityMiles;
      // No coordinates to compare: fall back to state, and if we know nothing
      // about where the family is, show it — a candidate nobody can find is
      // worse than one shown too widely.
      if (state && r.state) return state === r.state;
      return true;
    });
}

// The dedup offer: "Someone here added 'Starquest Spring Classic' 20 minutes
// ago — is that yours?" Shown BEFORE the create form, which is the whole
// point: this is the race that otherwise produces two candidates for one
// event within minutes.
async function findDuplicateCandidates(sdb, values) {
  const params = [];
  let where = "status IN ('open', 'promoted', 'merged')";
  if (values.start_date) {
    where += ' AND start_date IS NOT NULL AND ABS(julianday(start_date) - julianday(?)) <= ?';
    params.push(values.start_date, LIFECYCLE.dedupDays);
  }
  const rows = await sdb.all(
    `SELECT * FROM event_candidates WHERE ${where} ORDER BY created_at DESC LIMIT 100`, params);
  return rows.filter(r => looksLikeSameEvent(values, r));
}

// Canonical events this candidate might already be. Used two ways: as
// suggestions in the reviewer queue, and as the auto-merge test when the
// organizer's own import lands (scripts/merge_event_candidates.js).
//
// Only three signals are available, because canonical events carry no geo and
// their date_string is free text ("March 22 - 24, 2024", "Fox Performing Arts
// Center"):
//   org   — a hard filter. A candidate with no org cannot be matched at all.
//   year  — a hard filter, from the candidate's own date.
//   name  — the actual discriminator, plus a city bonus: canonical event names
//           very often carry the city ("KAR - San Jose, CA"), which is exactly
//           what separates one tour stop from the next.
async function findCanonicalMatches(db, candidate, { limit = 8 } = {}) {
  if (!candidate.org_id || !candidate.start_date) return [];
  const year = parseInt(candidate.start_date.slice(0, 4), 10);
  if (!year) return [];

  const rows = await db.all(
    'SELECT id, name, year, date_string FROM events WHERE org_id = ? AND year = ?',
    [candidate.org_id, year]);

  const candKey = candidate.name_key || eventNameKey(candidate.name);
  const cityKey = candidate.city ? eventNameKey(candidate.city) : null;

  return rows
    .map(r => {
      const rowKey = eventNameKey(r.name);
      let score = nameSimilarity(candKey, rowKey);
      // The city is the tour-stop discriminator; treat it as strong evidence
      // when the canonical name carries it, and as a real penalty when the
      // canonical name names a DIFFERENT city we also know about.
      if (cityKey && rowKey.includes(cityKey)) score = Math.min(1, score + 0.35);
      return { ...r, score };
    })
    .filter(r => r.score >= NAME_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---- Writes ----------------------------------------------------------------

// Create a family candidate. Returns { duplicates } WITHOUT creating anything
// when a likely twin exists and the family has not yet said "no, mine is
// different" — the offer comes first, always.
async function createCandidate(sdb, values, { userId, confirmNew = false }) {
  const duplicates = await findDuplicateCandidates(sdb, values);
  if (duplicates.length && !confirmNew) return { candidate: null, duplicates, offered: true };

  // Both families proceeded: they share a cluster, so a reviewer sees one
  // decision rather than two rows that look unrelated.
  const clusterId = duplicates.length ? duplicates[0].dedup_cluster_id : crypto.randomUUID();

  const res = await sdb.run(`
    INSERT INTO event_candidates
      (dedup_cluster_id, org_id, name, name_key, start_date, end_date, city, state, venue,
       lat, lng, source, created_by, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'family', ?, 'open')`,
    [clusterId, values.org_id, values.name, values.name_key, values.start_date, values.end_date,
     values.city, values.state, values.venue, values.lat, values.lng, userId]);

  const candidate = await sdb.get('SELECT * FROM event_candidates WHERE id = ?', [res.lastID]);
  return { candidate, duplicates, offered: false };
}

// Get-or-create the candidate standing for an organizer's OWN announced tour
// stop. Seeded lazily at submit time rather than at browse time, so browsing
// the picker never writes. The unique index on upcoming_event_id makes two
// households racing on the same stop share one row.
async function seedCandidateFromUpcoming(db, sdb, upcomingEventId, userId) {
  const existing = await sdb.get(
    'SELECT * FROM event_candidates WHERE upcoming_event_id = ?', [upcomingEventId]);
  if (existing) return existing;

  const up = await db.get(`
    SELECT u.*, o.name AS org_name FROM org_upcoming_events u
    LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = ?`, [upcomingEventId]);
  if (!up) return null;

  const name = up.name;
  try {
    await sdb.run(`
      INSERT INTO event_candidates
        (dedup_cluster_id, org_id, upcoming_event_id, name, name_key, start_date, end_date,
         city, state, venue, lat, lng, source, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'org_upcoming', ?, 'open')`,
      [crypto.randomUUID(), up.org_id, up.id, name, eventNameKey(name), up.start_date, up.end_date,
       up.city, up.state, up.venue, up.lat, up.lng, userId]);
  } catch (e) {
    // Lost the race against another household picking the same stop.
  }
  return sdb.get('SELECT * FROM event_candidates WHERE upcoming_event_id = ?', [upcomingEventId]);
}

// Point every submission on this candidate at the canonical event it became.
// event_id is authoritative once set; event_candidate_id stays as provenance —
// how this award reached the archive is a fact worth keeping.
async function redirectSubmissionsToEvent(sdb, candidateId, eventId) {
  const res = await sdb.run(
    'UPDATE award_submissions SET event_id = ?, updated_at = CURRENT_TIMESTAMP WHERE event_candidate_id = ? AND event_id IS NULL',
    [eventId, candidateId]);
  return res.changes || 0;
}

// Promote a candidate to a canonical event. REVIEWER ONLY.
//
// Idempotent and retry-safe, which matters because the two writes land in two
// different SQLite files and cannot share a transaction: an already-promoted
// candidate returns its event, and an existing canonical event with the same
// (org, name, year) is reused rather than duplicated. So a crash between the
// halves costs a retry, never a duplicate event.
async function promoteCandidate(db, sdb, { candidateId, reviewerId, note = null }) {
  const cand = await sdb.get('SELECT * FROM event_candidates WHERE id = ?', [candidateId]);
  if (!cand) return { ok: false, error: 'Candidate not found.' };
  if (cand.promoted_event_id) {
    const moved = await redirectSubmissionsToEvent(sdb, cand.id, cand.promoted_event_id);
    return { ok: true, eventId: cand.promoted_event_id, created: false, submissionsMoved: moved };
  }
  if (!cand.org_id) {
    return { ok: false, error: 'Set the organization before promoting — a canonical event needs one.' };
  }

  const year = cand.start_date ? parseInt(cand.start_date.slice(0, 4), 10) : null;
  if (!year) return { ok: false, error: 'Set a date before promoting — a canonical event needs a year.' };

  let event = await db.get(
    'SELECT id FROM events WHERE org_id = ? AND name = ? AND year = ?', [cand.org_id, cand.name, year]);
  let created = false;
  if (!event) {
    const dateString = cand.end_date && cand.end_date !== cand.start_date
      ? `${cand.start_date} - ${cand.end_date}` : cand.start_date;
    const res = await db.run(
      "INSERT INTO events (org_id, name, year, date_string, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      [cand.org_id, cand.name, year, dateString]);
    event = { id: res.lastID };
    created = true;
  }

  await sdb.run(`
    UPDATE event_candidates
    SET status = 'promoted', promoted_event_id = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP,
        decision_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`, [event.id, reviewerId, note, cand.id]);
  const moved = await redirectSubmissionsToEvent(sdb, cand.id, event.id);
  return { ok: true, eventId: event.id, created, submissionsMoved: moved };
}

// Absorb a candidate into an event that already exists — the common outcome,
// because most "missing" events are really a spelling the family didn't find.
// Also the shape auto-merge uses when the organizer's import lands.
async function mergeCandidateIntoEvent(db, sdb, { candidateId, eventId, reviewerId = null, note = null, auto = false }) {
  const cand = await sdb.get('SELECT * FROM event_candidates WHERE id = ?', [candidateId]);
  if (!cand) return { ok: false, error: 'Candidate not found.' };
  const event = await db.get('SELECT id FROM events WHERE id = ?', [eventId]);
  if (!event) return { ok: false, error: 'That event no longer exists.' };

  await sdb.run(`
    UPDATE event_candidates
    SET status = 'merged', promoted_event_id = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP,
        decision_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [event.id, reviewerId, note || (auto ? 'auto-merged: organizer data landed' : null), cand.id]);
  const moved = await redirectSubmissionsToEvent(sdb, cand.id, event.id);
  return { ok: true, eventId: event.id, submissionsMoved: moved };
}

// Reject a candidate. Submissions on it are deliberately NOT deleted: the
// family's entry is still their record, and a rejected event means a reviewer
// must re-home the submission, not that the award never happened.
async function rejectCandidate(sdb, { candidateId, reviewerId, note = null }) {
  await sdb.run(`
    UPDATE event_candidates
    SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP,
        decision_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`, [reviewerId, note, candidateId]);
  return { ok: true };
}

module.exports = {
  LIFECYCLE, NAME_MATCH_THRESHOLD,
  eventNameKey, nameSimilarity, daysApart, looksLikeSameEvent,
  cleanCandidateInput, visibleCandidates, findDuplicateCandidates, findCanonicalMatches,
  createCandidate, seedCandidateFromUpcoming,
  promoteCandidate, mergeCandidateIntoEvent, rejectCandidate,
  redirectSubmissionsToEvent,
};
