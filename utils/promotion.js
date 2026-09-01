// Promotion — the one place a family submission becomes a canonical award
// (mobile design v2 §7.2, development plan M3).
//
// Everything before this point was staging: submissions and event candidates
// live in their own SQLite file and touch nothing the public can see. This
// module is the door, and it is the only door. It runs behind a reviewer —
// the studio owner who knows the routine, or an AwardHome reviewer for what a
// studio cannot decide.
//
// FIVE RULES, each of them a scar from real data:
//
//  1. THE WRITE PATH FOLLOWS THE DECLARED GROUP SIZE, not a guess. A solo
//     double-writes awards.dancer_id AND the junction; a group writes the
//     junction only. The 2026-08-31 repair had to seat 79,181 solo primary
//     dancers importers never wrote, and 1,874 group awards still carry
//     exactly one linked dancer — indistinguishable from a solo unless the
//     format was recorded. The family told us the format; that is a stronger
//     positive identification than utils/soloPrimary.js can infer from a
//     label, which is why solos are written directly here.
//
//  2. FIND BEFORE CREATE. Idempotency is mandatory in this codebase
//     (CLAUDE.md), and it is also what makes promotion safe to retry across
//     two SQLite files that cannot share a transaction. An award matching
//     (event, studio, routine key, place, category, award_type) is reused and
//     the dancer linked to it — which is also how a second household's
//     submission for the same routine converges onto ONE award instead of
//     minting a second.
//
//  3. TOMBSTONES ARE NEVER RESURRECTED. If a director removed this dancer
//     from this routine, no confirmation re-adds them — the promotion is
//     refused and says why. "I deleted that and the sync brought it back" is
//     the surprise award_dancer_removals exists to prevent, and a reviewer
//     clearing it deliberately is a different act from a reviewer clicking
//     confirm.
//
//  4. NO CANONICAL AWARD WITHOUT A CANONICAL EVENT. A submission whose event
//     is still a family-created candidate cannot promote: awards.event_id
//     points at the canonical table. The reviewer is told to settle the event
//     first at /admin/event-candidates.
//
//  5. TYPED CAST NAMES NEVER BECOME PEOPLE. A family naming teammates is
//     evidence for a reviewer, not authority to create dancer profiles.
//     Inventing identity from a name is the failure this whole design avoids.
const { openDb } = require('../database');
const { openSubmissionsDb } = require('./submissionsDb');
const { canonicalizeRoutine } = require('./routineKey');
const { GROUP_SIZE_BY_KEY, normalizeText, normalizePersonName } = require('./submissions');

// A reviewer may correct what the family typed before confirming — that is the
// "correct" in confirm / correct / reject. Corrections are re-normalised
// server-side like any other input and stored back on the submission, while
// raw_payload keeps the family's original words.
const CORRECTABLE = ['performance_name', 'place', 'award_type', 'category', 'age_division',
  'teacher', 'choreographer'];

function applyCorrections(submission, corrections = {}) {
  const out = { ...submission };
  for (const field of CORRECTABLE) {
    if (!(field in corrections)) continue;
    const norm = (field === 'teacher' || field === 'choreographer')
      ? normalizePersonName(corrections[field])
      : normalizeText(corrections[field]);
    if (norm !== undefined) out[field] = norm;
  }
  out.performance_name_key = canonicalizeRoutine(out.performance_name);
  return out;
}

// Rule 2. Match on the fields an importer would match on, so a family
// submission and a later organizer import of the same result land on one row.
async function findExistingAward(db, s) {
  return db.get(`
    SELECT id, dancer_id FROM awards
    WHERE event_id = ?
      AND IFNULL(studio_id, -1) = IFNULL(?, -1)
      AND IFNULL(performance_name_key, LOWER(TRIM(IFNULL(performance_name, '')))) = IFNULL(?, '')
      AND IFNULL(place, '') = IFNULL(?, '')
      AND IFNULL(category, '') = IFNULL(?, '')
      AND IFNULL(award_type, '') = IFNULL(?, '')
    LIMIT 1`,
    [s.event_id, s.studio_id, s.performance_name_key, s.place, s.category, s.award_type]);
}

// Confirm a submission and write the canonical award.
//
// Returns { ok, awardId, created, reason }. `reason` is a machine code the
// router turns into a sentence: 'event_pending', 'tombstoned',
// 'dancer_missing', 'already_decided'.
async function confirmSubmission({ submissionId, reviewerId, corrections = {}, note = null, db: dbIn, sdb: sdbIn } = {}) {
  const db = dbIn || await openDb();
  const sdb = sdbIn || await openSubmissionsDb();

  const raw = await sdb.get('SELECT * FROM award_submissions WHERE id = ?', [submissionId]);
  if (!raw) return { ok: false, reason: 'not_found' };

  // Idempotent: a retry after a crash between the canonical write and the
  // staging update returns the award the first attempt made.
  if (raw.status === 'accepted' && raw.award_id) {
    return { ok: true, awardId: raw.award_id, created: false, reason: 'already_decided' };
  }
  if (raw.status === 'rejected') return { ok: false, reason: 'already_decided' };

  // Rule 4.
  if (!raw.event_id) return { ok: false, reason: 'event_pending' };
  const event = await db.get('SELECT id FROM events WHERE id = ?', [raw.event_id]);
  if (!event) return { ok: false, reason: 'event_pending' };

  const dancer = await db.get('SELECT id FROM dancers WHERE id = ?', [raw.dancer_id]);
  if (!dancer) return { ok: false, reason: 'dancer_missing' };

  const s = applyCorrections(raw, corrections);
  const sizeDef = GROUP_SIZE_BY_KEY.get(s.group_size);
  // Rule 1: the family's declared format decides the path. Absent or unknown
  // is treated as a group — the conservative direction, since mistaking a
  // group for a solo is the damaging error and the reverse is not.
  const isSolo = !!(sizeDef && sizeDef.individual);

  let awardId = null;
  let created = false;

  await db.run('BEGIN IMMEDIATE');
  try {
    const existing = await findExistingAward(db, s);

    // Rule 3, checked against the award we are about to link to. Done inside
    // the transaction so a concurrent removal cannot slip past the check.
    if (existing) {
      const tomb = await db.get(
        'SELECT 1 AS x FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?',
        [existing.id, s.dancer_id]);
      if (tomb) {
        await db.run('ROLLBACK');
        return { ok: false, reason: 'tombstoned', awardId: existing.id };
      }
    }

    if (existing) {
      awardId = existing.id;
      // A solo whose primary column is still empty gets it filled — the same
      // repair utils/soloPrimary.js performs, but on first-party evidence.
      if (isSolo && !existing.dancer_id) {
        await db.run('UPDATE awards SET dancer_id = ? WHERE id = ? AND dancer_id IS NULL',
          [s.dancer_id, awardId]);
      }
    } else {
      const res = await db.run(`
        INSERT INTO awards (event_id, place, performance_name, performance_name_key, award_type,
                            category, age_division, dancer_id, studio_id, notes,
                            is_self_added, verification_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'studio_confirmed')`,
        [s.event_id, s.place, s.performance_name, s.performance_name_key, s.award_type,
         s.category, s.age_division, isSolo ? s.dancer_id : null, s.studio_id, s.notes]);
      awardId = res.lastID;
      created = true;
    }

    // The junction is written for EVERY format, solo included — that is the
    // platform's double-write convention, and the many surfaces that read the
    // junction must see this award.
    await db.run(
      `INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status, source)
       VALUES (?, ?, 'verified', 'family_submission')`,
      [awardId, s.dancer_id]);

    // Provenance, in the SAME transaction as the award — that is why this
    // table lives in the canonical database and not the staging file.
    await db.run(`
      INSERT INTO award_provenance
        (award_id, source_type, submission_id, contributor_user_id, verification_level,
         decided_by, decided_at, note)
      VALUES (?, 'family_submission', ?, ?, 'studio_confirmed', ?, datetime('now'), ?)`,
      [awardId, s.id, s.user_id, reviewerId, note]);

    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }

  // Staging update. If this half fails, a retry re-finds the same award
  // (rule 2), re-links harmlessly (INSERT OR IGNORE), and completes.
  const setCorrections = CORRECTABLE
    .filter(f => f in corrections)
    .map(f => `${f} = ?`);
  await sdb.run(`
    UPDATE award_submissions
    SET status = 'accepted', award_id = ?, verification_level = 'studio_confirmed',
        reviewer_user_id = ?, reviewer_note = ?, decided_at = CURRENT_TIMESTAMP,
        performance_name_key = ?, updated_at = CURRENT_TIMESTAMP
        ${setCorrections.length ? ', ' + setCorrections.join(', ') : ''}
    WHERE id = ?`,
    [awardId, reviewerId, note, s.performance_name_key,
     ...CORRECTABLE.filter(f => f in corrections).map(f => s[f]), s.id]);

  return { ok: true, awardId, created };
}

async function rejectSubmission({ submissionId, reviewerId, note = null, sdb: sdbIn } = {}) {
  const sdb = sdbIn || await openSubmissionsDb();
  const row = await sdb.get('SELECT status FROM award_submissions WHERE id = ?', [submissionId]);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status === 'accepted') return { ok: false, reason: 'already_decided' };
  await sdb.run(`
    UPDATE award_submissions
    SET status = 'rejected', reviewer_user_id = ?, reviewer_note = ?,
        decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`, [reviewerId, note, submissionId]);
  return { ok: true };
}

// "Ask the family" — the third button, and the one that keeps a reviewer from
// having to choose between publishing something doubtful and rejecting a real
// award. The submission stays the family's, visible to them with the question.
async function requestInfo({ submissionId, reviewerId, note = null, sdb: sdbIn } = {}) {
  const sdb = sdbIn || await openSubmissionsDb();
  const row = await sdb.get('SELECT status FROM award_submissions WHERE id = ?', [submissionId]);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status === 'accepted') return { ok: false, reason: 'already_decided' };
  await sdb.run(`
    UPDATE award_submissions
    SET status = 'needs_info', reviewer_user_id = ?, reviewer_note = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`, [reviewerId, note, submissionId]);
  return { ok: true };
}

const REASON_TEXT = {
  not_found: 'That submission no longer exists.',
  already_decided: 'That submission was already decided.',
  event_pending: 'The competition for this award is still a family-added event. ' +
    'It has to be confirmed at /admin/event-candidates before the award can be published.',
  tombstoned: 'This dancer was previously removed from this routine, so confirming would ' +
    'undo that decision. Re-add them from Group Routine Dancers first if it was a mistake.',
  dancer_missing: 'That dancer profile no longer exists.',
};

module.exports = {
  CORRECTABLE, REASON_TEXT,
  applyCorrections, findExistingAward,
  confirmSubmission, rejectSubmission, requestInfo,
};
