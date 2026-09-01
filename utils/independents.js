// Independent dancers — the synthetic-studio model (mobile design v2 §6.2.1,
// decided 2026-08-31).
//
// An independent dancer gets a studio row of their own. That makes
// "independent" a DATA case rather than a CODE case: resolveDancer, both
// solo-repair scripts, and the M4 convergence key all keep working on a
// studio key, with no parallel branch to maintain forever. The platform
// already does this for cross-studio collaborations (CLAUDE.md pseudo-studios).
//
// Two conditions hold the model up. Break either and it degenerates into the
// shared-roster model it replaces:
//
//   1. THE NAME MUST BE GLOBALLY UNIQUE. Two independents both named "Emma
//      Smith" would otherwise create two identically-named studio rows, and
//      scripts/merge_studio_aliases.js would fuse them on the case tier —
//      shared roster restored, two real children conflated. So the stored
//      name carries the dancer's unique_id. `studioDisplayNameSql` keeps that
//      machine shape off the public card; nobody ever reads it.
//
//   2. EVERY STUDIO-FACING SURFACE MUST EXCLUDE THEM. Directory, search,
//      featured rotation, rankings, homepage cards, merge suggestions — and
//      no public studio page (the URL redirects to the dancer). Otherwise the
//      directory fills with thousands of one-dancer "studios".
//
// DETECTION IS A CURATED PER-ORGANIZATION LIST, NEVER A REGEX ON "independ".
// Across the corpus the marker arrives as `Independent, CA`, `INDEPENDENT -
// MCGEE`, `Independant, MD`, `Iindependent, CO` — and `IndepenDANCE Studio`
// and `Independent Dance Collective` are REAL studios with real rosters. A
// pattern match on the substring would dissolve a genuine studio's identity.
// This is the §2b naming trap from docs/major_award_policy.md in a new place.

// One reviewed rule per organization. A rule fires only on studios whose
// awards actually come from that organization, so one org's convention can
// never reclassify another org's studio. Add a rule only after reading the
// full list of rows it selects (`node scripts/migrate_independent_studios.js`
// prints exactly that before it changes anything).
const ORG_INDEPENDENT_RULES = [
  {
    org: 'Youth America Grand Prix',
    // YAGP publishes every unaffiliated entrant in a region on ONE roster:
    // "Independent, CA", "Independent, Poland". Reviewed 2026-08-31 against
    // all 93 rows this selects; no genuine studio uses the shape.
    note: 'Regional roster for unaffiliated entrants: "Independent, <region>".',
    match: (name) => /^Independent\s*,\s*\S/i.test(name),
  },
];

// Real studios whose names contain an independence-like word. Belt and braces:
// no rule may classify one of these, whatever it matches on. Compared on the
// case-folded, whitespace-collapsed name.
const NEVER_INDEPENDENT = new Set([
  'independance studio',
  'independence dance',
  'independent dance collective',
]);

const foldName = (name) => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Which reviewed rule (if any) classifies this studio as a shared independent
// roster? `orgNames` is the set of organizations the studio's awards come
// from — a rule fires only if its own org is in there.
function classifyRoster(studioName, orgNames = []) {
  const folded = foldName(studioName);
  if (!folded || NEVER_INDEPENDENT.has(folded)) return null;
  const orgs = new Set(orgNames.filter(Boolean));
  for (const rule of ORG_INDEPENDENT_RULES) {
    if (!orgs.has(rule.org)) continue;
    if (rule.match(String(studioName || ''))) return rule;
  }
  return null;
}

// The globally-unique stored name for one independent dancer's synthetic
// studio. Deterministic, so re-running the migration finds the row it made
// last time instead of minting a second one.
function syntheticStudioName(dancerName, dancerUniqueId) {
  const name = String(dancerName || '').replace(/\s+/g, ' ').trim() || 'Unnamed Dancer';
  return `Independent — ${name} (${dancerUniqueId})`;
}

// What a visitor sees where a studio name is rendered for an award. The
// stored name is a machine key; "Independent" is the honest human reading.
// SQL rather than view logic so every card path gets it from one place.
function studioDisplayNameSql(alias = 's') {
  return `CASE WHEN COALESCE(${alias}.is_independent, 0) = 1 THEN 'Independent' ELSE ${alias}.name END`;
}

// Drop-in predicate for studio-facing queries (directory, search, featured,
// rankings, merge suggestions). Written as a fragment rather than a helper
// that rewrites SQL: the queries stay readable and greppable.
function excludeIndependentSql(alias = 's') {
  return `COALESCE(${alias}.is_independent, 0) = 0`;
}

module.exports = {
  ORG_INDEPENDENT_RULES, NEVER_INDEPENDENT,
  foldName, classifyRoster, syntheticStudioName,
  studioDisplayNameSql, excludeIndependentSql,
};
