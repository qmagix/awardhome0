// Completes and ports the superadmin's Showstopper first-place curation.
//
// Why: the org categories page displayed MAX(is_first_place) per combo, so
// marking a combo on a few event audit pages made the org page LOOK fully
// set while most events stayed unmarked; combos toggled before the category
// repair also missed the repaired rows. And the curation was done on the
// local DB — prod never saw any of it.
//
//   node scripts/sync_showstopper_first_place.js build
//     Reads the local DB: every Showstopper (category, award_type, place)
//     combo with at least one marked award is treated as "this is a true
//     1st, org-wide" and written to data/showstopper_first_place_tuples.json.
//   node scripts/sync_showstopper_first_place.js --apply
//     Marks every Showstopper award matching a listed combo (never unmarks
//     anything). Idempotent; run on local to complete the mixed combos and
//     on prod to install the same curation.
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');

const MODE = process.argv.includes('--apply') ? 'apply' : 'build';
const TUPLES_PATH = path.join(__dirname, '..', 'data', 'showstopper_first_place_tuples.json');

async function getOrgId(db) {
  const org = await db.get("SELECT id FROM organizations WHERE name = 'Showstopper'");
  if (!org) { console.error('Showstopper org not found'); process.exit(1); }
  return org.id;
}

async function build() {
  const db = await openDb();
  const orgId = await getOrgId(db);
  const tuples = await db.all(`
    SELECT a.category, a.award_type, a.place,
           SUM(a.is_first_place) AS marked, COUNT(*) AS total
    FROM awards a JOIN events e ON e.id = a.event_id
    WHERE e.org_id = ?
    GROUP BY a.category, a.award_type, a.place
    HAVING SUM(a.is_first_place) > 0`, [orgId]);
  const out = tuples.map(t => ({ category: t.category, award_type: t.award_type, place: t.place }));
  fs.writeFileSync(TUPLES_PATH, JSON.stringify(out, null, 1));
  const partial = tuples.filter(t => t.marked < t.total);
  console.log(`Exported ${out.length} first-place combos -> ${path.relative(process.cwd(), TUPLES_PATH)}`);
  console.log(`  fully marked already: ${out.length - partial.length}`);
  console.log(`  partial (apply will complete them): ${partial.length}, covering ${partial.reduce((s, t) => s + (t.total - t.marked), 0)} unmarked awards`);
  for (const t of partial.slice(0, 5)) console.log(`  e.g. "${t.category}" | ${t.award_type} | place ${t.place}: ${t.marked}/${t.total}`);
}

async function apply() {
  if (!fs.existsSync(TUPLES_PATH)) { console.error(`No tuples file at ${TUPLES_PATH} — run build mode first.`); process.exit(1); }
  const tuples = JSON.parse(fs.readFileSync(TUPLES_PATH, 'utf-8'));
  const db = await openDb();
  const orgId = await getOrgId(db);
  let changed = 0;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const t of tuples) {
      const r = await db.run(`
        UPDATE awards SET is_first_place = 1
        WHERE event_id IN (SELECT id FROM events WHERE org_id = ?)
          AND category IS ? AND award_type IS ? AND place IS ? AND is_first_place = 0`,
        [orgId, t.category || null, t.award_type || null, t.place || null]);
      changed += r.changes;
    }
    await db.run('COMMIT');
    const total = await db.get(`
      SELECT COUNT(*) n FROM awards a JOIN events e ON e.id = a.event_id
      WHERE e.org_id = ? AND a.is_first_place = 1`, [orgId]);
    console.log(`Applied ${tuples.length} combos: ${changed} awards newly marked; Showstopper now has ${total.n} first places.`);
  } catch (e) {
    await db.run('ROLLBACK');
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
}

(MODE === 'apply' ? apply() : build()).catch(e => { console.error(e); process.exit(1); });
