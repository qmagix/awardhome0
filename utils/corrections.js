// Correction proposals — "something is wrong with this award"
// (mobile design v2 §6.8, development plan M4).
//
// A family never directly edits an imported canonical fact. Published
// organizer data stays authoritative; a family's correction is a PROPOSAL
// carrying the current value, the proposed value, and a reason, decided by a
// reviewer with an audit trail. That asymmetry is the whole point: families
// add missing facts freely, but changing a fact the archive already holds
// needs a second pair of eyes.
//
// Field-level, not whole-row, so a reviewer can accept the placement fix
// without also accepting a category change they disagree with.
const { normalizeText } = require('./submissions');
const { canonicalizeRoutine } = require('./routineKey');

// Only the descriptive fields. Deliberately NOT correctable here:
//   event_id / studio_id  — moving an award to a different competition or
//                           studio is a re-filing, not a correction, and
//                           would silently move it between public pages;
//   dancer links          — that is the claim/removal flow, which already has
//                           tombstones and its own review;
//   verification_status   — trust is earned by the ladder, never asserted.
const CORRECTABLE_FIELDS = {
  performance_name: 'Routine name',
  place: 'Placement',
  award_type: 'Award',
  category: 'Category',
  age_division: 'Age division',
};

function fieldLabel(field) {
  return CORRECTABLE_FIELDS[field] || field;
}

// Anyone may only propose against an award their own dancer is actually on —
// the same standing rule as objecting to a card photo. A stranger correcting
// other people's records is not a workflow this product wants.
async function canPropose(db, userId, awardId, dancerId) {
  const link = await db.get(`
    SELECT 1 AS x FROM dancers d
    WHERE d.id = ? AND d.claimed_by_user_id = ?
      AND (EXISTS (SELECT 1 FROM award_dancers ad WHERE ad.award_id = ? AND ad.dancer_id = d.id)
           OR EXISTS (SELECT 1 FROM awards a WHERE a.id = ? AND a.dancer_id = d.id))`,
    [dancerId, userId, awardId, awardId]);
  return !!link;
}

async function propose(db, { awardId, dancerId, userId, field, proposedValue, reason }) {
  if (!CORRECTABLE_FIELDS[field]) return { ok: false, reason: 'bad_field' };
  const award = await db.get('SELECT * FROM awards WHERE id = ?', [awardId]);
  if (!award) return { ok: false, reason: 'not_found' };

  const proposed = normalizeText(proposedValue);
  const current = award[field] == null ? null : String(award[field]);
  if (proposed === current) return { ok: false, reason: 'no_change' };

  // One open proposal per (award, field, household). A second one is the same
  // person saying the same thing louder, and it would double a reviewer's work.
  const dup = await db.get(
    "SELECT id FROM award_corrections WHERE award_id = ? AND field = ? AND submitted_by = ? AND status = 'open'",
    [awardId, field, userId]);
  if (dup) return { ok: false, reason: 'already_open', correctionId: dup.id };

  const res = await db.run(`
    INSERT INTO award_corrections (award_id, dancer_id, field, current_value, proposed_value, reason, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [awardId, dancerId, field, current, proposed, normalizeText(reason), userId]);
  return { ok: true, correctionId: res.lastID };
}

// Accept: apply the field and record WHY the archive changed. The award and
// its provenance move in one transaction — a changed fact with no record of
// who changed it is exactly the state provenance exists to prevent.
//
// Refuses if the value has moved since the proposal was filed: the reviewer
// would be overwriting something the family never saw, which is a different
// decision from the one they are being asked to make.
async function accept(db, { correctionId, reviewerId, note = null, force = false }) {
  const c = await db.get("SELECT * FROM award_corrections WHERE id = ? AND status = 'open'", [correctionId]);
  if (!c) return { ok: false, reason: 'not_found' };
  if (!CORRECTABLE_FIELDS[c.field]) return { ok: false, reason: 'bad_field' };

  const award = await db.get('SELECT * FROM awards WHERE id = ?', [c.award_id]);
  if (!award) return { ok: false, reason: 'award_missing' };

  const nowValue = award[c.field] == null ? null : String(award[c.field]);
  if (!force && nowValue !== c.current_value) return { ok: false, reason: 'value_moved', nowValue };

  await db.run('BEGIN IMMEDIATE');
  try {
    await db.run(`UPDATE awards SET ${c.field} = ? WHERE id = ?`, [c.proposed_value, c.award_id]);
    // The routine key is derived, so a routine-name correction has to re-derive
    // it or every later convergence lookup misses this award.
    if (c.field === 'performance_name') {
      await db.run('UPDATE awards SET performance_name_key = ? WHERE id = ?',
        [canonicalizeRoutine(c.proposed_value), c.award_id]);
    }
    await db.run(`
      INSERT INTO award_provenance (award_id, source_type, contributor_user_id, verification_level,
                                    decided_by, decided_at, note)
      VALUES (?, 'correction', ?, 'studio_confirmed', ?, datetime('now'), ?)`,
      [c.award_id, c.submitted_by, reviewerId,
       `${fieldLabel(c.field)}: ${c.current_value || '(blank)'} → ${c.proposed_value || '(blank)'}${note ? ' — ' + note : ''}`]);
    await db.run(`
      UPDATE award_corrections
      SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?
      WHERE id = ?`, [reviewerId, note, correctionId]);
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
  return { ok: true };
}

async function reject(db, { correctionId, reviewerId, note = null }) {
  const res = await db.run(`
    UPDATE award_corrections
    SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?
    WHERE id = ? AND status = 'open'`, [reviewerId, note, correctionId]);
  return { ok: !!res.changes };
}

// Open proposals with enough context to decide without opening another tab.
async function listOpen(db, { limit = 200 } = {}) {
  try {
    return await db.all(`
      SELECT c.*, a.performance_name, a.place AS award_place, a.studio_id,
             e.name AS event_name, e.year AS event_year,
             d.name AS dancer_name, d.unique_id AS dancer_uid,
             s.name AS studio_name, s.owner_id AS studio_owner_id,
             u.email AS submitter_email
      FROM award_corrections c
      JOIN awards a ON a.id = c.award_id
      LEFT JOIN events e ON e.id = a.event_id
      LEFT JOIN dancers d ON d.id = c.dancer_id
      LEFT JOIN studios s ON s.id = a.studio_id
      LEFT JOIN users u ON u.id = c.submitted_by
      WHERE c.status = 'open'
      ORDER BY c.created_at ASC
      LIMIT ?`, [limit]);
  } catch (e) {
    return []; // table missing until `node database.js` runs
  }
}

const CORRECTION_REASON_TEXT = {
  bad_field: 'That field cannot be corrected here.',
  not_found: 'That correction no longer exists.',
  award_missing: 'That award no longer exists.',
  no_change: 'That is the value already on the award.',
  already_open: 'You already have an open correction for that field.',
  value_moved: 'The award has changed since this was proposed, so accepting would overwrite something ' +
    'the family never saw. Review the new value before deciding.',
};

module.exports = {
  CORRECTABLE_FIELDS, CORRECTION_REASON_TEXT,
  fieldLabel, canPropose, propose, accept, reject, listOpen,
};
