// Archive-integrity guardrails (mobile design v2 §14, development plan M4).
//
// These are the numbers that catch SILENT DECAY — the failure mode no unit
// test sees, because nothing errors. Family entry can be working beautifully
// by every funnel metric while quietly re-creating the 3,386 duplicate studios
// and ~2,950 duplicate dancer profiles that the 2026-08-30/31 repair removed.
//
// The design is explicit about this: "Do not optimise raw submission volume.
// A faster funnel that creates duplicates or false dancer links is a product
// regression." So these run weekly beside the pipeline, and a rising number
// here outranks a rising number anywhere else.
//
// Usage (repo root):
//   node scripts/archive_metrics.js            # human-readable
//   node scripts/archive_metrics.js --json     # for a dashboard or an alert
const { openDb } = require('../database');
const { openSubmissionsDb } = require('../utils/submissionsDb');

// Everything is scoped to a window so the numbers describe what family entry
// is doing NOW, not what the corpus looked like after a decade of imports.
const WINDOW_DAYS = parseInt(process.env.METRICS_WINDOW_DAYS, 10) || 7;

async function collect() {
  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const since = `-${WINDOW_DAYS} days`;

  const accepted = (await sdb.get(
    "SELECT COUNT(*) AS n FROM award_submissions WHERE status = 'accepted' AND decided_at > datetime('now', ?)",
    [since])).n;

  // --- New canonical studios per 100 accepted submissions ---
  // Should be ~0. Studios are DERIVED from affiliation and never typed, so a
  // family submission has no path to creating one. Anything above zero means
  // some other writer is minting studios, and that is the duplicate-studio
  // problem restarting.
  // `studios` has no created_at, so "new since last run" is remembered as a
  // high-water mark rather than derived — see readMark/writeMark below.
  const mark = await readMark(db, 'studios_max_id');
  const studiosSinceMark = mark == null ? null : (await db.get(
    'SELECT COUNT(*) AS n FROM studios WHERE id > ? AND COALESCE(is_independent, 0) = 0', [mark])).n;
  await writeMark(db, 'studios_max_id', (await db.get('SELECT IFNULL(MAX(id), 0) AS m FROM studios')).m);

  // --- Event candidates created for events that ALREADY existed ---
  // Measures picker quality. A candidate that a reviewer or auto-merge later
  // folds into an existing canonical event is one the picker should have
  // surfaced in the first place.
  const candidatesCreated = (await sdb.get(
    "SELECT COUNT(*) AS n FROM event_candidates WHERE source = 'family' AND created_at > datetime('now', ?)",
    [since])).n;
  const candidatesMerged = (await sdb.get(
    "SELECT COUNT(*) AS n FROM event_candidates WHERE status = 'merged' AND decided_at > datetime('now', ?)",
    [since])).n;

  // --- Duplicate canonical awards ---
  // Awards convergence should have merged: same event, studio and routine,
  // identical in EVERY descriptive field.
  //
  // Two exclusions, both calibrated against the real corpus rather than
  // guessed, because a guardrail that cries wolf gets ignored:
  //   * category, award_type and age_division must be in the key. Without
  //     them "1st in Teen Contemporary" and "1st Overall" on one routine read
  //     as duplicates — 97,556 of them, which is noise, not an alarm.
  //   * a BLANK routine name is skipped. Per-dancer placement rows ("TOP 12",
  //     senior age division, one row per dancer, no routine) share every
  //     field by construction and are not duplicates of each other; an award
  //     with no routine has no routine identity to duplicate.
  //
  // Baseline on the 2026-09-01 corpus: 6,408, all of it legacy import
  // residue. Family entry must not add to it — convergence exists to make
  // that impossible, so any RISE is the signal, not the absolute number.
  const duplicateAwards = (await db.get(`
    SELECT COUNT(*) AS n FROM (
      SELECT event_id, studio_id,
             IFNULL(performance_name_key, LOWER(TRIM(IFNULL(performance_name, '')))) AS rk,
             IFNULL(place, '') AS pl, IFNULL(category, '') AS cat,
             IFNULL(award_type, '') AS at, IFNULL(age_division, '') AS ad, COUNT(*) AS c
      FROM awards
      WHERE event_id IS NOT NULL AND studio_id IS NOT NULL
        AND TRIM(IFNULL(performance_name, '')) != ''
      GROUP BY event_id, studio_id, rk, pl, cat, at, ad
      HAVING c > 1)`)).n;

  // --- Group awards left with a single linked dancer ---
  // The 1,874 baseline from the repair. It should FALL as families fill casts
  // in, never rise. A rise means group routines are being entered as if they
  // were solos.
  const singleDancerGroups = (await db.get(`
    SELECT COUNT(*) AS n FROM (
      SELECT a.id
      FROM awards a
      JOIN award_dancers ad ON ad.award_id = a.id
      WHERE LOWER(IFNULL(a.award_type, '') || ' ' || IFNULL(a.category, ''))
            LIKE '%group%'
      GROUP BY a.id HAVING COUNT(*) = 1)`)).n;

  // --- Convergence rate ---
  // Share of group awards carrying links contributed by MORE THAN ONE
  // household. This is the number that says the cast-fills-in-over-a-season
  // mechanism is actually working, rather than each family creating a
  // parallel record of the same routine.
  const convergence = await db.get(`
    SELECT
      (SELECT COUNT(DISTINCT a.id) FROM awards a
       JOIN award_provenance p ON p.award_id = a.id
       WHERE p.source_type = 'family_submission'
       GROUP BY a.id HAVING COUNT(DISTINCT p.contributor_user_id) > 1) AS multi,
      (SELECT COUNT(DISTINCT award_id) FROM award_provenance
       WHERE source_type = 'family_submission') AS total`);
  const multiHousehold = (convergence && convergence.multi) || 0;
  const familyAwards = (convergence && convergence.total) || 0;

  // --- Review economics (§14) ---
  // The one that decides whether this scales: what share of submissions a
  // studio owner cleared rather than AwardHome staff.
  const decided = await sdb.all(
    `SELECT status, COUNT(*) AS n FROM award_submissions
     WHERE decided_at > datetime('now', ?) GROUP BY status`, [since]);
  const byStatus = Object.fromEntries(decided.map(r => [r.status, r.n]));
  const levels = await sdb.all(
    `SELECT verification_level, COUNT(*) AS n FROM award_submissions
     WHERE status = 'accepted' AND decided_at > datetime('now', ?) GROUP BY verification_level`, [since]);
  const byLevel = Object.fromEntries(levels.map(r => [r.verification_level, r.n]));

  const openCorrections = (await db.get(
    "SELECT COUNT(*) AS n FROM award_corrections WHERE status = 'open'").catch(() => ({ n: 0 }))).n;

  return {
    window_days: WINDOW_DAYS,
    accepted_submissions: accepted,
    new_studios_per_100_accepted: accepted
      ? Number((((studiosSinceMark == null ? 0 : studiosSinceMark) / accepted) * 100).toFixed(2))
      : 0,
    new_studios_since_last_run: studiosSinceMark,
    event_candidates_created: candidatesCreated,
    event_candidates_merged_into_existing: candidatesMerged,
    duplicate_canonical_awards: duplicateAwards,
    group_awards_with_one_dancer: singleDancerGroups,
    family_awards_total: familyAwards,
    family_awards_multi_household: multiHousehold,
    convergence_rate: familyAwards ? Number((multiHousehold / familyAwards).toFixed(3)) : 0,
    decisions: byStatus,
    accepted_by_verification: byLevel,
    open_corrections: openCorrections,
  };
}

// High-water marks live in system_settings — the studios table has no
// created_at, so "new since last run" has to be remembered rather than
// derived. Recording it here keeps the metric honest without a schema change.
async function readMark(db, key) {
  try {
    const row = await db.get('SELECT value FROM system_settings WHERE key = ?', ['metrics_' + key]);
    return row ? parseInt(row.value, 10) : null;
  } catch (e) { return null; }
}
async function writeMark(db, key, value) {
  try {
    await db.run(
      'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      ['metrics_' + key, String(value), String(value)]);
  } catch (e) { /* pre-migration */ }
}

async function main() {
  const m = await collect();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  const show = m;
  console.log(`=== Archive integrity (last ${m.window_days} days) ===`);
  console.log(`  accepted submissions           : ${show.accepted_submissions}`);
  console.log(`  new studios per 100 accepted   : ${show.new_studios_per_100_accepted}  (should be ~0)`);
  console.log(`  event candidates created       : ${show.event_candidates_created}`);
  console.log(`  ...merged into existing events : ${show.event_candidates_merged_into_existing}  (picker missed these)`);
  console.log(`  duplicate canonical awards     : ${show.duplicate_canonical_awards}  (6,408 legacy baseline — must not rise)`);
  console.log(`  group awards with one dancer   : ${show.group_awards_with_one_dancer}  (1,874 baseline — must fall)`);
  console.log(`  convergence rate               : ${show.convergence_rate}  (${show.family_awards_multi_household}/${show.family_awards_total} family awards have >1 household)`);
  console.log(`  open corrections               : ${show.open_corrections}`);
  console.log(`  decisions                      : ${JSON.stringify(show.decisions)}`);
  console.log(`  accepted by verification level : ${JSON.stringify(show.accepted_by_verification)}`);
  console.log('\nA faster funnel that creates duplicates is a product regression (design §14).');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { collect, WINDOW_DAYS };
