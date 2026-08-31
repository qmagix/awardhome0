// One definition of "this award belongs to a single dancer", shared by the
// backfill, the importers, and the awards editor.
//
// Why it exists (2026-08-30): dancers reach an award two ways — the canonical
// `award_dancers` junction, and the legacy 1:1 `awards.dancer_id`. The
// convention is that SOLOS are written to BOTH (importers double-write), so
// that the many surfaces still reading the legacy column keep working. Several
// importers (Showstopper, Starpower, NYCDA, and the shared DanceBug importer
// behind Imagine/Believe/DreamMaker/Rainbow) only ever wrote the junction, so
// 67.5k solos had no primary dancer. In the studio awards editor those dancers
// appeared under "Group Dancers"; on public pages any query joining
// `a.dancer_id` (Hall of Fame, card surfaces) rendered a blank dancer.
//
// THE SAFETY RULE, and why it is written this way: identification must be
// POSITIVE — the award's own label has to say it is a solo or a title. It must
// NEVER be inferred from "there happens to be exactly one linked dancer",
// because 1,874 group-worded awards also have exactly one link: a group whose
// cast is only partly entered. Promoting those would silently convert real
// groups into solos, which is far worse than the bug being fixed.
//
// Verified on the live corpus: this predicate selects 79,181 awards, of which
// 0 contain group/duo/trio/line wording.

// An award is individual if its label CLAIMS to be (solo / title) …
const INDIVIDUAL_TERMS = ['solo', 'title'];
// … and carries no multi-dancer format word. "line" covers Grand Lines;
// several orgs also publish combined "Solo/Duo/Trio" headings, where the
// category is what disambiguates — so any duo/trio wording anywhere in the
// label disqualifies the row rather than guessing.
const GROUP_TERMS = ['duo', 'duet', 'trio', 'group', 'line', 'production', 'ensemble', 'team', 'quartet'];

// Label = award_type + category ONLY. performance_name is deliberately
// excluded: a routine called "Solo Flight" is not evidence of a solo.
const labelSql = (a = 'a') => `LOWER(IFNULL(${a}.award_type,'') || ' ' || IFNULL(${a}.category,''))`;

function individualAwardSql(a = 'a') {
  const L = labelSql(a);
  const include = INDIVIDUAL_TERMS.map(t => `${L} LIKE '%${t}%'`).join(' OR ');
  const exclude = GROUP_TERMS.map(t => `${L} NOT LIKE '%${t}%'`).join(' AND ');
  return `((${include}) AND ${exclude})`;
}

function isIndividualLabel(awardType, category) {
  const L = `${awardType || ''} ${category || ''}`.toLowerCase();
  return INDIVIDUAL_TERMS.some(t => L.includes(t)) && !GROUP_TERMS.some(t => L.includes(t));
}

// Importers use db.runAsync/getAsync; the newer scripts and routes use
// db.run/get. Accept either so there is exactly one implementation.
//
// Deliberately uses ONLY get + run: two of the five importers
// (import_showstopper_txt.js, import_nycda_txt.js) promisify run/get but NOT
// all, so calling an `all` here would silently fall through to the raw
// callback-based sqlite3 method, return undefined, and crash the import.
const api = (db) => ({
  get: (sql, p) => (db.getAsync ? db.getAsync(sql, p) : db.get(sql, p)),
  run: (sql, p) => (db.runAsync ? db.runAsync(sql, p) : db.run(sql, p)),
});

// Set awards.dancer_id from the junction for ONE award, if it is safe.
// Importers call this ONCE PER AWARD after linking its cast (not once per
// dancer — the decision depends on the final link count), so the legacy column
// stays populated going forward instead of relying on the weekly sweep.
// Returns true only when it actually wrote.
//
// `hint` ({awardType, category}) lets a caller that already holds the label
// skip a group award with ZERO queries — worth it on imports that link
// hundreds of thousands of rows.
async function setSoloPrimary(db, awardId, hint) {
  if (hint && !isIndividualLabel(hint.awardType, hint.category)) return false;
  const { get, run } = api(db);
  const a = await get('SELECT id, award_type, category, dancer_id FROM awards WHERE id = ?', [awardId]);
  if (!a || a.dancer_id) return false;
  if (!isIndividualLabel(a.award_type, a.category)) return false;

  // exactly ONE linked dancer, or this is not a solo we can speak for
  const cnt = await get('SELECT COUNT(*) AS n FROM award_dancers WHERE award_id = ?', [awardId]);
  if (!cnt || cnt.n !== 1) return false;
  const link = await get('SELECT dancer_id FROM award_dancers WHERE award_id = ?', [awardId]);
  if (!link) return false;
  const dancerId = link.dancer_id;

  // never resurrect a director-denied link (same rule as the sibling backfill)
  const denied = await get(
    'SELECT 1 AS x FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [awardId, dancerId]);
  if (denied) return false;

  // the dancer must still exist — FKs are deliberately off in this schema
  const d = await get('SELECT 1 AS x FROM dancers WHERE id = ?', [dancerId]);
  if (!d) return false;

  await run('UPDATE awards SET dancer_id = ? WHERE id = ? AND dancer_id IS NULL', [dancerId, awardId]);
  return true;
}

module.exports = {
  INDIVIDUAL_TERMS, GROUP_TERMS,
  labelSql, individualAwardSql, isIndividualLabel, setSoloPrimary,
};
