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

// Rule 2, as of M4: the CONVERGENCE lookup, not an exact match.
//
// Two households describing one win rarely type it identically — "1st" and
// "1" and "First", one filling in the category and the other leaving it
// blank. utils/convergence.js folds those together while keeping genuinely
// different awards on the same routine apart. An exact match, which is what
// M3 shipped, turned each cosmetic difference into a duplicate award.
const {
  findConvergentAward, enrichment, findCorroborating, awardIdentity, identityCompatible,
} = require('./convergence');

async function findExistingAward(db, s) {
  return findConvergentAward(db, s);
}

// Confirm a submission and write the canonical award.
//
// Returns { ok, awardId, created, reason }. `reason` is a machine code the
// router turns into a sentence: 'event_pending', 'tombstoned',
// 'dancer_missing', 'already_decided'.
// `level` is the verification tier the resulting award carries, and the two
// automatic callers use it rather than pretending a human decided:
//   studio_confirmed  a reviewer clicked confirm (the default)
//   corroborated      two unrelated households described the same result
//   family_submitted  an independent dancer's submission, auto-approved
//                     because there is no studio owner to review it — honest
//                     labelling, and held out of competitive aggregates
//                     until something corroborates it (design §6.2.3)
const VERIFICATION_LEVELS = ['family_submitted', 'corroborated', 'studio_confirmed', 'source_verified'];

async function confirmSubmission({ submissionId, reviewerId = null, corrections = {}, note = null,
  level = 'studio_confirmed', db: dbIn, sdb: sdbIn } = {}) {
  if (!VERIFICATION_LEVELS.includes(level)) level = 'studio_confirmed';
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
      // Convergence ENRICHES: the second household fills in the category the
      // first left blank. It never overwrites a value the archive already
      // holds — organizer data and earlier reviewer decisions outrank a later
      // family description.
      const fill = enrichment(existing, s);
      const cols = Object.keys(fill);
      if (cols.length) {
        await db.run(
          `UPDATE awards SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
          [...cols.map(c => fill[c]), awardId]);
      }
      // Trust only ever climbs. An independent's auto-approved award sitting
      // at family_submitted becomes corroborated the moment an unrelated
      // household describes the same result, and studio_confirmed when a
      // director signs off — but a later, weaker confirmation never demotes
      // an award that already earned a higher tier.
      const cur = await db.get('SELECT verification_status FROM awards WHERE id = ?', [awardId]);
      const curRank = VERIFICATION_LEVELS.indexOf(cur && cur.verification_status);
      if (VERIFICATION_LEVELS.indexOf(level) > curRank) {
        await db.run('UPDATE awards SET verification_status = ? WHERE id = ?', [level, awardId]);
      }
    } else {
      const res = await db.run(`
        INSERT INTO awards (event_id, place, performance_name, performance_name_key, award_type,
                            category, age_division, dancer_id, studio_id, notes,
                            is_self_added, verification_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [s.event_id, s.place, s.performance_name, s.performance_name_key, s.award_type,
         s.category, s.age_division, isSolo ? s.dancer_id : null, s.studio_id, s.notes, level]);
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
      VALUES (?, 'family_submission', ?, ?, ?, ?, datetime('now'), ?)`,
      [awardId, s.id, s.user_id, level, reviewerId, note]);

    // Card content the family attached at submission time (M7). It could not
    // be written earlier because there was no award to hang it on — and there
    // might never have been one. It lands at status 'pending', which puts it
    // in exactly the same moderation path as content added from the web:
    // photos wait for the studio (M3), notes for the superadmin queue.
    // Nothing here publishes anything.
    const card = await sdb.get(
      'SELECT * FROM award_submission_card_content WHERE submission_id = ?', [s.id]);
    if (card) {
      if (card.photo_object_key) {
        await db.run(`
          INSERT OR IGNORE INTO award_card_photos (award_id, dancer_id, photo_url, status, uploaded_by)
          VALUES (?, ?, ?, 'pending', ?)`,
          [awardId, s.dancer_id, card.photo_object_key, s.user_id]);
        // The one-time consent affirmation, recorded where the web flow
        // records it, so a family is not asked twice for the same dancer.
        if (card.consent_affirmed) {
          await db.run(
            'INSERT OR IGNORE INTO card_photo_consents (user_id, dancer_id) VALUES (?, ?)',
            [s.user_id, s.dancer_id]);
        }
      }
      if (card.thank_you_note) {
        await db.run(`
          INSERT OR IGNORE INTO award_acknowledgements (award_id, dancer_id, message, status, created_by)
          VALUES (?, ?, ?, 'pending', ?)`,
          [awardId, s.dancer_id, card.thank_you_note, s.user_id]);
      }
    }

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
    SET status = 'accepted', award_id = ?, verification_level = ?,
        reviewer_user_id = ?, reviewer_note = ?, decided_at = CURRENT_TIMESTAMP,
        performance_name_key = ?, updated_at = CURRENT_TIMESTAMP
        ${setCorrections.length ? ', ' + setCorrections.join(', ') : ''}
    WHERE id = ?`,
    [awardId, level, reviewerId, note, s.performance_name_key,
     ...CORRECTABLE.filter(f => f in corrections).map(f => s[f]), s.id]);

  // Decisions are worth a notification; nothing else is (design §13).
  // Fire-and-forget: a push that fails must never undo a published award.
  try {
    const dancer = await db.get('SELECT name FROM dancers WHERE id = ?', [s.dancer_id]);
    require('./push').submissionAccepted(s.user_id, {
      routine: s.performance_name, dancerName: dancer ? dancer.name : 'your dancer',
      submissionId: s.id,
    }).catch(() => {});
  } catch (e) { /* never blocks the decision */ }

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
  try {
    const full = await sdb.get('SELECT user_id, performance_name FROM award_submissions WHERE id = ?', [submissionId]);
    if (full) {
      require('./push').submissionRejected(full.user_id, {
        routine: full.performance_name, note, submissionId,
      }).catch(() => {});
    }
  } catch (e) { /* never blocks the decision */ }
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
  try {
    const full = await sdb.get('SELECT user_id, performance_name FROM award_submissions WHERE id = ?', [submissionId]);
    if (full) {
      require('./push').submissionNeedsInfo(full.user_id, {
        routine: full.performance_name, note, submissionId,
      }).catch(() => {});
    }
  } catch (e) { /* never blocks the decision */ }
  return { ok: true };
}

// ---- Automatic promotion (M4) ----------------------------------------------
//
// Two paths reach canonical without a reviewer clicking anything. Both are
// design decisions, not shortcuts, and both label honestly rather than
// pretending a human decided.

// An independent dancer's submission has NO studio owner to review it — that
// is what "independent" means here, and the §7.1 reviewer economics simply do
// not apply. Detected on the data, not on a name: the M1 migration gives every
// independent a synthetic studio flagged is_independent.
async function isIndependentSubmission(db, s) {
  if (!s.studio_id) return true;
  const studio = await db.get('SELECT COALESCE(is_independent, 0) AS ind, owner_id FROM studios WHERE id = ?', [s.studio_id]);
  return !studio || !!studio.ind;
}

// Anomalies still queue. Auto-approval is the DEFAULT for independents, never
// an override for conflicting facts (design §6.2.3) — so a dancer whose
// ownership is being fought over does not get their record published by the
// dispute itself.
async function hasAnomaly(db, s) {
  try {
    const contested = await db.get(
      "SELECT 1 AS x FROM dancer_claims WHERE dancer_id = ? AND status = 'contested' LIMIT 1", [s.dancer_id]);
    if (contested) return 'contested_dancer';
  } catch (e) { /* pre-migration */ }
  return null;
}

// Called after a family submission is created. Returns what it promoted and
// why, so the caller can tell the family honestly what happened.
async function runAutoPromotion({ submissionId, db: dbIn, sdb: sdbIn } = {}) {
  const db = dbIn || await openDb();
  const sdb = sdbIn || await openSubmissionsDb();

  const s = await sdb.get('SELECT * FROM award_submissions WHERE id = ?', [submissionId]);
  if (!s || s.status !== 'submitted') return { promoted: [], reason: 'not_pending' };
  // Both automatic paths need a settled event. A family-created candidate has
  // to be confirmed first — rule 4 holds for machines as firmly as for people.
  if (!s.event_id) return { promoted: [], reason: 'event_pending' };

  const anomaly = await hasAnomaly(db, s);
  if (anomaly) return { promoted: [], reason: anomaly };

  // Path 1 — independent: publish immediately, label family_submitted.
  if (await isIndependentSubmission(db, s)) {
    const r = await confirmSubmission({ submissionId: s.id, level: 'family_submitted', db, sdb });
    return { promoted: r.ok ? [s.id] : [], reason: r.ok ? 'independent' : r.reason };
  }

  // Path 2 — corroboration: unrelated households, neither able to see the
  // other's entry, describing the same result. The cheapest trust signal
  // available, and what makes a group routine's cast fill in over a season
  // without any single parent typing eight names.
  const mates = await findCorroborating(sdb, s);
  if (!mates.length) return { promoted: [], reason: 'awaiting_review' };

  const promoted = [];
  // An already-accepted mate means the award exists; this submission
  // converges onto it. Otherwise both are promoted together — each is the
  // other's corroboration.
  const settled = mates.find(m => m.status === 'accepted' && m.award_id);
  const partners = settled ? [s] : [mates.find(m => m.status === 'submitted' && m.event_id), s].filter(Boolean);

  for (const p of partners) {
    const r = await confirmSubmission({ submissionId: p.id, level: 'corroborated', db, sdb });
    if (r.ok) promoted.push(p.id);
  }
  return { promoted, reason: promoted.length ? 'corroborated' : 'awaiting_review' };
}

// Competitive aggregates — leaderboards, top-studio and top-dancer rankings —
// exclude awards still sitting at `family_submitted` (design §6.2.3).
//
// Appearing in your own trophy case is a different claim from being ranked
// against reviewed data. An independent's auto-approved award is real and
// public immediately; it starts counting in rankings once something
// corroborates it, which costs nothing in eventual trust and only changes
// latency. Written to survive a LEFT JOIN: a row with no award at all reads
// as '' and stays.
function rankableAwardSql(alias = 'a') {
  return `COALESCE(${alias}.verification_status, '') != 'family_submitted'`;
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
  CORRECTABLE, REASON_TEXT, VERIFICATION_LEVELS,
  applyCorrections, findExistingAward,
  confirmSubmission, rejectSubmission, requestInfo,
  isIndependentSubmission, hasAnomaly, runAutoPromotion, rankableAwardSql,
};
