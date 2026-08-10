// Backfills dancers swallowed by the old Showstopper extractor bug: name
// overflow lines that were misread as category headers never became
// award_dancers links (~349 group awards have fewer linked dancers than the
// corrected extraction lists). Run AFTER extract_showstopper_pdfs.js and
// fix_showstopper_categories.js --apply (categories must already be clean —
// they are part of the match key).
//
// Linking follows the importer's rules (import_showstopper_txt.js):
//   - a dancer "matches" only by same name AT THE SAME STUDIO
//     (same name at a different studio is a different person);
//   - otherwise a new dancer is created and joined to the studio roster.
//
// Idempotent; dry-run by default, --apply to write. Run independently on
// local and prod (created dancer ids/unique_ids will differ per environment,
// which is fine — nothing cross-references them).
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateDancerId } = require('../utils');

const APPLY = process.argv.includes('--apply');
const TXT_DIR = path.join(__dirname, '..', 'tobeprocessed', 'pdf', 'showstopper', 'txt');

function parseFilename(filename, folderYear) {
  const base = filename.replace('.txt', '');
  const city = base.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { city, year: parseInt(folderYear) };
}

const norm = (s) => (s || '').trim().toLowerCase();

// A plausible person name: letters/spaces/'’.-& only, 2..60 chars, no digits.
// Overflow rows are name lists, but stray page text must never become a dancer.
const NAME_OK = /^[a-z À-ɏ.,'’&-]{2,60}$/i;

function parseDancers(dancerStr) {
  if (!dancerStr || dancerStr === 'N/A' || dancerStr === 'null') return [];
  const raw = dancerStr.split(/,|&/).map(d => d.trim())
    .filter(d => d.length >= 2 && !/\d/.test(d) && NAME_OK.test(d));
  // PDF text runs sometimes split one name over two entries ("Molly",
  // "Zuniga"): merge consecutive single-word entries pairwise. Remaining
  // lone words are unreconstructable fragments — dropped by the caller.
  const merged = [];
  for (let i = 0; i < raw.length; i++) {
    const isSingle = !raw[i].includes(' ');
    if (isSingle && i + 1 < raw.length && !raw[i + 1].includes(' ')) {
      merged.push(`${raw[i]} ${raw[i + 1]}`);
      i++;
    } else {
      merged.push(raw[i]);
    }
  }
  return merged;
}

async function main() {
  const db = await openDb();
  const org = await db.get("SELECT id FROM organizations WHERE name = 'Showstopper'");
  if (!org) { console.error('Showstopper org not found'); process.exit(1); }

  const stats = { awardsShort: 0, awardsFixed: 0, linksAdded: 0, dancersCreated: 0, dancersReused: 0, ambiguous: 0, noStudio: 0, unmatched: 0, fragmentsSkipped: 0 };
  const plan = []; // { awardId, studioId, names: [missing names], context }

  for (const year of ['2023', '2024', '2025']) {
    const yearDir = path.join(TXT_DIR, year);
    if (!fs.existsSync(yearDir)) continue;
    for (const file of fs.readdirSync(yearDir).filter(f => f.endsWith('.txt'))) {
      const { city } = parseFilename(file, year);
      const event = await db.get('SELECT id FROM events WHERE org_id = ? AND name = ? AND year = ?',
        [org.id, `Showstopper - ${city}`, parseInt(year)]);
      if (!event) continue;

      // Truth: key -> dancer list (null key value on collision with differing lists)
      const truth = new Map();
      const lines = fs.readFileSync(path.join(yearDir, file), 'utf-8').split('\n');
      for (const line of lines) {
        const m = line.match(/Cat: (.*) \| Level: (.*) \| Place: (.*) \| Routine: (.*) \| Dancer: (.*) \| Studio: (.*)/);
        if (!m) continue;
        const [, cat, level, place, routine, dancerStr, studio] = m;
        const key = `${norm(level)} - ${norm(cat)}|${norm(place)}|${norm(routine === 'N/A' ? '' : routine)}|${norm(studio)}`;
        const dancers = parseDancers(dancerStr);
        if (truth.has(key)) {
          const prev = truth.get(key);
          if (prev && prev.join('|') !== dancers.join('|')) truth.set(key, null); // ambiguous
        } else {
          truth.set(key, dancers);
        }
      }

      const awards = await db.all(`
        SELECT a.id, a.place, a.performance_name, a.category, a.studio_id, s.name AS studio_name,
               (SELECT COUNT(*) FROM award_dancers ad WHERE ad.award_id = a.id) AS linked
        FROM awards a LEFT JOIN studios s ON s.id = a.studio_id
        WHERE a.event_id = ? AND a.is_self_added = 0`, [event.id]);

      for (const a of awards) {
        const key = `${norm(a.category)}|${norm(a.place)}|${norm(a.performance_name)}|${norm(a.studio_name)}`;
        if (!truth.has(key)) { stats.unmatched++; continue; }
        const txtDancers = truth.get(key);
        if (txtDancers === null) { stats.ambiguous++; continue; }
        if (txtDancers.length <= a.linked) continue;

        stats.awardsShort++;
        if (!a.studio_id) { stats.noStudio++; continue; }

        const linkedNames = new Set((await db.all(`
          SELECT d.name FROM dancers d JOIN award_dancers ad ON ad.dancer_id = d.id
          WHERE ad.award_id = ?`, [a.id])).map(r => norm(r.name)));
        const candidates = txtDancers.filter(n => !linkedNames.has(norm(n)));
        // Never create a dancer from a lone word: it's either a fragment of
        // a split name we couldn't pair, or already part of a linked name.
        const missing = candidates.filter(n => n.includes(' '));
        stats.fragmentsSkipped += candidates.length - missing.length;
        if (missing.length === 0) continue;
        plan.push({ awardId: a.id, studioId: a.studio_id, names: missing, context: `${event.id}/${a.place}/${a.performance_name}` });
      }
    }
  }

  console.log(`Awards with fewer linked dancers than the extraction: ${stats.awardsShort}`);
  console.log(`  actionable (missing names resolved): ${plan.length}`);
  console.log(`  skipped — no studio on award: ${stats.noStudio}, ambiguous truth: ${stats.ambiguous}`);
  console.log(`  total names to link: ${plan.reduce((s, p) => s + p.names.length, 0)} (lone-word fragments skipped: ${stats.fragmentsSkipped})`);
  for (const p of plan.slice(0, 5)) console.log(`  e.g. award #${p.awardId} (${p.context}): +${p.names.join(', +')}`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to execute.');
    return;
  }

  await db.run('BEGIN TRANSACTION');
  try {
    for (const p of plan) {
      for (const name of p.names) {
        let dancer = await db.get(`
          SELECT d.* FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id
          WHERE LOWER(d.name) = LOWER(?) AND ds.studio_id = ?`, [name, p.studioId]);
        if (!dancer) {
          const uniqueId = generateDancerId(name);
          await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [uniqueId, name]);
          dancer = await db.get('SELECT * FROM dancers WHERE unique_id = ?', [uniqueId]);
          stats.dancersCreated++;
        } else {
          stats.dancersReused++;
        }
        const r = await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [p.awardId, dancer.id]);
        if (r.changes) stats.linksAdded++;
        await db.run("INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, 'active')", [dancer.id, p.studioId]);
      }
      stats.awardsFixed++;
    }
    await db.run('COMMIT');
    console.log(`\nApplied: ${stats.awardsFixed} awards completed, ${stats.linksAdded} dancer links added (${stats.dancersCreated} dancers created, ${stats.dancersReused} matched on existing roster).`);
  } catch (e) {
    await db.run('ROLLBACK');
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
