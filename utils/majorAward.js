// "Major Awards" — the single definition of the platform's headline
// achievement stat. It is PUBLIC (studio pages show "N first places · N
// major"), so it is deliberately platform-wide and not studio-editable:
// a self-serve definition would let a studio inflate a public claim, which
// is exactly what "verified at the source" promises it can't.
//
// Rule: a first place, whose text marks it a PRESTIGE award (title,
// scholarship, invitation, Dancer of the Year…), earned at a NATIONAL /
// FINALS / GRAND stage — either in the award's own wording or the event's.
//
// Both call sites (the public studio page's SQL aggregate and the owner's
// Organization History page's JS pass) build from here, because they used
// to be hand-duplicated and had drifted: the JS read `award_type ||
// category` (ignoring category whenever award_type existed) while the SQL
// concatenated both, so the private page could under-count the public one.

const PRESTIGE_TERMS = ['scholarship', 'invite', 'invitation', 'title', 'photogenic', 'doy', 'dancer of the year'];
// 'title' is in BOTH lists deliberately: the original public SQL listed it
// as a stage term as well ("Teen Miss Nexstar Title" is itself the pinnacle
// award, with no separate "national" wording). Dropping it here would have
// silently cut thousands of awards from a PUBLIC statistic — the refactor's
// job is to unify the two drifted implementations, not to redefine the stat.
const STAGE_TERMS = ['national', 'final', 'grand', 'title'];

const norm = (v) => String(v || '').toLowerCase();

function isMajorAward(award) {
  if (!award || !award.is_first_place) return false;
  const awardText = [award.category, award.award_type, award.performance_name].map(norm).join(' ');
  const stageText = [award.category, award.award_type].map(norm).join(' ');
  const eventText = norm(award.event_name);
  const prestige = PRESTIGE_TERMS.some(t => awardText.includes(t));
  if (!prestige) return false;
  return STAGE_TERMS.some(t => stageText.includes(t))
    || eventText.includes('national') || eventText.includes('final');
}

// SQL fragment mirroring isMajorAward(), for aggregate queries.
// `a` = awards alias, `e` = events alias.
function majorAwardSql(a = 'a', e = 'e') {
  const awardText = `LOWER(COALESCE(${a}.category,'') || ' ' || COALESCE(${a}.award_type,'') || ' ' || COALESCE(${a}.performance_name,''))`;
  const stageText = `LOWER(COALESCE(${a}.category,'') || ' ' || COALESCE(${a}.award_type,''))`;
  const prestige = PRESTIGE_TERMS.map(t => `${awardText} LIKE '%${t}%'`).join(' OR ');
  const stage = STAGE_TERMS.map(t => `${stageText} LIKE '%${t}%'`).join(' OR ');
  return `(${a}.is_first_place = 1 AND (${prestige}) AND ((${stage}) OR LOWER(${e}.name) LIKE '%national%' OR LOWER(${e}.name) LIKE '%final%'))`;
}

// ---- Curation-first (2026-08-30) ----
// Where an org's published hierarchy has been ENCODED (scripts/
// encode_top_awards.js sets is_top_award + top_award_tier), that is the
// truth. The keyword heuristic above survives only as a labelled fallback
// for orgs not yet encoded — it cannot tell an ADC|IBC "Gold Medal" (1st of
// the division) from a UBC "Gold" (third tier, unbounded). See
// docs/major_award_policy.md.
//
// Major = T1 headline + T2 division overalls + T3 named specials (Q's call
// 2026-08-30: overalls are genuinely competitive). T2 is ALSO published on
// its own as "division placements".

let curatedCache = { at: 0, ids: [] };
async function curatedOrgIds(db) {
  if (Date.now() - curatedCache.at < 300000) return curatedCache.ids;
  const rows = await db.all(`
    SELECT o.id FROM organizations o
    WHERE EXISTS (SELECT 1 FROM events e JOIN awards a ON a.event_id = e.id
                  WHERE e.org_id = o.id AND a.is_top_award = 1)`);
  curatedCache = { at: Date.now(), ids: rows.map(r => r.id) };
  return curatedCache.ids;
}

// SQL predicate: curated orgs use their encoding, the rest fall back.
function majorAwardSqlCurated(curatedIds, a = 'a', e = 'e') {
  if (!curatedIds || !curatedIds.length) return majorAwardSql(a, e);
  const list = curatedIds.filter(Number.isInteger).join(',');
  return `(CASE WHEN ${e}.org_id IN (${list}) THEN ${a}.is_top_award = 1
                ELSE ${majorAwardSql(a, e)} END)`;
}

// Tier 2 only — the "division placements" figure.
const divisionPlacementSql = (a = 'a') => `(${a}.top_award_tier = 2)`;

function isMajorAwardCurated(award, curatedIdSet) {
  if (curatedIdSet && award && curatedIdSet.has(award.org_id)) return award.is_top_award === 1;
  return isMajorAward(award);
}

module.exports = {
  isMajorAward, majorAwardSql, PRESTIGE_TERMS, STAGE_TERMS,
  curatedOrgIds, majorAwardSqlCurated, divisionPlacementSql, isMajorAwardCurated,
};
