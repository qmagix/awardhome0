// Encode each org's PUBLISHED award hierarchy into awards.is_top_award,
// replacing cross-org keyword guessing. Rules come from docs/org_top_awards.md
// (verified against each org's website) and docs/major_award_policy.md.
//
// Tiers (docs/major_award_policy.md §3):
//   T1 headline   — grand champions, title winners
//   T2 overall    — division-wide high-point rankings (NOT narrow-category
//                   placements: a category can be nearly uncontested, which is
//                   why orgs themselves scale award depth to entry count)
//   T3 special    — named judges'/studio honors
// Bands and opportunities (invitations, convention scholarships) are excluded,
// and wrongly-flagged bands get UNFLAGGED.
//
// Usage: node scripts/encode_top_awards.js [--apply] [--t2-depth=1|3] [--org=kar]

const { openDb } = require('../database');

const T2_DEPTH = (() => {
  const a = process.argv.find(x => x.startsWith('--t2-depth='));
  return a ? parseInt(a.split('=')[1], 10) : 1;
})();
const KAR_T2_PLACES = ["'1st'", "'2nd'", "'3rd'"].slice(0, T2_DEPTH).join(',');
const SP_T2_PLACES = ["'1'", "'2'", "'3'"].slice(0, T2_DEPTH).join(',');

const RULES = {
  kar: [
    { tier: 'T1', name: 'National Grand Champion (winner only)',
      sql: `LOWER(a.award_type) LIKE '%grand champion%' AND a.place = 'Winner'` },
    { tier: 'T1', name: 'Title winner (Mr./Miss Dance) — place repeats the title',
      sql: `(LOWER(a.award_type) LIKE '%miss%dance%' OR LOWER(a.award_type) LIKE '%mr%dance%')
            AND LOWER(TRIM(a.place)) = LOWER(TRIM(a.award_type))` },
    { tier: 'T2', name: `Overall high point — Top <Level> <Size> <Age>, places ${KAR_T2_PLACES}`,
      sql: `LOWER(a.award_type) LIKE 'top %' AND a.place IN (${KAR_T2_PLACES})` },
    { tier: 'T3', name: 'Named specials (Studio/Choreographer of the Year, Future Star, Spirit, Excellence)',
      sql: `(LOWER(a.award_type) LIKE '%studio of the year%'
             OR LOWER(a.award_type) LIKE '%choreographer of the year%'
             OR LOWER(a.award_type) LIKE '%future star%'
             OR LOWER(a.award_type) LIKE '%studio spirit%'
             OR LOWER(a.award_type) LIKE '%studio of excellence%')` },
    // Corrections: these were flagged is_top_award=1 but are NOT awards.
    { tier: 'UNFLAG', name: 'Adjudication bands wrongly flagged (Elite Ultimate Performance etc.)',
      sql: `(LOWER(a.award_type) IN ('elite ultimate performance','elite top first place','top first place','first place')
             OR LOWER(a.award_type) LIKE '%convention scholarship%'
             OR LOWER(a.award_type) LIKE '%all star dancers invitation%')` },
  ],
  starpower: [
    { tier: 'T1', name: 'SDA Champion (division champion)',
      sql: `LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '%sda champion%'` },
    { tier: 'T1', name: 'Performance of the Year',
      sql: `LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '%performance of the year%'` },
    // Title rows carry the whole contest: place '1' is the title winner,
    // '2'/'3' are runner-ups (verified in the data) — only the winner is T1.
    { tier: 'T1', name: 'Title WINNER only (place 1; runner-ups excluded)',
      sql: `(LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '%miss star%'
             OR LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '%mr star%'
             OR LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '% title%')
            AND a.place = '1'` },
    { tier: 'T2', name: `Division tables (Level rows), places ${SP_T2_PLACES}`,
      sql: `LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '%level%'
            AND a.place IN (${SP_T2_PLACES})` },
    { tier: 'UNFLAG', name: 'Invitations & spotlight callbacks (opportunities, not placements)',
      sql: `(LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '%power pak invite%'
             OR LOWER(COALESCE(NULLIF(a.award_type,''), a.category)) LIKE '%discovery spotlight%')` },
  ],
};

async function main() {
  const apply = process.argv.includes('--apply');
  const only = (process.argv.find(x => x.startsWith('--org=')) || '').split('=')[1];
  const db = await openDb();

  for (const [slug, rules] of Object.entries(RULES)) {
    if (only && only !== slug) continue;
    const org = await db.get('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (!org) { console.log(`${slug}: org not found`); continue; }
    const before = await db.get(
      `SELECT COUNT(*) n FROM awards a JOIN events e ON e.id = a.event_id WHERE e.org_id = ? AND a.is_top_award = 1`, [org.id]);
    console.log(`\n=== ${slug} (currently flagged: ${before.n})`);
    // Reset this org first so encoding is deterministic: editing a rule can
    // only ever produce exactly what the rules below say.
    if (apply) {
      await db.run(
        `UPDATE awards SET is_top_award = 0, top_award_tier = NULL
         WHERE id IN (SELECT a.id FROM awards a JOIN events e ON e.id = a.event_id WHERE e.org_id = ?)`, [org.id]);
    }

    for (const r of rules) {
      const set = r.tier === 'UNFLAG' ? 0 : 1;
      const count = await db.get(
        `SELECT COUNT(*) n FROM awards a JOIN events e ON e.id = a.event_id
         WHERE e.org_id = ? AND (${r.sql})`, [org.id]);
      const changing = await db.get(
        `SELECT COUNT(*) n FROM awards a JOIN events e ON e.id = a.event_id
         WHERE e.org_id = ? AND (${r.sql}) AND IFNULL(a.is_top_award, 0) != ?`, [org.id, set]);
      console.log(`  ${r.tier.padEnd(6)} ${String(count.n).padStart(7)} rows (${changing.n} change) — ${r.name}`);
      if (apply && changing.n) {
        const tier = r.tier === 'UNFLAG' ? null : parseInt(r.tier.slice(1), 10);
        await db.run(
          `UPDATE awards SET is_top_award = ?, top_award_tier = ?
           WHERE id IN (SELECT a.id FROM awards a JOIN events e ON e.id = a.event_id
                        WHERE e.org_id = ? AND (${r.sql}))`, [set, tier, org.id]);
      }
    }
    if (apply) {
      const after = await db.all(
        `SELECT a.top_award_tier t, COUNT(*) n FROM awards a JOIN events e ON e.id = a.event_id
         WHERE e.org_id = ? AND a.is_top_award = 1 GROUP BY a.top_award_tier ORDER BY t`, [org.id]);
      const total = after.reduce((s2, x) => s2 + x.n, 0);
      console.log(`  => now flagged: ${total} (was ${before.n}) — ` + after.map(x => `T${x.t}:${x.n}`).join(' '));
    }
  }
  if (!apply) console.log('\nDry run — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
