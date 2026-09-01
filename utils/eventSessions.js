// Event sessions — a weekend at one competition, batched (mobile design v2
// §6.7, development plan M7).
//
// After the first submission at an event, every later one that weekend carries
// the same session id: same competition, same studio, same dancers, same
// teacher, none of it re-entered. That is the ergonomic half.
//
// The other half is why the id is issued by the SERVER rather than minted on
// the device, which is a deliberate change from v1. A local-only session
// cannot survive two devices, a reinstall mid-weekend, or a parent who starts
// on a phone and finishes on a tablet — each would invent its own "weekend"
// for one event. Server-issued means:
//
//   * a reviewer can approve a whole weekend in one pass, because the
//     submissions are genuinely grouped;
//   * convergence (M4) can look across households at the same event;
//   * a client that loses its local copy asks again and rejoins the SAME
//     session instead of starting a second one — which is why get-or-create
//     is the only operation offered here.
const crypto = require('crypto');
const { openSubmissionsDb } = require('./submissionsDb');

// Sessions older than this are not reused: a family returning to the same
// annual competition next year is at a different event, and silently
// reattaching them to last year's batch would file the awards under it.
const SESSION_REUSE_DAYS = parseInt(process.env.EVENT_SESSION_REUSE_DAYS, 10) || 14;

// Get-or-create. There is deliberately no `create` — see the header.
async function openSession({ userId, eventId = null, eventCandidateId = null }) {
  if (!eventId && !eventCandidateId) return { ok: false, reason: 'event_required' };
  const sdb = await openSubmissionsDb();

  const existing = await sdb.get(`
    SELECT * FROM event_sessions
    WHERE user_id = ?
      AND IFNULL(event_id, -1) = IFNULL(?, -1)
      AND IFNULL(event_candidate_id, -1) = IFNULL(?, -1)
      AND created_at > datetime('now', ?)`,
    [userId, eventId, eventCandidateId, `-${SESSION_REUSE_DAYS} days`]);

  if (existing) {
    await sdb.run("UPDATE event_sessions SET last_used_at = datetime('now') WHERE id = ?", [existing.id]);
    return { ok: true, session: existing, created: false };
  }

  const id = crypto.randomUUID();
  try {
    await sdb.run(`
      INSERT INTO event_sessions (id, user_id, event_id, event_candidate_id, last_used_at)
      VALUES (?, ?, ?, ?, datetime('now'))`,
      [id, userId, eventId, eventCandidateId]);
  } catch (e) {
    // Lost the race against the same household on another device, or against
    // a session older than the reuse window that still holds the unique key.
    // Either way the row that exists is the right one.
    const raced = await sdb.get(`
      SELECT * FROM event_sessions
      WHERE user_id = ? AND IFNULL(event_id, -1) = IFNULL(?, -1)
        AND IFNULL(event_candidate_id, -1) = IFNULL(?, -1)`,
      [userId, eventId, eventCandidateId]);
    if (raced) return { ok: true, session: raced, created: false };
    throw e;
  }

  const session = await sdb.get('SELECT * FROM event_sessions WHERE id = ?', [id]);
  return { ok: true, session, created: true };
}

// What a session already holds — the context the Add flow carries forward, so
// the second award of a weekend asks for a routine and a placement and
// nothing else.
async function sessionContext(sessionId, userId) {
  const sdb = await openSubmissionsDb();
  const session = await sdb.get(
    'SELECT * FROM event_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!session) return null;

  const rows = await sdb.all(`
    SELECT dancer_id, studio_id, teacher, choreographer, COUNT(*) AS n
    FROM award_submissions
    WHERE event_session_id = ? AND user_id = ?
    GROUP BY dancer_id, studio_id, teacher, choreographer
    ORDER BY n DESC`, [sessionId, userId]);

  const first = rows[0] || {};
  return {
    session,
    submissionCount: rows.reduce((n, r) => n + r.n, 0),
    // Suggestions, never defaults applied silently: the family confirms them
    // on the summary screen like any other field.
    suggested: {
      dancer_id: first.dancer_id ?? null,
      studio_id: first.studio_id ?? null,
      teacher: first.teacher ?? null,
      choreographer: first.choreographer ?? null,
    },
  };
}

module.exports = { SESSION_REUSE_DAYS, openSession, sessionContext };
