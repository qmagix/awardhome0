// Re-applies persistent org-level first-place rules (org_first_place_rules,
// written by the /admin/org/:slug/categories toggles) onto awards — run this
// after importing new events so they inherit the org's curation.
//
//   node scripts/apply_first_place_rules.js                    # all orgs
//   node scripts/apply_first_place_rules.js --org showstopper  # one org
//   node scripts/apply_first_place_rules.js --event 123        # one event
//   node scripts/apply_first_place_rules.js --seed-showstopper
//     One-time: imports data/showstopper_first_place_tuples.json (the
//     pre-rules curation exported by sync_showstopper_first_place.js) into
//     org_first_place_rules as is_first_place=1 rules, then applies them.
//
// NOTE: org-wide runs re-assert the org decision everywhere, overwriting
// conflicting per-event toggles. Use --event right after an import to leave
// other events' overrides untouched.
const fs = require('fs');
const path = require('path');
const { openDb, initDb, applyOrgFirstPlaceRules } = require('../database');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

async function seedShowstopper(db) {
  const tuplesPath = path.join(__dirname, '..', 'data', 'showstopper_first_place_tuples.json');
  if (!fs.existsSync(tuplesPath)) { console.error(`No tuples file at ${tuplesPath}`); process.exit(1); }
  const org = await db.get("SELECT id FROM organizations WHERE name = 'Showstopper'");
  if (!org) { console.error('Showstopper org not found'); process.exit(1); }
  const tuples = JSON.parse(fs.readFileSync(tuplesPath, 'utf-8'));
  let inserted = 0;
  for (const t of tuples) {
    const r = await db.run(`
      INSERT INTO org_first_place_rules (org_id, category, award_type, place, is_first_place)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(org_id, category, award_type, place) DO NOTHING`,
      [org.id, t.category || '', t.award_type || '', t.place || '']);
    inserted += r.changes;
  }
  console.log(`Seeded ${inserted} new rules (${tuples.length} tuples) for Showstopper.`);
  return org.id;
}

async function main() {
  const db = await initDb(); // ensures org_first_place_rules exists

  let orgId = null;
  const eventId = argValue('--event');
  const orgSlug = argValue('--org');

  if (process.argv.includes('--seed-showstopper')) {
    orgId = await seedShowstopper(db);
  } else if (orgSlug) {
    const org = await db.get('SELECT id FROM organizations WHERE slug = ?', [orgSlug]);
    if (!org) { console.error(`Org "${orgSlug}" not found`); process.exit(1); }
    orgId = org.id;
  }

  const { rules, changed } = await applyOrgFirstPlaceRules(db, { orgId, eventId });
  console.log(`Applied ${rules} rules: ${changed} awards updated.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
