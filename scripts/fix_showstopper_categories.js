// Repairs Showstopper award categories corrupted by the old extractor's
// substring header detection (dancer-name lines containing SOLO/SMALL/DUET —
// "Addison Solomon", "Sophia Small", "Ellie Duet-Champagne" — became the
// category for every award that followed; see extract_showstopper_pdfs.js).
//
// Two modes:
//   node scripts/fix_showstopper_categories.js build
//     Reads the RE-EXTRACTED txt files (run extract_showstopper_pdfs.js
//     first) plus the local DB, matches every Showstopper award to its
//     re-extracted truth, and writes data/showstopper_category_fixes.json
//     with one {id, from, to} entry per award whose category differs.
//     Award ids are identical on local and prod (both descend from the same
//     seed and Showstopper was imported before the seed), so the JSON is a
//     portable, reviewable patch.
//   node scripts/fix_showstopper_categories.js --apply
//     Applies the JSON. Each update is guarded by the expected old value
//     (WHERE id = ? AND category = ?), so a diverged row is skipped and
//     reported, never clobbered. Idempotent: re-running skips everything.
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');

const MODE = process.argv.includes('--apply') ? 'apply' : 'build';
const FIXES_PATH = path.join(__dirname, '..', 'data', 'showstopper_category_fixes.json');
const TXT_DIR = path.join(__dirname, '..', 'tobeprocessed', 'pdf', 'showstopper', 'txt');

function parseFilename(filename, folderYear) {
  const base = filename.replace('.txt', '');
  const city = base.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { city, year: parseInt(folderYear) };
}

const norm = (s) => (s || '').trim().toLowerCase();

async function build() {
  const db = await openDb();
  const org = await db.get("SELECT id FROM organizations WHERE name = 'Showstopper'");
  if (!org) { console.error('Showstopper org not found'); process.exit(1); }

  const fixes = [];
  const stats = { events: 0, awards: 0, unchanged: 0, fixed: 0, unmatched: 0, ambiguous: 0, missingDancerAwards: 0 };

  for (const year of ['2023', '2024', '2025']) {
    const yearDir = path.join(TXT_DIR, year);
    if (!fs.existsSync(yearDir)) continue;
    for (const file of fs.readdirSync(yearDir).filter(f => f.endsWith('.txt'))) {
      const { city } = parseFilename(file, year);
      const event = await db.get(
        'SELECT id, name FROM events WHERE org_id = ? AND name = ? AND year = ?',
        [org.id, `Showstopper - ${city}`, parseInt(year)]);
      if (!event) { console.log(`note: no event for ${year}/${file} — skipped`); continue; }
      stats.events++;

      // Truth from re-extraction: key -> set of categories (+ dancer counts)
      const primary = new Map(), noStudio = new Map(), loose = new Map(), dancerCounts = new Map();
      const addKey = (map, key, cat) => {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(cat);
      };
      const lines = fs.readFileSync(path.join(yearDir, file), 'utf-8').split('\n');
      for (const line of lines) {
        const m = line.match(/Cat: (.*) \| Level: (.*) \| Place: (.*) \| Routine: (.*) \| Dancer: (.*) \| Studio: (.*)/);
        if (!m) continue;
        const [, cat, level, place, routine, dancerStr, studio] = m;
        const finalCategory = `${level.trim()} - ${cat.trim()}`;
        const routineKey = norm(routine === 'N/A' ? '' : routine);
        const pKey = `${norm(level)}|${norm(place)}|${routineKey}|${norm(studio)}`;
        addKey(primary, pKey, finalCategory);
        addKey(noStudio, `${norm(level)}|${norm(place)}|${routineKey}`, finalCategory);
        addKey(loose, `${norm(place)}|${routineKey}`, finalCategory);
        const nDancers = (dancerStr && dancerStr !== 'N/A') ? dancerStr.split(/,|&/).filter(d => d.trim()).length : 0;
        dancerCounts.set(pKey, Math.max(dancerCounts.get(pKey) || 0, nDancers));
      }

      const awards = await db.all(`
        SELECT a.id, a.place, a.performance_name, a.category, s.name AS studio_name,
               (SELECT COUNT(*) FROM award_dancers ad WHERE ad.award_id = a.id) AS linked_dancers
        FROM awards a LEFT JOIN studios s ON s.id = a.studio_id
        WHERE a.event_id = ? AND a.is_self_added = 0`, [event.id]);

      for (const a of awards) {
        stats.awards++;
        const level = (a.category || '').split(' - ')[0];
        const routineKey = norm(a.performance_name);
        const pKey = `${norm(level)}|${norm(a.place)}|${routineKey}|${norm(a.studio_name)}`;
        let cats = primary.get(pKey)
          || noStudio.get(`${norm(level)}|${norm(a.place)}|${routineKey}`)
          || loose.get(`${norm(a.place)}|${routineKey}`);
        if (!cats) { stats.unmatched++; continue; }
        if (cats.size > 1) { stats.ambiguous++; continue; }
        const newCat = [...cats][0];
        if (newCat === a.category) {
          stats.unchanged++;
        } else {
          stats.fixed++;
          fixes.push({ id: a.id, from: a.category, to: newCat });
        }
        const expected = dancerCounts.get(pKey);
        if (expected && a.linked_dancers < expected) stats.missingDancerAwards++;
      }
    }
  }

  fs.writeFileSync(FIXES_PATH, JSON.stringify(fixes, null, 1));
  console.log(`\nEvents matched: ${stats.events}`);
  console.log(`Awards examined: ${stats.awards}`);
  console.log(`  category already correct: ${stats.unchanged}`);
  console.log(`  category fixes written:   ${stats.fixed}  -> ${path.relative(process.cwd(), FIXES_PATH)}`);
  console.log(`  unmatched (left alone):   ${stats.unmatched}`);
  console.log(`  ambiguous (left alone):   ${stats.ambiguous}`);
  console.log(`FYI awards with fewer linked dancers than the re-extraction lists: ${stats.missingDancerAwards} (not touched — separate backfill)`);
  const sample = fixes.slice(0, 5);
  if (sample.length) {
    console.log('\nSample fixes:');
    for (const f of sample) console.log(`  #${f.id}: "${f.from}" -> "${f.to}"`);
  }
}

async function apply() {
  if (!fs.existsSync(FIXES_PATH)) { console.error(`No fixes file at ${FIXES_PATH} — run build mode first.`); process.exit(1); }
  const fixes = JSON.parse(fs.readFileSync(FIXES_PATH, 'utf-8'));
  const db = await openDb();
  let applied = 0, skipped = 0, alreadyDone = 0;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const f of fixes) {
      const r = await db.run('UPDATE awards SET category = ? WHERE id = ? AND category = ?', [f.to, f.id, f.from]);
      if (r.changes === 1) { applied++; continue; }
      const row = await db.get('SELECT category FROM awards WHERE id = ?', [f.id]);
      if (row && row.category === f.to) alreadyDone++;
      else { skipped++; console.log(`  skipped #${f.id}: current category ${row ? JSON.stringify(row.category) : '(row missing)'} != expected`); }
    }
    await db.run('COMMIT');
    console.log(`\nApplied ${applied} of ${fixes.length} fixes (${alreadyDone} already done, ${skipped} skipped on guard mismatch).`);
  } catch (e) {
    await db.run('ROLLBACK');
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
}

(MODE === 'apply' ? apply() : build()).catch(e => { console.error(e); process.exit(1); });
