// Family award submissions — the domain service behind both the web form
// (M1) and the mobile API (M5). Routers stay thin; every rule that protects
// the archive lives here, so the two surfaces cannot drift apart.
//
// The rules, and why each one exists:
//
//  * STUDIO IS DERIVED, NEVER TYPED (design §6.2). A family's dancers carry
//    their studio through dancer_studios. Free-text studio entry is the
//    single largest duplicate vector — 3,386 duplicate studios were merged on
//    2026-08-30 and every one came from a machine typing a name.
//
//  * GROUP SIZE IS REQUIRED (design §6.5). It decides the canonical write
//    path at promotion: solos double-write awards.dancer_id AND the junction;
//    groups use the junction only. Inferring format from "how many dancers
//    are linked" is exactly what left 1,874 group awards looking like solos.
//
//  * NORMALISE ON THE SERVER (design §6.3). The client trims and collapses
//    whitespace as a courtesy to reviewers; the server does it again as the
//    guarantee. The tab-damaged names repaired on 2026-08-31 are what leaks
//    in when only one side does it.
//
//  * NOTHING CANONICAL IS WRITTEN HERE. No events row, no awards row, no
//    award_dancers link. This module only ever writes the staging file.
//    Promotion is M3's job and runs behind a reviewer.
const crypto = require('crypto');
const { openDb } = require('../database');
const { openSubmissionsDb } = require('./submissionsDb');
const { canonicalizeRoutine } = require('./routineKey');

// ---- Group size vocabulary -------------------------------------------------
//
// `enumerable` = the family can reasonably name the whole cast, so a
// submission may assert cast_complete. Everything larger is recorded as
// explicitly PARTIAL: the parent names their own dancer and other households
// converge onto the same award later (design §7.3). `individual` marks the
// formats that promote to a solo write path.
const GROUP_SIZES = [
  { key: 'solo', label: 'Solo', n: 1, enumerable: true, individual: true },
  { key: 'duet', label: 'Duet', n: 2, enumerable: true, individual: false },
  { key: 'trio', label: 'Trio', n: 3, enumerable: true, individual: false },
  { key: 'small_group', label: 'Small Group', n: null, enumerable: false, individual: false },
  { key: 'large_group', label: 'Large Group', n: null, enumerable: false, individual: false },
  { key: 'line', label: 'Line', n: null, enumerable: false, individual: false },
  { key: 'grand_line', label: 'Grand Line', n: null, enumerable: false, individual: false },
  { key: 'production', label: 'Production', n: null, enumerable: false, individual: false },
];
const GROUP_SIZE_BY_KEY = new Map(GROUP_SIZES.map(g => [g.key, g]));

// Per-household daily ceilings. Self-identification is unverifiable, so
// without limits "independent" becomes the route around review (design
// §6.2.3). Generous enough for a real competition weekend, low enough that a
// script is not a firehose.
const LIMITS = {
  submission: parseInt(process.env.SUBMISSION_DAILY_LIMIT, 10) || 40,
  dancer_link: parseInt(process.env.DANCER_LINK_DAILY_LIMIT, 10) || 10,
};

// ---- Normalisation ---------------------------------------------------------

// Collapse every whitespace run (tabs included) to one space and trim.
// Returns null for empty so a blank field is stored as NULL, not ''.
function normalizeText(raw) {
  if (raw == null) return null;
  const s = String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return s || null;
}

// Person names get the same treatment plus the typographic folds that make
// two spellings of one name compare equal.
function normalizePersonName(raw) {
  const s = normalizeText(raw);
  if (!s) return null;
  return s.replace(/[‘’ʼ`´]/g, "'").replace(/[–—−]/g, '-');
}

function nameKey(raw) {
  const s = normalizePersonName(raw);
  return s ? s.toLowerCase() : null;
}

// ---- Rate limiting ---------------------------------------------------------

// Rolling 24h count of one household's actions. Counting rows beats a mutable
// counter: a limit change applies correctly to history, and the ledger is an
// audit trail when someone asks why a submission was refused.
async function countRecentActions(sdb, userId, action) {
  const row = await sdb.get(
    `SELECT COUNT(*) AS n FROM household_action_log
     WHERE user_id = ? AND action = ? AND created_at > datetime('now', '-1 day')`,
    [userId, action]);
  return row ? row.n : 0;
}

async function checkRateLimit(sdb, userId, action) {
  const limit = LIMITS[action];
  if (!limit) return { ok: true, used: 0, limit: null };
  const used = await countRecentActions(sdb, userId, action);
  return { ok: used < limit, used, limit };
}

async function recordAction(sdb, userId, action, subjectId = null) {
  await sdb.run(
    'INSERT INTO household_action_log (user_id, action, subject_id) VALUES (?, ?, ?)',
    [userId, action, subjectId]);
}

// Convenience wrapper for the non-submission surfaces (dancer claims, roster
// join requests). Opens the staging DB itself so callers stay one-liners.
async function consumeHouseholdAction(userId, action, subjectId = null) {
  const sdb = await openSubmissionsDb();
  const check = await checkRateLimit(sdb, userId, action);
  if (!check.ok) return check;
  await recordAction(sdb, userId, action, subjectId);
  return check;
}

// ---- Studio derivation -----------------------------------------------------

// Which studio did this routine get danced for? Read from affiliation, never
// asked as free text. One affiliation is the common case; a multi-studio
// dancer (only 7 exist today) must be ASKED which one — guessing would attach
// a routine to the wrong studio's public page. A dancer with no affiliation
// is legitimate (an independent, design §6.2.1) and submits with a NULL
// studio until the independent identity flow gives them a synthetic one.
async function dancerStudios(db, dancerId) {
  return db.all(`
    SELECT s.id, s.name, s.unique_id, COALESCE(s.is_independent, 0) AS is_independent, ds.status
    FROM dancer_studios ds
    JOIN studios s ON s.id = ds.studio_id
    WHERE ds.dancer_id = ? AND COALESCE(ds.status, 'active') != 'pending'
      AND COALESCE(s.status, 'active') != 'merged'
    ORDER BY s.name
  `, [dancerId]);
}

// ---- Event resolution (M2) -------------------------------------------------

// Resolve whatever the client sent into { event, candidate }. Exactly one of
// the two ends up set, except when a candidate has already been promoted or
// merged — then the canonical event wins and the candidate rides along as
// provenance, because that is the truer record of how the award got here.
//
// Deliberately does NOT accept a free-text event name. A family creates an
// event through the candidate flow, which shows likely duplicates first; a
// name typed straight into a submission would bypass that and is precisely
// the race that produces two events for one competition.
async function resolveEventRef(db, input, userId) {
  const { openSubmissionsDb } = require('./submissionsDb');
  const { seedCandidateFromUpcoming } = require('./eventCandidates');

  const eventId = parseInt(input.event_id, 10);
  const candidateId = parseInt(input.event_candidate_id, 10);
  const upcomingId = parseInt(input.upcoming_event_id, 10);

  if (eventId) {
    const event = await db.get(`
      SELECT e.id, e.name, e.year, e.date_string, o.name AS org_name
      FROM events e LEFT JOIN organizations o ON o.id = e.org_id
      WHERE e.id = ?`, [eventId]);
    if (!event) return { event: null, candidate: null, error: 'That competition is no longer in the archive — pick another.' };
    return { event, candidate: null, error: null };
  }

  if (candidateId || upcomingId) {
    const sdb = await openSubmissionsDb();
    let candidate = candidateId
      ? await sdb.get('SELECT * FROM event_candidates WHERE id = ?', [candidateId])
      : await seedCandidateFromUpcoming(db, sdb, upcomingId, userId);

    if (!candidate) return { event: null, candidate: null, error: 'That event is no longer available — pick another.' };
    if (candidate.status === 'rejected') {
      return { event: null, candidate: null, error: 'A reviewer removed that event — please pick another.' };
    }
    // Promoted or merged since the form was rendered: bind to the canonical
    // event the candidate became, so the submission never lands on a row that
    // is no longer where the archive keeps this competition.
    if (candidate.promoted_event_id) {
      const event = await db.get(`
        SELECT e.id, e.name, e.year, e.date_string, o.name AS org_name
        FROM events e LEFT JOIN organizations o ON o.id = e.org_id
        WHERE e.id = ?`, [candidate.promoted_event_id]);
      if (event) return { event, candidate, error: null };
    }
    return { event: null, candidate, error: null };
  }

  return { event: null, candidate: null, error: 'Pick the competition this award came from.' };
}

// ---- Validation ------------------------------------------------------------

// Returns { ok, errors[], value } — never throws on user input. `value` is
// the normalised, storable shape; the caller re-renders the form with
// `errors` on failure.
async function validateSubmission(db, input, { dancerId, userId }) {
  const errors = [];

  const clientSubmissionId = normalizeText(input.client_submission_id) || crypto.randomUUID();

  const performanceName = normalizeText(input.performance_name);
  if (!performanceName) errors.push('Routine name is required.');
  if (performanceName && performanceName.length > 200) errors.push('Routine name is too long.');

  const groupSize = GROUP_SIZE_BY_KEY.get(normalizeText(input.group_size) || '');
  if (!groupSize) errors.push('Group size is required — it decides how the award is recorded.');

  // The rule that stays firm from v1: no submission floats free of an event.
  // An award without one is unreviewable and unmergeable. But "an event" now
  // means any of three things (M2) — a canonical event, a family-created
  // candidate, or the organizer's own announced tour stop, which is resolved
  // to a candidate here rather than left as a dangling third id.
  const { event, candidate, error: eventError } = await resolveEventRef(db, input, userId);
  if (eventError) errors.push(eventError);

  // Studio comes from affiliation. When the dancer has several, the family
  // must have chosen one, and it must be one of theirs.
  const affiliations = await dancerStudios(db, dancerId);
  let studioId = null;
  if (affiliations.length === 1) {
    studioId = affiliations[0].id;
  } else if (affiliations.length > 1) {
    const chosen = parseInt(input.studio_id, 10);
    const match = affiliations.find(s => s.id === chosen);
    if (!match) errors.push('Choose which studio this routine was danced for.');
    else studioId = match.id;
  }

  const place = normalizeText(input.place);
  const awardType = normalizeText(input.award_type);
  const category = normalizeText(input.category);
  const ageDivision = normalizeText(input.age_division);
  const teacher = normalizePersonName(input.teacher);
  const choreographer = normalizePersonName(input.choreographer);
  const notes = normalizeText(input.notes);
  if (notes && notes.length > 2000) errors.push('Notes are too long.');

  // Cast: only the enumerable formats may claim a complete cast. A group,
  // line or production is recorded as explicitly partial no matter what the
  // client sends — the record must never read as "this is the whole cast"
  // when one parent typed one child.
  const castNames = (Array.isArray(input.cast_names) ? input.cast_names : String(input.cast_names || '').split('\n'))
    .map(normalizePersonName)
    .filter(Boolean);
  const uniqueCast = [];
  const seen = new Set();
  for (const n of castNames) {
    const k = n.toLowerCase();
    if (!seen.has(k)) { seen.add(k); uniqueCast.push(n); }
  }
  const castComplete = !!(groupSize && groupSize.enumerable && input.cast_complete);
  if (groupSize && groupSize.enumerable && groupSize.n && uniqueCast.length > groupSize.n - 1) {
    errors.push(`A ${groupSize.label.toLowerCase()} has at most ${groupSize.n - 1} other dancer(s).`);
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      client_submission_id: clientSubmissionId,
      user_id: userId,
      dancer_id: dancerId,
      studio_id: studioId,
      event_id: event ? event.id : null,
      event_candidate_id: candidate ? candidate.id : null,
      event_session_id: normalizeText(input.event_session_id),
      performance_name: performanceName,
      performance_name_key: canonicalizeRoutine(performanceName),
      group_size: groupSize ? groupSize.key : null,
      group_size_n: groupSize ? groupSize.n : null,
      cast_complete: castComplete ? 1 : 0,
      place, award_type: awardType, category, age_division: ageDivision,
      teacher, choreographer, notes,
      cast: uniqueCast,
    },
    affiliations,
    event,
    candidate,
  };
}

// ---- Create ----------------------------------------------------------------

// Idempotent on (user_id, client_submission_id): a retried offline upload
// returns the ORIGINAL row and never a second award. The retry is also not
// charged against the household's daily limit — a flaky connection is not
// abuse.
//
// Returns { submission, idempotent } or throws { rateLimited } shapes via the
// `limit` field, so the router can render the right message.
async function createSubmission(value, cast = []) {
  const sdb = await openSubmissionsDb();

  const existing = await sdb.get(
    'SELECT * FROM award_submissions WHERE user_id = ? AND client_submission_id = ?',
    [value.user_id, value.client_submission_id]);
  if (existing) return { submission: existing, idempotent: true };

  const limit = await checkRateLimit(sdb, value.user_id, 'submission');
  if (!limit.ok) return { submission: null, idempotent: false, limit };

  await sdb.run('BEGIN IMMEDIATE');
  let id;
  try {
    const res = await sdb.run(`
      INSERT INTO award_submissions (
        client_submission_id, user_id, dancer_id, studio_id, event_id, event_candidate_id, event_session_id,
        performance_name, performance_name_key, group_size, group_size_n, cast_complete,
        place, award_type, category, age_division, teacher, choreographer, notes,
        raw_payload, status, visibility, verification_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'owner_visible', 'family_submitted')`,
      [value.client_submission_id, value.user_id, value.dancer_id, value.studio_id,
       value.event_id, value.event_candidate_id, value.event_session_id,
       value.performance_name, value.performance_name_key, value.group_size,
       value.group_size_n, value.cast_complete,
       value.place, value.award_type, value.category, value.age_division,
       value.teacher, value.choreographer, value.notes,
       JSON.stringify({ ...value, cast })]);
    id = res.lastID;
    for (const name of cast) {
      await sdb.run(
        'INSERT OR IGNORE INTO award_submission_dancers (submission_id, name, name_key) VALUES (?, ?, ?)',
        [id, name, nameKey(name)]);
    }
    await recordAction(sdb, value.user_id, 'submission', id);
    await sdb.run('COMMIT');
  } catch (err) {
    await sdb.run('ROLLBACK').catch(() => {});
    // Lost the race against a concurrent identical retry — the unique index
    // did its job; return the row the winner wrote.
    const raced = await sdb.get(
      'SELECT * FROM award_submissions WHERE user_id = ? AND client_submission_id = ?',
      [value.user_id, value.client_submission_id]);
    if (raced) return { submission: raced, idempotent: true };
    throw err;
  }

  const submission = await sdb.get('SELECT * FROM award_submissions WHERE id = ?', [id]);
  return { submission, idempotent: false };
}

// ---- Read ------------------------------------------------------------------

// Resolve staging rows against the canonical database and DROP what no longer
// exists (the orphan story in utils/submissionsDb.js). A deleted event must
// leave a family looking at a slightly thinner list, never at a 500.
async function decorate(db, rows) {
  const { openSubmissionsDb } = require('./submissionsDb');
  const sdb = await openSubmissionsDb();
  const out = [];
  for (const r of rows) {
    const event = r.event_id
      ? await db.get(`SELECT e.id, e.name, e.year, e.date_string, o.name AS org_name
                      FROM events e LEFT JOIN organizations o ON o.id = e.org_id WHERE e.id = ?`, [r.event_id])
      : null;
    if (r.event_id && !event) continue; // orphan: canonical event is gone
    // A submission on a candidate shows the family the event they picked,
    // labelled as still provisional — not a blank where the event should be.
    const candidate = (!event && r.event_candidate_id)
      ? await sdb.get('SELECT id, name, start_date, end_date, city, state, status FROM event_candidates WHERE id = ?', [r.event_candidate_id])
      : null;
    const studio = r.studio_id
      ? await db.get('SELECT id, name, unique_id, COALESCE(is_independent, 0) AS is_independent FROM studios WHERE id = ?', [r.studio_id])
      : null;
    const sizeDef = GROUP_SIZE_BY_KEY.get(r.group_size);
    out.push({
      ...r,
      event,
      candidate,
      studio,
      group_size_label: sizeDef ? sizeDef.label : r.group_size,
    });
  }
  return out;
}

async function listForDancer(dancerId, userId) {
  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const rows = await sdb.all(
    'SELECT * FROM award_submissions WHERE dancer_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC',
    [dancerId, userId]);
  return decorate(db, rows);
}

// The studio reviewer's inbox: submissions for THIS studio's dancers only.
// Scope is the studio_id derived at submit time, never a role — the same
// ownership-by-column rule the rest of the platform uses.
//
// A submission with no studio (an independent dancer, design §6.2.1) appears
// in no studio inbox by construction. There is no studio owner to review it,
// which is exactly why §6.2.3 routes independents to auto-approval and the
// AwardHome queue instead — M4 work, tracked in TODOS_and_DONE.md.
async function listForStudio(studioId, { statuses = ['submitted', 'needs_info'] } = {}) {
  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const rows = await sdb.all(
    `SELECT * FROM award_submissions
     WHERE studio_id = ? AND status IN (${statuses.map(() => '?').join(',')})
     ORDER BY created_at ASC, id ASC`,
    [studioId, ...statuses]);

  const out = await decorate(db, rows);
  for (const r of out) {
    r.dancer = await db.get('SELECT id, name, unique_id FROM dancers WHERE id = ?', [r.dancer_id]);
    r.submitter = await db.get('SELECT id, email FROM users WHERE id = ?', [r.user_id]);
  }
  // A submission whose dancer profile is gone cannot be confirmed and must
  // not sit in a reviewer's queue looking actionable.
  return out.filter(r => r.dancer);
}

// The AwardHome queue: everything no studio owner will ever see.
//
// The operationally important case is the first one. A submission for a
// dancer at an UNCLAIMED studio has no owner to review it, so under M3 alone
// it would sit pending forever in nobody's inbox — invisible, and indistinguishable
// from a system that is working. Most studios are unclaimed, so this is the
// common case, not the edge.
//
// The rest are the decisions §7.1 reserves for AwardHome: independents (no
// studio owner by definition), and anything touching a contested dancer claim,
// which a studio must never adjudicate.
async function listForReview({ statuses = ['submitted', 'needs_info'] } = {}) {
  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const rows = await sdb.all(
    `SELECT * FROM award_submissions
     WHERE status IN (${statuses.map(() => '?').join(',')})
     ORDER BY created_at ASC, id ASC
     LIMIT 300`, statuses);

  const out = [];
  for (const r of await decorate(db, rows)) {
    r.dancer = await db.get('SELECT id, name, unique_id FROM dancers WHERE id = ?', [r.dancer_id]);
    if (!r.dancer) continue;
    r.submitter = await db.get('SELECT id, email FROM users WHERE id = ?', [r.user_id]);

    const studio = r.studio_id
      ? await db.get('SELECT id, name, owner_id, COALESCE(is_independent, 0) AS is_independent FROM studios WHERE id = ?', [r.studio_id])
      : null;
    let contested = null;
    try {
      contested = await db.get(
        "SELECT 1 AS x FROM dancer_claims WHERE dancer_id = ? AND status = 'contested' LIMIT 1", [r.dancer_id]);
    } catch (e) { /* pre-migration */ }

    if (contested) r.reason = 'contested dancer claim — a studio must not decide this';
    else if (!studio) r.reason = 'no studio on the submission';
    else if (studio.is_independent) r.reason = 'independent dancer — no studio owner exists';
    else if (!studio.owner_id) r.reason = `${studio.name} is unclaimed — nobody would ever see this`;
    else continue; // a real studio owner has it; not AwardHome's problem

    out.push(r);
  }
  return out;
}

async function listForUser(userId) {
  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const rows = await sdb.all(
    'SELECT * FROM award_submissions WHERE user_id = ? ORDER BY created_at DESC, id DESC',
    [userId]);
  return decorate(db, rows);
}

// Cast names for a set of submissions, in one query — the private view lists
// them under each pending row.
async function castForSubmissions(ids) {
  if (!ids.length) return new Map();
  const sdb = await openSubmissionsDb();
  const rows = await sdb.all(
    `SELECT submission_id, name FROM award_submission_dancers
     WHERE submission_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.submission_id)) map.set(r.submission_id, []);
    map.get(r.submission_id).push(r.name);
  }
  return map;
}

module.exports = {
  GROUP_SIZES, GROUP_SIZE_BY_KEY, LIMITS,
  normalizeText, normalizePersonName, nameKey,
  checkRateLimit, recordAction, consumeHouseholdAction,
  dancerStudios, resolveEventRef, validateSubmission, createSubmission,
  listForDancer, listForUser, listForStudio, listForReview, castForSubmissions,
};
