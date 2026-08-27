// Step 2 of the JUMP import: read the REVIEWED txt files produced by
// scripts/scrape_jump_to_txt.js (tobeprocessed/jump/txt/) and import them.
// Two-step by design — run only after human review.
//
// Sections in the txt (JUMP is a convention, so its "results" span both
// competition placements and a very large scholarship programme):
//   HIGH SCORE BY AGE / HIGH SCORE BY PERFORMANCE
//        placements 1st..10th; solo rows also name the dancer
//   SCHOLARSHIPS      WINNER / RUNNER-UP, always with a dancer name
//   SPECIAL AWARDS    named awards (Best in Studio, Best of JUMP (Mini)…)
//
// Mapping:
//   place            the published placement / WINNER / RUNNER-UP, or the
//                    award name for SPECIAL AWARDS (those carry no place)
//   award_type       '' for placements, SCHOLARSHIP or SPECIAL otherwise
//   age_division     the published category ("Teen : Solo", "Mini JUMP VIP")
//   category         the routine type pulled out of it ("Solo", "Jazz")
//   dancer_id        set whenever the row names a dancer (matched by
//                    name+studio per the data rules)
//
// Idempotent: events dedupe on org+name+year; awards on
// event + place + age_division + performance_name + studio + dancer.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/import_jump_txt.js           # dry run
//   node scripts/import_jump_txt.js --apply   # write to the DB
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateStudioId, generateDancerId } = require('../utils');

const txtDir = path.join(__dirname, '..', 'tobeprocessed', 'jump', 'txt');
const ORG_SLUG = 'jump';
const ORG_NAME = 'JUMP Dance Convention';
const ORG_SITE = 'https://jumptour.com';

const PLACEMENT_SECTIONS = new Set(['HIGH SCORE BY AGE', 'HIGH SCORE BY PERFORMANCE']);

function parseTxt(content) {
  const meta = {};
  const rows = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(Event|Year|Date|City|SourceURL):\s*(.*)$/);
    if (m) { meta[m[1].toLowerCase()] = m[2].trim(); continue; }
    if (!line.startsWith('Sec: ')) continue;
    const r = line.match(/^Sec: (.*?) \| Cat: (.*?) \| Place: (.*?) \| Routine: (.*?) \| Dancers: (.*?) \| Studio: (.*)$/);
    if (!r) { rows.push({ badLine: line }); continue; }
    const dash = (v) => (v === '-' ? '' : v.trim());
    rows.push({
      section: r[1].trim(), category: dash(r[2]), place: dash(r[3]),
      routine: dash(r[4]), dancer: dash(r[5]), studio: dash(r[6]),
    });
  }
  return { meta, rows };
}

// "Teen : Solo" -> "Solo";  "BALLET CLASS SCHOLARSHIPS" -> "BALLET"
function categoryOf(cat) {
  if (!cat) return '';
  const i = cat.indexOf(':');
  if (i > 0) return cat.slice(i + 1).trim();
  return cat.replace(/\s*(CLASS\s*)?SCHOLARSHIPS?\s*$/i, '').trim();
}

function toAward(r) {
  if (PLACEMENT_SECTIONS.has(r.section)) {
    return { place: r.place, awardType: '', ageDivision: r.category,
      first: /^1st$/i.test(r.place) ? 1 : 0 };
  }
  if (r.section === 'SCHOLARSHIPS') {
    return { place: r.place || 'WINNER', awardType: 'SCHOLARSHIP', ageDivision: r.category, first: 0 };
  }
  // SPECIAL AWARDS: the category IS the award name and there is no place
  return { place: r.place || r.category, awardType: 'SPECIAL', ageDivision: '', first: 0 };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  let org = await db.get('SELECT * FROM organizations WHERE slug = ?', [ORG_SLUG]);
  if (!org) {
    if (apply) {
      await db.run('INSERT INTO organizations (name, slug, website) VALUES (?, ?, ?)', [ORG_NAME, ORG_SLUG, ORG_SITE]);
      org = await db.get('SELECT * FROM organizations WHERE slug = ?', [ORG_SLUG]);
    } else {
      console.log(`(dry run) organization '${ORG_SLUG}' would be created`);
      org = { id: -1 };
    }
  }

  const files = fs.readdirSync(txtDir).filter(f => f.endsWith('.txt') && !f.startsWith('_')).sort();
  const studioCache = new Map();
  const dancerCache = new Map();
  const totals = { events: 0, newEvents: 0, inserted: 0, existing: 0, newStudios: 0,
    newDancers: 0, withDancer: 0, noStudio: 0, badLines: 0 };

  const ensureStudio = async (name) => {
    if (!name) return null;
    if (studioCache.has(name)) return studioCache.get(name);
    let studio = await db.get('SELECT id FROM studios WHERE name = ?', [name]);
    if (!studio) studio = await db.get('SELECT id FROM studios WHERE LOWER(name) = LOWER(?)', [name]);
    if (!studio) {
      totals.newStudios++;
      if (apply) {
        const ins = await db.run('INSERT INTO studios (unique_id, name) VALUES (?, ?)', [generateStudioId(name), name]);
        studio = { id: ins.lastID };
      }
    }
    const id = studio ? studio.id : null;
    studioCache.set(name, id);
    return id;
  };

  const ensureDancer = async (name, studioId) => {
    if (!name || studioId === null) return null;
    const key = `${name}|${studioId}`;
    if (dancerCache.has(key)) return dancerCache.get(key);
    let dancer = await db.get(`
      SELECT d.id FROM dancers d
      JOIN dancer_studios ds ON d.id = ds.dancer_id
      WHERE d.name = ? AND ds.studio_id = ?`, [name, studioId]);
    if (!dancer) {
      totals.newDancers++;
      const ins = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [generateDancerId(name), name]);
      dancer = { id: ins.lastID };
      await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [dancer.id, studioId]);
    }
    dancerCache.set(key, dancer.id);
    return dancer.id;
  };

  for (const f of files) {
    const { meta, rows } = parseTxt(fs.readFileSync(path.join(txtDir, f), 'utf8'));
    const eventName = meta.event;
    const year = parseInt(meta.year, 10);
    if (!eventName || !year) { console.error(`${f}: missing Event:/Year: header — SKIPPED`); continue; }
    const bad = rows.filter(r => r.badLine);
    if (bad.length) {
      console.error(`${f}: ${bad.length} unparseable line(s), e.g. "${bad[0].badLine.slice(0, 80)}" — SKIPPED.`);
      totals.badLines += bad.length;
      continue;
    }
    if (!rows.length) { console.log(`${f}: no rows — skipped`); continue; }

    totals.events++;
    let event = await db.get('SELECT * FROM events WHERE org_id = ? AND name = ? AND year = ?', [org.id, eventName, year]);
    if (!event) {
      totals.newEvents++;
      if (apply) {
        await db.run('INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)',
          [org.id, eventName, year, meta.date || String(year), meta.sourceurl || '']);
        event = await db.get('SELECT * FROM events WHERE org_id = ? AND name = ? AND year = ?', [org.id, eventName, year]);
      }
    }

    let inserted = 0, existing = 0;
    if (apply) {
      for (let attempt = 1; ; attempt++) {
        try { await db.run('BEGIN IMMEDIATE'); break; }
        catch (e) {
          if (!/SQLITE_BUSY/.test(e.message) || attempt >= 5) throw new Error(`${f}: ${e.message}`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }
    try {
      for (const r of rows) {
        const spec = toAward(r);
        const studioId = await ensureStudio(r.studio);
        if (studioId === null) totals.noStudio++;
        if (!event) { inserted++; continue; }

        let dancerId = null;
        if (r.dancer && studioId !== null && apply) dancerId = await ensureDancer(r.dancer, studioId);
        if (r.dancer) totals.withDancer++;

        const dupe = await db.get(
          `SELECT id FROM awards WHERE event_id = ? AND IFNULL(place, '') = ? AND IFNULL(age_division, '') = ?
             AND IFNULL(performance_name, '') = ? AND IFNULL(studio_id, -1) = ? AND IFNULL(dancer_id, -1) = ?`,
          [event.id, spec.place, spec.ageDivision, r.routine,
            studioId === null ? -1 : studioId, dancerId === null ? -1 : dancerId]);
        if (dupe) { existing++; continue; }
        inserted++;
        if (apply) {
          await db.run(
            `INSERT INTO awards (event_id, place, performance_name, award_type, category, age_division, studio_id, dancer_id, is_first_place)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [event.id, spec.place, r.routine || null, spec.awardType,
              categoryOf(spec.ageDivision) || null, spec.ageDivision, studioId, dancerId, spec.first]);
        }
      }
      if (apply) await db.run('COMMIT');
    } catch (e) {
      if (apply) await db.run('ROLLBACK');
      throw new Error(`${f}: ${e.message}`);
    }
    totals.inserted += inserted;
    totals.existing += existing;
    console.log(`${f}: ${eventName} — ${inserted} new, ${existing} already present${event ? '' : ' [event would be created]'}`);
  }

  console.log(`\n${apply ? 'IMPORTED' : 'DRY RUN'}: ${totals.events} events (${totals.newEvents} new), ` +
    `${totals.inserted} awards ${apply ? 'inserted' : 'to insert'}, ${totals.existing} already present, ` +
    `${totals.newStudios} new studios, ${totals.newDancers} new dancers, ` +
    `${totals.withDancer} dancer-named rows, ${totals.noStudio} rows without a studio.`);
  if (!apply) console.log('Re-run with --apply to write. (Review the txt files first!)');
  if (totals.badLines) console.log(`⚠ ${totals.badLines} unparseable lines — those files were skipped entirely.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
