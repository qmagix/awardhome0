// Step 2 of The Dance Awards import: read the REVIEWED txt files produced
// by scripts/scrape_thedanceawards_to_txt.js (tobeprocessed/thedanceawards/
// txt/) and import them. Two-step by design — run only after human review.
//
// Row shapes (Sec tells them apart):
//   BEST-DANCER         named title competition, Cat "Age ~ Gender",
//                       Place 1ST/2ND/3RD or Top-N finalist  -> BEST DANCER
//   BEST-PERFORMANCE    routine placements per age           -> BEST PERFORMANCE
//   HIGH-SCORE-AGE      Cat "Age ~ Genre"                    -> HIGH SCORE BY AGE
//   HIGH-SCORE-PERF     Cat "Age ~ Division"                 -> HIGH SCORE BY PERFORMANCE
//   SPECIALTY           Cat "<real award name> ~ extras"     -> SPECIALTY
//   SCHOLARSHIP         named class scholarships             -> SCHOLARSHIP
//   STUDIO-OF-THE-YEAR  studio-level title                   -> STUDIO OF THE YEAR
//
// Full 2011-2026 history imported per the 2026-08-28 decision (this data
// is uniformly clean back to 2011; heritage Best Dancer titles are the
// point of a trophy case). Named dancers (Best Dancer, scholarships, the
// occasional dancer field elsewhere) get award_dancers junction rows;
// single-dancer awards also set dancer_id. is_first_place counts 1ST in
// the ranked sections (Best Dancer / Best Performance / High Score) —
// specialty and studio awards are wins of a different kind.
//
// Idempotent: events dedupe org+name+year; awards on event + place +
// age_division + performance_name + studio + dancer.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/import_thedanceawards_txt.js           # dry run
//   node scripts/import_thedanceawards_txt.js --apply   # write to the DB
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateStudioId, generateDancerId } = require('../utils');

const txtDir = path.join(__dirname, '..', 'tobeprocessed', 'thedanceawards', 'txt');
const ORG_SLUG = 'thedanceawards';
const ORG_NAME = 'The Dance Awards';
const ORG_SITE = 'https://thedanceawards.com';

const TYPE_OF = {
  'BEST-DANCER': 'BEST DANCER',
  'BEST-PERFORMANCE': 'BEST PERFORMANCE',
  'HIGH-SCORE-AGE': 'HIGH SCORE BY AGE',
  'HIGH-SCORE-PERF': 'HIGH SCORE BY PERFORMANCE',
  SPECIALTY: 'SPECIALTY',
  SCHOLARSHIP: 'SCHOLARSHIP',
  'STUDIO-OF-THE-YEAR': 'STUDIO OF THE YEAR',
};
const FIRSTABLE = new Set(['BEST-DANCER', 'BEST-PERFORMANCE', 'HIGH-SCORE-AGE', 'HIGH-SCORE-PERF']);

function parseTxt(content) {
  const meta = {};
  const rows = [];
  let flagged = 0;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(Event|Year|DateString|SourceFile|SourceURL):\s*(.*)$/);
    if (m) { meta[m[1].toLowerCase()] = m[2].trim(); continue; }
    if (line.startsWith('FLAGGED:')) { flagged++; continue; }
    if (!line.startsWith('Sec: ')) { rows.push({ badLine: line }); continue; }
    const body = line.split(/\s+# /)[0];   // choreographer/director notes
    const r = body.match(/^Sec: (.*?) \| Cat: (.*?) \| Place: (.*?) \| Entry: (.*?) \| Routine: (.*?) \| Studio: (.*?) \| Dancers: (.*)$/);
    if (!r) { rows.push({ badLine: line }); continue; }
    const dash = v => (v.trim() === '-' ? '' : v.trim());
    rows.push({
      sec: r[1].trim(), cat: dash(r[2]), place: dash(r[3]), entry: dash(r[4]),
      routine: dash(r[5]), studio: dash(r[6]),
      dancers: dash(r[7]) ? dash(r[7]).split(',').map(s => s.trim()).filter(Boolean) : [],
    });
  }
  return { meta, rows, flagged };
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
    newDancers: 0, links: 0, firsts: 0, flagged: 0, badLines: 0 };

  const ensureStudio = async (name) => {
    if (!name) return null;
    const key = name.toLowerCase();
    if (studioCache.has(key)) return studioCache.get(key);
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
    studioCache.set(key, id);
    return id;
  };

  const ensureDancer = async (name, studioId) => {
    if (!name || studioId === null) return null;
    const key = `${name.toLowerCase()}|${studioId}`;
    if (dancerCache.has(key)) return dancerCache.get(key);
    let dancer = await db.get(`
      SELECT d.id FROM dancers d
      JOIN dancer_studios ds ON d.id = ds.dancer_id
      WHERE LOWER(d.name) = LOWER(?) AND ds.studio_id = ?`, [name, studioId]);
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
    const { meta, rows, flagged } = parseTxt(fs.readFileSync(path.join(txtDir, f), 'utf8'));
    totals.flagged += flagged;
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
          [org.id, eventName, year, meta.datestring || String(year), meta.sourceurl || '']);
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
        const awardType = TYPE_OF[r.sec];
        if (awardType === undefined) { totals.badLines++; continue; }
        const studioId = await ensureStudio(r.studio);
        let dancerIds = [];
        if (r.dancers.length && studioId !== null && apply) {
          for (const name of r.dancers) {
            const id = await ensureDancer(name, studioId);
            if (id) dancerIds.push(id);
          }
        } else if (r.dancers.length && !apply) {
          for (const name of r.dancers) {
            const key = `${name.toLowerCase()}|${studioId === null ? 's:' + r.studio.toLowerCase() : studioId}`;
            if (!dancerCache.has(key)) {
              const d = studioId === null ? null : await db.get(
                `SELECT d.id FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id
                 WHERE LOWER(d.name) = LOWER(?) AND ds.studio_id = ?`, [name, studioId]);
              if (!d) totals.newDancers++;
              dancerCache.set(key, d ? d.id : null);
            }
          }
        }

        const first = FIRSTABLE.has(r.sec) && /^1ST$/i.test(r.place) ? 1 : 0;
        if (!event) {
          inserted++;
          totals.firsts += first;
          totals.links += dancerIds.length || r.dancers.length;
          continue;
        }
        const soloId = dancerIds.length === 1 ? dancerIds[0] : null;
        const dupe = await db.get(
          `SELECT id FROM awards WHERE event_id = ? AND IFNULL(place, '') = ? AND IFNULL(age_division, '') = ?
             AND IFNULL(performance_name, '') = ? AND IFNULL(studio_id, -1) = ? AND IFNULL(dancer_id, -1) = ?`,
          [event.id, r.place, r.cat, r.routine,
            studioId === null ? -1 : studioId, soloId === null ? -1 : soloId]);
        if (dupe) {
          existing++;
          if (apply) {
            for (const id of dancerIds) {
              const res = await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [dupe.id, id]);
              if (res.changes) totals.links++;
            }
          }
          continue;
        }
        inserted++;
        totals.firsts += first;
        if (apply) {
          const ins = await db.run(
            `INSERT INTO awards (event_id, place, performance_name, award_type, category, age_division, studio_id, dancer_id, is_first_place)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [event.id, r.place, r.routine || null, awardType,
              null, r.cat || null, studioId, soloId, first]);
          for (const id of dancerIds) {
            await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [ins.lastID, id]);
            totals.links++;
          }
        } else {
          totals.links += dancerIds.length || r.dancers.length;
        }
      }
      if (apply) await db.run('COMMIT');
    } catch (e) {
      if (apply) await db.run('ROLLBACK');
      throw new Error(`${f}: ${e.message}`);
    }
    totals.inserted += inserted;
    totals.existing += existing;
    console.log(`${f}: ${eventName} ${year} — ${inserted} new, ${existing} already present${event ? '' : ' [event would be created]'}`);
  }

  console.log(`\n${apply ? 'IMPORTED' : 'DRY RUN'}: ${totals.events} events (${totals.newEvents} new), ` +
    `${totals.inserted} awards ${apply ? 'inserted' : 'to insert'} (${totals.firsts} firsts), ` +
    `${totals.existing} already present, ${totals.newStudios} new studios, ` +
    `${totals.newDancers} new dancers, ${totals.links} dancer links. ${totals.flagged} FLAGGED skipped.`);
  if (!apply) console.log('Re-run with --apply to write. (txt reviewed? then go.)');
  if (totals.badLines) console.log(`⚠ ${totals.badLines} unparseable/unknown lines.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
