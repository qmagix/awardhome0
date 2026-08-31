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
  // ---- Star Dance Alliance family: Starpower, Revolution, Believe, Imagine,
  // DreamMaker. One anatomy, one rule set — encoding them separately is how
  // Believe ended up with champions encoded but its overall placements
  // missing (and, because ANY curation makes an org "curated", the keyword
  // fallback stopped covering it too — silent loss).
  ...['starpower', 'revolution', 'believe', 'imagine', 'dreammaker'].reduce((acc, org) => {
    const name = `LOWER(COALESCE(NULLIF(a.award_type,''), a.category))`;
    acc[org] = [
      { tier: 'T1', name: 'SDA Champion (place 1 or Winner)',
        sql: `${name} LIKE '%champion%' AND a.place IN ('1','Winner')` },
      { tier: 'T1', name: 'Performance of the Year',
        sql: `${name} LIKE '%performance of the year%'` },
      { tier: 'T1', name: 'Title WINNER only (place 1; runner-ups excluded)',
        sql: `${name} LIKE '%title%' AND a.place = '1'` },
      // Division tables are identified by SHAPE, not by the word "level":
      // these orgs also name levels "Competitive", and size groups like
      // "12 & Over Grand Lines" carry no level word at all.
      { tier: 'T2', name: 'Division overall tables (size + age/level), places 1-3',
        sql: `a.place IN ('1','2','3')
              AND (${name} LIKE '%solo%' OR ${name} LIKE '%duet%' OR ${name} LIKE '%trio%'
                   OR ${name} LIKE '%group%' OR ${name} LIKE '%line%' OR ${name} LIKE '%production%')
              AND ${name} NOT LIKE '%champion%' AND ${name} NOT LIKE '%title%'
              AND ${name} NOT LIKE '%costume%' AND ${name} NOT LIKE '%outstanding%'
              AND ${name} NOT LIKE '%power pak%' AND ${name} NOT LIKE '%discovery%'
              AND ${name} NOT LIKE '%palooza%' AND ${name} NOT LIKE '%voucher%'` },
      { tier: 'T3', name: 'Named specials: Choreography / Entertainment / Costume / Outstanding-genre',
        sql: `(${name} LIKE '%choreography%' OR ${name} LIKE '%entertainment%'
               OR ${name} LIKE '%costume%' OR ${name} LIKE '%outstanding%')
              AND a.place IN ('1','Winner')` },
      { tier: 'UNFLAG', name: 'Power Pak invitations, Discovery Spotlight, vouchers',
        sql: `(${name} LIKE '%power pak%' OR ${name} LIKE '%discovery spotlight%'
               OR ${name} LIKE '%palooza%' OR ${name} LIKE '%voucher%')` },
    ];
    return acc;
  }, {}),
  // ---- Batch 2 (2026-08-30): NexStar, Rainbow, Revolution, StarQuest, NYCDA ----
  // Every rule below was checked against the org's real rows first; the
  // recurring trap is that a "champion"/"title"/"DOY" award_type names the
  // whole CONTEST — winners, runner-ups and often the entire finalist field
  // share the type, separated only by `place`.
  nexstar: [
    // place '1' rows carry a routine name (the actual champion); the 15,758
    // NULL-place rows (~52/event) are the qualifier list, not winners.
    { tier: 'T1', name: 'SDA Regional/Grand Champion (place 1 or Winner only)',
      sql: `LOWER(a.award_type) LIKE '%champion%' AND a.place IN ('1','Winner')` },
    { tier: 'T1', name: 'Premier/Elite Title — Miss/Mr Nexstar, winner only',
      sql: `LOWER(a.award_type) LIKE '%title%' AND a.place = '1'` },
    { tier: 'T2', name: 'Division tables (Level/age), places 1-3',
      sql: `LOWER(a.award_type) LIKE '%level%' AND LOWER(a.award_type) NOT LIKE '%champion%'
            AND LOWER(a.award_type) NOT LIKE '%title%' AND a.place IN ('1','2','3')` },
    { tier: 'T3', name: 'Costume Award (named special)',
      sql: `LOWER(a.award_type) LIKE '%costume award%' AND a.place IN ('1','Winner')` },
  ],
  rainbow: [
    // DOY winner repeats the award name in `place`; 14,537 rows are Finalists.
    { tier: 'T1', name: 'Dancer of the Year winner (place repeats the title)',
      sql: `LOWER(a.award_type) LIKE '%doy%' AND LOWER(TRIM(a.place)) = LOWER(TRIM(a.award_type))` },
    { tier: 'T2', name: 'Overall high point — Top <Level> Starz <Size> <Age>, places 1st-3rd',
      sql: `LOWER(a.award_type) LIKE 'top %' AND a.place IN ('1st','2nd','3rd')` },
    { tier: 'T3', name: "Judges' Choice",
      sql: `LOWER(a.award_type) LIKE '%judges choice%'` },
    { tier: 'UNFLAG', name: 'NYC All Stars invitations (opportunity, not a placement)',
      sql: `LOWER(a.award_type) LIKE '%all stars%'` },
  ],
  starquest: [
    // Title rows include runner-ups whose place strings carry tab damage
    // ("1st\tRunner Up") — place '1' is the winner.
    { tier: 'T1', name: 'Title winner only (place 1)',
      sql: `LOWER(a.award_type) = 'title' AND a.place = '1'` },
    { tier: 'T2', name: 'Overall placements 1-3 (StarQuest core competitive stat)',
      sql: `LOWER(a.award_type) = 'overall' AND a.place IN ('1','2','3')` },
    { tier: 'T3', name: 'Odyssey / Apogee / Studio of Excellence (named specials)',
      sql: `(LOWER(a.award_type) LIKE '%odyssey%' OR LOWER(a.award_type) LIKE '%apogee%'
             OR LOWER(a.award_type) LIKE '%studio of excellence%')` },
  ],
  nycda: [
    // `award_type = 'Outstanding Dancer'` is a SECTION HEADER, not the award:
    // the real name sits in `category`. The section mixes the convention
    // honour itself ("<Age> Outstanding Dancers" — a cohort per age division,
    // ~13/event, which Q confirms is a genuine convention placement and a
    // well-regarded honour) with summer-intensive SCHOLARSHIPS (Tap, Ballet,
    // Hip-Hop, Future Star, Steps…), which are opportunities and stay out.
    { tier: 'T3', name: 'Outstanding Dancer / Outstanding Artist / Rising Star (convention honours)',
      sql: `LOWER(a.award_type) = 'outstanding dancer'
            AND (LOWER(a.category) LIKE '%outstanding dancer%'
                 OR LOWER(a.category) LIKE '%outstanding artist%'
                 OR LOWER(a.category) LIKE '%rising star award%')` },
    { tier: 'T2', name: 'High Score placements 1st-3rd (division-wide)',
      sql: `LOWER(a.award_type) = 'high score' AND a.place IN ('1st','2nd','3rd')` },
    { tier: 'T2', name: 'Overall 1st',
      sql: `LOWER(a.award_type) = 'overall' AND a.place IN ('1st','1st Place')` },
    { tier: 'T3', name: "Critics' Choice, Judges' Pick, Class Act, Good Sport",
      sql: `(LOWER(a.award_type) LIKE '%critics%' OR LOWER(a.award_type) LIKE '%judges%pick%'
             OR LOWER(a.award_type) LIKE '%class act%' OR LOWER(a.award_type) LIKE '%good sport%')` },
  ],
  // ---- Batch 3 (2026-08-30) ----
  // DanceOne conventions: the convention's own dancer title (Non-Stop Dancer /
  // VIP / Breakout Artist / Protege) is filed under award_type='SCHOLARSHIP'
  // with place WINNER/RUNNER-UP. Q: winning it "is a major title" — so the
  // blanket "scholarship rows aren't awards" rule was too broad. Class
  // scholarships ("High Five in Jazz") remain excluded.
  ...['jump', 'nuvo', 'radix', 'twentyfourseven'].reduce((acc, org) => {
    acc[org] = [
      { tier: 'T1', name: 'Convention dancer title — WINNER',
        sql: `LOWER(a.award_type) = 'scholarship' AND a.place = 'WINNER'
              AND (LOWER(a.category) LIKE '%non-stop dancer%' OR LOWER(a.category) LIKE '%vip%'
                   OR LOWER(a.category) LIKE '%breakout%' OR LOWER(a.category) LIKE '%protege%'
                   OR LOWER(a.category) LIKE '%prot\u00e9g%')` },
      // Runner-ups deliberately NOT encoded, for consistency with KAR /
      // Starpower / NYCDA title runner-ups. They outnumber winners ~4:1 and
      // would dominate the figure. Pending one decision across all orgs.
      { tier: 'T2', name: 'High score by age (division-wide), places 1st-3rd',
        sql: `IFNULL(a.award_type,'') = '' AND a.place IN ('1st','2nd','3rd')` },
      { tier: 'T3', name: 'SPECIAL judges awards (Best of JUMP / Best Nu Group / 11 O\'Clock etc.)',
        sql: `LOWER(a.award_type) = 'special'` },
    ];
    return acc;
  }, {}),
  // Ballet: a single elite level per age band and a national field, so Q rates
  // the whole published ladder as major — "very hard to get into top 25".
  adcibc: [
    { tier: 'T1', name: 'Gold/Silver/Bronze medal + 1st-3rd (division podium)',
      sql: `(UPPER(a.place) LIKE '%MEDAL%' OR UPPER(a.place) LIKE '1ST%'
             OR UPPER(a.place) LIKE '2ND%' OR UPPER(a.place) LIKE '3RD%')` },
    { tier: 'T2', name: 'Rest of the finals ladder (4th, 5th, Top 10/15/25)',
      sql: `(UPPER(a.place) LIKE '4TH%' OR UPPER(a.place) LIKE '5TH%' OR UPPER(a.place) LIKE 'TOP %')` },
  ],
  yagp: [
    { tier: 'T1', name: 'Podium — 1st/2nd/3rd (incl. ties)',
      sql: `(UPPER(a.place) LIKE '1ST PLACE%' OR UPPER(a.place) LIKE '2ND PLACE%'
             OR UPPER(a.place) LIKE '3RD PLACE%')` },
    // Q: "top 3 or top 12 are regarded as majors" — Top 24 sits below that bar.
    { tier: 'T2', name: 'Top 3 / Top 6 / Top 12 rankings',
      sql: `UPPER(a.place) IN ('TOP 3','TOP 6','TOP 12')` },
    { tier: 'T3', name: 'Named specials (Outstanding Choreographer/Teacher/School)',
      sql: `(LOWER(IFNULL(a.award_type,'')) LIKE '%outstanding%' OR LOWER(IFNULL(a.category,'')) LIKE '%outstanding%')` },
  ],
};

// Applied to EVERY encoded org, after its own rules.
const COMMON_RULES = [
  // Q, 2026-08-30: choreography awards are genuinely rare — usually at most
  // one per level, sometimes one or two in a whole event — so they count
  // regardless of how the org files the `place` (Winner / blank / 1 / the
  // award name itself).
  { tier: 'T3', name: 'Choreography award (any place — rare by design)',
    sql: `LOWER(IFNULL(a.award_type,'') || ' ' || IFNULL(a.category,'')) LIKE '%choreograph%'` },
];

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

    for (const r of [...rules, ...COMMON_RULES]) {
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
  // Safety net: an org with ANY flagged row counts as curated, so the keyword
  // fallback stops applying to it. If it has no rules here, it is running on
  // stale partial curation and is silently under-counting.
  const orphans = await db.all(`
    SELECT o.slug, COUNT(*) n FROM awards a JOIN events e ON e.id = a.event_id
    JOIN organizations o ON o.id = e.org_id
    WHERE a.is_top_award = 1 GROUP BY o.slug`);
  const unruled = orphans.filter(o => !RULES[o.slug]);
  if (unruled.length) {
    console.log('\n⚠️  CURATED BUT NOT ENCODED HERE (running on stale partial curation):');
    for (const o of unruled) console.log(`   ${o.slug}: ${o.n} flagged rows, no rules in this script`);
  }
  if (!apply) console.log('\nDry run — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
