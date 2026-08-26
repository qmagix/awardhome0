// Step 2 of the UBC import: read the REVIEWED txt files produced by
// extract_ubc.js (tobeprocessed/ubc/txt/) and import them into the DB.
// Two-step by design — run only after human review.
//
// Conventions (ballet, dancer-centric — same shape as YAGP/ADC IBC):
//   place            = numeric placement ("1".."12"); blank for the
//                      Additional Awards block, whose label goes in place
//   award_type       = '' for placements, the award label for extras
//   age_division     = the section ("SENIOR COM CLASSICAL", "JUNIOR
//                      COMPETITIVE DUO/TRIO", "PRIMARY INT ENSEMBLE")
//   category         = CLASSICAL / CONTEMPORARY / PDD / DUO-TRIO /
//                      ENSEMBLE / 20TH-21ST, derived from the section
//   performance_name = routine title
// Solos put the dancer on awards.dancer_id; duo/trio rows link every
// listed dancer through award_dancers. Ensembles carry no dancer names
// (studio-level). Dancers match by name+studio per the data rules.
// Additional Awards: coach/choreographer/school awards attach to the
// studio only; dancer-named awards (Rising Star, Aspire, Legacy, ...)
// attach to the dancer when the recipient resolves to one.
//
// Idempotent: events dedupe on org+name+year; awards on
// event + place + age_division + performance_name + studio + dancer.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/import_ubc_txt.js           # dry run
//   node scripts/import_ubc_txt.js --apply   # write to the DB
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateStudioId, generateDancerId } = require('../utils');

const txtDir = path.join(__dirname, '..', 'tobeprocessed', 'ubc', 'txt');
const ORG_SLUG = 'ubc';
const ORG_NAME = 'Universal Ballet Competition';
const ORG_SITE = 'https://universalballetcompetition.com';

// awards that belong to a school/coach, not a dancer
const STUDIO_AWARD = /COACH|SCHOOL|STUDIO|CHOREOGRAPHER|TEACHER/i;

function categoryOf(section) {
  const s = section.toUpperCase();
  if (s.includes('ENSEMBLE')) return 'ENSEMBLE';
  if (s.includes('PDD') || s.includes('PAS DE DEUX')) return 'PAS DE DEUX';
  if (s.includes('DUO') || s.includes('TRIO')) return 'DUO/TRIO';
  if (s.includes('20TH') || s.includes('21ST')) return '20TH/21ST CENTURY';
  if (s.includes('CONTEMPORARY')) return 'CONTEMPORARY';
  if (s.includes('CLASSICAL')) return 'CLASSICAL';
  return '';
}
const isEnsembleSec = (s) => /ENSEMBLE/i.test(s);
const isGroupSec = (s) => /DUO|TRIO|PDD|PAS DE DEUX/i.test(s);

function parseTxt(content) {
  const meta = {};
  const rows = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(Event|Year|Date|City|SourceURL):\s*(.*)$/);
    if (m) { meta[m[1].toLowerCase()] = m[2].trim(); continue; }
    if (!line.startsWith('Sec: ')) continue;
    const r = line.match(/^Sec: (.*?) \| Place: (.*?) \| Award: (.*?) \| Routine: (.*?) \| Dancers: (.*?) \| Studio: (.*)$/);
    if (!r) { rows.push({ badLine: line }); continue; }
    const dash = (v) => (v === '-' ? '' : v);
    rows.push({
      section: r[1].trim(), place: r[2].trim(), award: dash(r[3].trim()),
      routine: dash(r[4].trim()), dancers: dash(r[5].trim()), studio: dash(r[6].trim()),
    });
  }
  return { meta, rows };
}

const splitDancers = (s) => s.split(/,|\s+&\s+/).map(x => x.trim()).filter(Boolean);

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
  const totals = { events: 0, newEvents: 0, inserted: 0, existing: 0, newStudios: 0, newDancers: 0, links: 0, badLines: 0 };

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
        const isExtra = r.section === 'ADDITIONAL AWARDS';
        // Additional Awards: the recipient sits in the Dancers column and
        // may be a person or a school, depending on the award.
        let studioName = r.studio;
        let dancerNames = [];
        if (isExtra) {
          if (STUDIO_AWARD.test(r.award)) studioName = r.dancers;
          else dancerNames = [r.dancers];
        } else if (!isEnsembleSec(r.section)) {
          dancerNames = isGroupSec(r.section) ? splitDancers(r.dancers) : [r.dancers];
        }

        const studioId = await ensureStudio(studioName);
        if (!event) { inserted++; continue; }

        const place = isExtra ? r.award : r.place;
        const soloName = (!isExtra && !isGroupSec(r.section) && dancerNames.length === 1) ? dancerNames[0]
          : (isExtra && dancerNames.length === 1 ? dancerNames[0] : null);
        let dancerId = null;
        if (soloName && studioId !== null && apply) dancerId = await ensureDancer(soloName, studioId);

        const dupe = await db.get(
          `SELECT id FROM awards WHERE event_id = ? AND IFNULL(place, '') = ? AND IFNULL(age_division, '') = ?
             AND IFNULL(performance_name, '') = ? AND IFNULL(studio_id, -1) = ? AND IFNULL(dancer_id, -1) = ?`,
          [event.id, place, r.section, r.routine, studioId === null ? -1 : studioId, dancerId === null ? -1 : dancerId]);
        if (dupe) { existing++; continue; }
        inserted++;
        if (apply) {
          const ins = await db.run(
            `INSERT INTO awards (event_id, place, performance_name, award_type, category, age_division, studio_id, dancer_id, is_first_place)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [event.id, place, r.routine || null, isExtra ? r.award : '', categoryOf(r.section) || null,
              r.section, studioId, dancerId, (!isExtra && r.place === '1') ? 1 : 0]);
          if (!soloName && dancerNames.length && studioId !== null) {
            for (const dName of dancerNames) {
              const dId = await ensureDancer(dName, studioId);
              if (dId) { await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [ins.lastID, dId]); totals.links++; }
            }
          }
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
    `${totals.newStudios} new studios, ${totals.newDancers} new dancers, ${totals.links} group dancer links.`);
  if (!apply) console.log('Re-run with --apply to write. (Review the txt files first!)');
  if (totals.badLines) console.log(`⚠ ${totals.badLines} unparseable lines — those files were skipped entirely.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
