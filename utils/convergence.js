// Convergence — two households describing the same win reach ONE award
// (mobile design v2 §7.3, development plan M4).
//
// Two parents at the same competition will both submit *Small Group —
// Fireworks — 1st*. Neither can see the other's entry. If that produces two
// canonical awards, the archive has quietly gained a duplicate and each
// dancer's trophy case tells half the story. Keyed on the routine at the
// event for the studio, it is one award with two dancer links.
//
// WHY THIS IS MORE THAN find-before-create. M3 already reused an award
// matching (event, studio, routine key, place, category, award_type)
// EXACTLY. Real families do not type exactly: "1st", "1", "First", "1st
// Place". And one parent fills in the category while the other leaves it
// blank. Exact matching turns each of those into a second award.
//
// TWO RULES DO THE WORK:
//
//   NORMALISE, DON'T GUESS. "1st"/"1"/"first place" fold to one key. Text
//   fields fold on case, punctuation and whitespace. Nothing semantic is
//   inferred — "Teen Contemporary" and "Contemporary Teen" stay different,
//   because deciding they are the same is a judgement no normaliser should
//   make silently.
//
//   ABSENCE IS NOT DISAGREEMENT. A field one household left blank matches a
//   field the other filled in, and promotion then fills the blank. A field
//   BOTH filled with different values is a real difference and separates the
//   awards. This is what keeps a routine's "1st in Teen Contemporary" and its
//   "Overall High Score" as the two distinct awards they are, while still
//   merging two descriptions of one win.
const { routineKeySql } = require('./routineKey');

// Ordinal placements as families type them. Everything numeric folds to the
// bare number; everything else folds to trimmed lowercase text, so "Platinum"
// and "platinum" converge and "Platinum" and "High Gold" do not.
function placementKey(raw) {
  if (raw == null) return null;
  let s = String(raw).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const WORDS = {
    first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
    sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
  };
  s = s.replace(/\bplace\b/g, '').replace(/\s+/g, ' ').trim();
  if (WORDS[s]) return WORDS[s];
  const ord = s.match(/^(\d+)\s*(st|nd|rd|th)?$/);
  if (ord) return ord[1];
  return s.replace(/[^a-z0-9]+/g, ' ').trim() || null;
}

// Free-text fields (category, award type, age division). Case, punctuation
// and spacing only — never word order, never synonyms.
function textKey(raw) {
  if (raw == null) return null;
  const s = String(raw).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return s || null;
}

// The identity of an award WITHIN a routine at an event: what distinguishes
// "1st in Teen Contemporary" from "Overall High Score" on the same routine.
function awardIdentity(row) {
  return {
    place: placementKey(row.place),
    category: textKey(row.category),
    award_type: textKey(row.award_type),
  };
}

// Compatible = the same award, described by two people. Every field both
// sides filled in must agree; a field either side left blank is silent, not
// contradictory.
function identityCompatible(a, b) {
  for (const f of ['place', 'category', 'award_type']) {
    if (a[f] != null && b[f] != null && a[f] !== b[f]) return false;
  }
  return true;
}

// How much the two descriptions actually agreed on — used to prefer the
// best-matching candidate when a routine carries several awards and the new
// submission is compatible with more than one. Ties go to the row with more
// filled-in fields, which is the more completely described award.
function identityScore(a, b) {
  let agreed = 0;
  for (const f of ['place', 'category', 'award_type']) {
    if (a[f] != null && b[f] != null && a[f] === b[f]) agreed++;
  }
  return agreed;
}

// The convergence key from the design: (event, routine, studio, group size).
// Group size is not stored on `awards`, so it cannot be part of the SQL
// lookup — it is carried by the SUBMISSION and enforced upstream by the write
// path (a solo and a group of the same routine take different paths and
// therefore cannot collide here).
function convergenceKey(s) {
  return [s.event_id, s.performance_name_key, s.studio_id, s.group_size].join('|');
}

// Every canonical award for this routine at this event for this studio, with
// its identity resolved. Small by construction: one routine at one event
// rarely carries more than a handful of awards.
async function candidateAwards(db, s) {
  if (!s.event_id) return [];
  return db.all(`
    SELECT id, dancer_id, place, category, award_type, age_division
    FROM awards
    WHERE event_id = ?
      AND IFNULL(studio_id, -1) = IFNULL(?, -1)
      AND ${routineKeySql('awards')} = IFNULL(?, '')`,
    [s.event_id, s.studio_id, s.performance_name_key]);
}

// The award this submission belongs on, or null. Returns the best-scoring
// compatible candidate — see identityScore for why "best" and not "first".
async function findConvergentAward(db, s) {
  const wanted = awardIdentity(s);
  const rows = await candidateAwards(db, s);
  let best = null, bestScore = -1;
  for (const r of rows) {
    const got = awardIdentity(r);
    if (!identityCompatible(wanted, got)) continue;
    const score = identityScore(wanted, got);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

// Fields the submission knows and the award does not. Convergence enriches:
// the second household fills in the category the first one left blank. It
// NEVER overwrites a value the archive already holds — published organizer
// data and earlier reviewer decisions outrank a later family description.
function enrichment(award, s) {
  const fill = {};
  for (const f of ['place', 'category', 'award_type', 'age_division']) {
    const have = award[f] == null || String(award[f]).trim() === '';
    if (have && s[f] != null && String(s[f]).trim() !== '') fill[f] = s[f];
  }
  return fill;
}

// Other households' submissions describing this same result. Corroboration
// requires a DIFFERENT household AND a DIFFERENT dancer:
//   * different household, because a family agreeing with itself is not
//     independent evidence;
//   * different dancer, because two accounts submitting for the SAME dancer
//     is a contested-ownership signal, not a corroboration — routing that to
//     auto-promotion would let a claim dispute publish itself.
async function findCorroborating(sdb, s) {
  const rows = await sdb.all(`
    SELECT * FROM award_submissions
    WHERE id != ?
      AND IFNULL(event_id, -1) = IFNULL(?, -1)
      AND IFNULL(event_candidate_id, -1) = IFNULL(?, -1)
      AND IFNULL(performance_name_key, '') = IFNULL(?, '')
      AND IFNULL(studio_id, -1) = IFNULL(?, -1)
      AND group_size = ?
      AND user_id != ?
      AND dancer_id != ?
      AND status IN ('submitted', 'accepted')
      -- A pending claimant's entry cannot corroborate anyone (M8). This is
      -- the direction that is easy to miss: blocking only HER promotion
      -- would still let her row promote a stranger's submission, since
      -- corroboration promotes BOTH partners. Whether she is really that
      -- child's parent is unanswered, so her agreement is not yet evidence.
      AND IFNULL(unverified_household, 0) = 0
    ORDER BY created_at ASC`,
    [s.id, s.event_id, s.event_candidate_id, s.performance_name_key,
     s.studio_id, s.group_size, s.user_id, s.dancer_id]);

  const wanted = awardIdentity(s);
  return rows.filter(r => identityCompatible(wanted, awardIdentity(r)));
}

module.exports = {
  placementKey, textKey, awardIdentity, identityCompatible, identityScore,
  convergenceKey, candidateAwards, findConvergentAward, enrichment, findCorroborating,
};
