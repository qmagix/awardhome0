const { openDb } = require('../database');
const { refresh } = require('./cache');

// Featured-studio auto-rotation. Published policy (see /faq/admin):
// eligibility = claimed + logo + bio; score = recent verified activity with
// time decay; capped tenure with a cooldown so the section rotates.
//
// The admin "Featured" toggle (studios.is_featured) is a manual PIN and is
// unaffected by this job — pinned studios always show first.

const SLOTS = 9;               // auto-featured studios at a time
const WINDOW_DAYS = 30;        // activity older than this is ignored
const TAU_DAYS = 10;           // decay constant: weight halves every ~7 days
const TENURE_DAYS = 14;        // max consecutive days in the featured set
const COOLDOWN_DAYS = 7;       // rest period after max tenure

// Weights favor verified, effortful actions over pumpable ones.
const WEIGHTS = {
  claim_approved: 30,          // studio claimed (admin- or auto-approved)
  awards_csv_commit: 20,       // bulk results imported
  roster_csv_commit: 15,       // roster imported
  widget_embed: 12,            // widget live on their site (deduped daily — presence, not traffic)
  award_self_report: 10,       // award self-reported
  award_claim: 8,              // dancer claimed an award at this studio
  profile_update: 8,           // profile/bio/logo edited (deduped daily)
  verification_action: 6,      // approved/denied pending verifications
  ai_summary: 4,               // generated marketing summary
};

async function computeFeaturedStudios() {
  const db = await openDb();

  // 1. Expire tenure: studios that have held a slot too long go on cooldown.
  await db.run(
    `UPDATE studios
     SET auto_feature_cooldown_until = datetime('now', '+${COOLDOWN_DAYS} days'),
         auto_featured_rank = NULL,
         auto_featured_since = NULL
     WHERE auto_featured_rank IS NOT NULL
       AND auto_featured_since <= datetime('now', '-${TENURE_DAYS} days')`
  );

  // 2. Score recent activity for eligible studios not on cooldown.
  const caseWeights = Object.entries(WEIGHTS)
    .map(([action, w]) => `WHEN '${action}' THEN ${w}`)
    .join(' ');

  const scored = await db.all(
    `SELECT s.id,
            SUM(
              (CASE sa.action ${caseWeights} ELSE 1 END) *
              exp(-(julianday('now') - julianday(sa.created_at)) / ${TAU_DAYS}.0)
            ) AS score
     FROM studios s
     JOIN studio_activity sa ON sa.studio_id = s.id
     WHERE sa.created_at > datetime('now', '-${WINDOW_DAYS} days')
       AND s.status = 'active'
       AND s.is_claimed = 1
       AND s.owner_id IS NOT NULL
       AND s.logo_url IS NOT NULL AND s.logo_url != ''
       AND s.bio IS NOT NULL AND length(s.bio) >= 20
       AND (s.auto_feature_cooldown_until IS NULL
            OR s.auto_feature_cooldown_until <= datetime('now'))
     GROUP BY s.id
     ORDER BY score DESC, s.id ASC
     LIMIT ${SLOTS}`
  );

  // 3. Assign ranks; keep auto_featured_since for studios re-selected so
  //    tenure accumulates across consecutive selections.
  const selectedIds = scored.map(r => r.id);
  await db.run('BEGIN TRANSACTION');
  try {
    if (selectedIds.length > 0) {
      const ph = selectedIds.map(() => '?').join(',');
      await db.run(
        `UPDATE studios SET auto_featured_rank = NULL, auto_featured_since = NULL
         WHERE auto_featured_rank IS NOT NULL AND id NOT IN (${ph})`,
        selectedIds
      );
    } else {
      await db.run('UPDATE studios SET auto_featured_rank = NULL, auto_featured_since = NULL WHERE auto_featured_rank IS NOT NULL');
    }
    for (let i = 0; i < scored.length; i++) {
      await db.run(
        `UPDATE studios
         SET auto_featured_rank = ?,
             auto_featured_since = COALESCE(auto_featured_since, datetime('now'))
         WHERE id = ?`,
        [i + 1, scored[i].id]
      );
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  // Background refresh: homepage picks up the new rotation within seconds
  // without any visitor paying the recompute.
  refresh('dance-home');

  return {
    selected: scored.map((r, i) => ({ rank: i + 1, studio_id: r.id, score: Math.round(r.score * 10) / 10 })),
  };
}

module.exports = { computeFeaturedStudios, WEIGHTS, SLOTS };
