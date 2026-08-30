// Owner-tunable award emphasis (Q, 2026-08-30).
//
// Three deliberate boundaries:
//  1. PRIVATE ONLY. Weights never touch the public "Major Awards" figure —
//     that stays the platform-wide rule in utils/majorAward.js. A studio
//     cannot inflate a public claim, so nobody has a motive to lie here.
//  2. USEFUL TO THE OWNER. Weights drive their private "Your highlights"
//     count and, more visibly, how the AI writes their award summary —
//     which gives them a reason to weight ACCURATELY rather than highly.
//  3. USEFUL IN AGGREGATE. Because (1) removes the incentive to inflate and
//     (2) rewards honesty, the pooled weights across studios are a credible
//     signal of what the field actually considers prestigious — feeding the
//     canonical classification (docs/org_top_awards.md, admin award vocab)
//     instead of us guessing from keyword heuristics.

const WEIGHTS = { 0: 'Not notable', 1: 'Normal', 2: 'Notable', 3: 'Headline' };
const DEFAULT_WEIGHT = 1;

async function ensureAwardWeightTable(db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS studio_award_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      award_term TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(studio_id, award_term)
    )`);
}

// The term a weight attaches to: the award's own name, normalized. Kept
// coarse on purpose so one decision covers every year and event.
function awardTerm(award) {
  const raw = award.award_type || award.category || '';
  return String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
}

async function weightsForStudio(db, studioId) {
  await ensureAwardWeightTable(db);
  const rows = await db.all(
    'SELECT award_term, weight FROM studio_award_weights WHERE studio_id = ?', [studioId]);
  const map = new Map();
  for (const r of rows) map.set(r.award_term, r.weight);
  return map;
}

const weightOf = (map, award) => {
  const w = map.get(awardTerm(award));
  return Number.isInteger(w) ? w : DEFAULT_WEIGHT;
};

module.exports = { WEIGHTS, DEFAULT_WEIGHT, ensureAwardWeightTable, awardTerm, weightsForStudio, weightOf };
