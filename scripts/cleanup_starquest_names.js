// Repairs StarQuest category/award_type strings damaged at PDF extraction:
// scattered mid-word spaces ("Adult S ol o Award") and literal tabs between
// header fragments made one real category appear as many, most used once.
//
//   node scripts/cleanup_starquest_names.js            # dry run: report only
//   node scripts/cleanup_starquest_names.js --apply    # rewrite awards + rules
//
// Pass 1: normalizeName() on every distinct category and award_type.
// Pass 2: any names still sharing a whitespace-stripped key (damage the
//         token heuristic can't fix alone) unify onto the variant backed by
//         the most awards.
// Apply: UPDATE awards (org-scoped), remap org_first_place_rules the same
// way (conflicting merged rules resolve to the dominant variant's value),
// then re-assert rules via applyOrgFirstPlaceRules so awards that were
// hand-toggled off under garbled names get their correct final state.
const { openDb, applyOrgFirstPlaceRules } = require('../database');
const { normalizeName, nameKey } = require('../utils/normalize_names');

const APPLY = process.argv.includes('--apply');
const ORG_SLUG = 'starquest';

async function buildMapping(db, orgId, field) {
  const rows = await db.all(`
    SELECT a.${field} AS name, COUNT(*) AS n
    FROM awards a JOIN events e ON e.id = a.event_id
    WHERE e.org_id = ? AND a.${field} IS NOT NULL
    GROUP BY a.${field}`, [orgId]);

  // Pass 1: token-heuristic normalization
  const mapping = new Map(); // old -> new
  for (const r of rows) mapping.set(r.name, normalizeName(r.name));

  // Pass 2: unify residual same-key variants onto the award-count-dominant form
  const groups = new Map(); // key -> Map(normalizedForm -> count)
  for (const r of rows) {
    const key = nameKey(r.name);
    const form = mapping.get(r.name);
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key);
    g.set(form, (g.get(form) || 0) + r.n);
  }
  const canonical = new Map(); // key -> winning form
  for (const [key, forms] of groups) {
    canonical.set(key, [...forms.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  for (const r of rows) mapping.set(r.name, canonical.get(nameKey(r.name)));

  const changes = rows.filter(r => mapping.get(r.name) !== r.name);
  return { rows, mapping, changes };
}

function report(field, { rows, mapping, changes }) {
  const distinctAfter = new Set(rows.map(r => mapping.get(r.name))).size;
  const awardRows = changes.reduce((s, r) => s + r.n, 0);
  console.log(`\n== ${field}: ${rows.length} distinct -> ${distinctAfter} (${changes.length} renamed, ${awardRows} award rows affected)`);
  for (const r of changes.slice(0, 15)) {
    console.log(`  [${r.n}] ${JSON.stringify(r.name)} -> ${JSON.stringify(mapping.get(r.name))}`);
  }
  if (changes.length > 15) console.log(`  ... and ${changes.length - 15} more`);
}

async function remapRules(db, orgId, catMap, typeMap) {
  const rules = await db.all('SELECT * FROM org_first_place_rules WHERE org_id = ?', [orgId]);
  // '' encodes NULL in rules; map through the same tables (rule strings came
  // from award strings). Merged rules: keep the value of the rule whose old
  // combo had the most awards behind it.
  const weight = async (r) => {
    const row = await db.get(`
      SELECT COUNT(*) n FROM awards a JOIN events e ON e.id = a.event_id
      WHERE e.org_id = ? AND a.category IS ? AND a.award_type IS ? AND a.place IS ?`,
      [orgId, r.category === '' ? null : r.category,
       r.award_type === '' ? null : r.award_type, r.place === '' ? null : r.place]);
    return row.n;
  };
  const merged = new Map(); // newKey -> {category, award_type, place, is_first_place, w}
  for (const r of rules) {
    const cat = r.category === '' ? '' : (catMap.get(r.category) || r.category);
    const typ = r.award_type === '' ? '' : (typeMap.get(r.award_type) || r.award_type);
    const k = JSON.stringify([cat, typ, r.place]);
    const w = await weight(r);
    const prev = merged.get(k);
    if (!prev || w > prev.w) merged.set(k, { category: cat, award_type: typ, place: r.place, is_first_place: r.is_first_place, w });
    if (prev && prev.is_first_place !== r.is_first_place) {
      console.log(`  rule conflict on ${k}: keeping is_first_place=${merged.get(k).is_first_place} (dominant variant)`);
    }
  }
  console.log(`\n== rules: ${rules.length} -> ${merged.size}`);
  if (!APPLY) return;
  await db.run('DELETE FROM org_first_place_rules WHERE org_id = ?', [orgId]);
  for (const m of merged.values()) {
    await db.run(`
      INSERT INTO org_first_place_rules (org_id, category, award_type, place, is_first_place)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(org_id, category, award_type, place)
      DO UPDATE SET is_first_place = excluded.is_first_place, updated_at = CURRENT_TIMESTAMP`,
      [orgId, m.category, m.award_type, m.place, m.is_first_place]);
  }
}

async function main() {
  const db = await openDb();
  const org = await db.get('SELECT id, name FROM organizations WHERE slug = ?', [ORG_SLUG]);
  if (!org) { console.error(`Org "${ORG_SLUG}" not found`); process.exit(1); }

  const cats = await buildMapping(db, org.id, 'category');
  const types = await buildMapping(db, org.id, 'award_type');
  report('category', cats);
  report('award_type', types);

  if (!APPLY) {
    await remapRules(db, org.id, cats.mapping, types.mapping); // report-only
    console.log('\nDry run — re-run with --apply to write.');
    return;
  }

  await db.run('BEGIN TRANSACTION');
  try {
    let changed = 0;
    for (const r of cats.changes) {
      const res = await db.run(`
        UPDATE awards SET category = ?
        WHERE category = ? AND event_id IN (SELECT id FROM events WHERE org_id = ?)`,
        [cats.mapping.get(r.name), r.name, org.id]);
      changed += res.changes;
    }
    for (const r of types.changes) {
      const res = await db.run(`
        UPDATE awards SET award_type = ?
        WHERE award_type = ? AND event_id IN (SELECT id FROM events WHERE org_id = ?)`,
        [types.mapping.get(r.name), r.name, org.id]);
      changed += res.changes;
    }
    await remapRules(db, org.id, cats.mapping, types.mapping);
    await db.run('COMMIT');
    console.log(`\nApplied: ${changed} award field updates.`);
  } catch (e) {
    await db.run('ROLLBACK');
    console.error('ROLLED BACK:', e.message);
    process.exit(1);
  }

  const { rules, changed: reasserted } = await applyOrgFirstPlaceRules(db, { orgId: org.id });
  console.log(`Re-asserted ${rules} org rules: ${reasserted} awards updated.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
