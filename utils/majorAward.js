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

module.exports = { isMajorAward, majorAwardSql, PRESTIGE_TERMS, STAGE_TERMS };
