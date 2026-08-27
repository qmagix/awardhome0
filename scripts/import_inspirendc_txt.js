// Step 3 of the Inspire NDC import: read the REVIEWED txt files produced by
// scripts/extract_inspirendc.py (tobeprocessed/inspirendc/txt/) and import
// them. Two-step by design — run only after human review.
//
// Row shapes (Sec tells them apart):
//   OVERALL     per-category placements ("Solo ~ Mini ~ Recreational",
//               1ST..12TH incl. ties) — award_type '' like other orgs'
//               plain placements. The Dancers field carries the FULL
//               group roster, this org's headline feature.
//   TOPSCORE    per-session high scores            -> award_type TOP SCORE
//   SHOWCASE    Nationals Crystal Showcase rounds  -> award_type CRYSTAL SHOWCASE
//   TITLE[-*]   Miss/Mr./Non-Binary title results  -> award_type TITLE
//   PHOTOGENIC  pageant awards, dancer only, NO studio (see below)
//   COSTUME     costume winners (studio/dancers resolved by entry where possible)
//   STUDIO      studio-level awards (Studio of Excellence etc), no dancers
//
// Dancer linking (the data rules): EVERY named dancer gets an
// award_dancers junction row — groups are never mapped through the legacy
// 1:1 awards.dancer_id column. Single-dancer awards ALSO set dancer_id,
// because several public queries still read it. Dancers are matched
// case-insensitively by name+studio (Inspire publishes rosters ALL-CAPS;
// an existing mixed-case profile of the same dancer must not fork).
//
// PHOTOGENIC rows name a dancer with no studio. The winner competed at
// the event, so first match the name against dancers already linked in
// this file (their studio comes along); else reuse a globally unique
// name match; else create a studio-less dancer profile (schema allows it,
// the dancer page works via unique_id).
//
// Idempotent: events dedupe on org+name+year; awards on event + place +
// age_division + performance_name + performance_number + studio + dancer;
// junction rows are INSERT OR IGNORE and are re-completed on re-runs.
// FLAGGED lines are skipped and counted. "# CHECK:" annotations are
// stripped (the row itself imports).
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/import_inspirendc_txt.js           # dry run
//   node scripts/import_inspirendc_txt.js --apply   # write to the DB
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateStudioId, generateDancerId } = require('../utils');

const txtDir = path.join(__dirname, '..', 'tobeprocessed', 'inspirendc', 'txt');
const ORG_SLUG = 'inspirendc';
const ORG_NAME = 'Inspire National Dance Competition';
const ORG_SITE = 'https://inspirendc.com';

const TYPE_OF = {
  OVERALL: '', TOPSCORE: 'TOP SCORE', SHOWCASE: 'CRYSTAL SHOWCASE',
  PHOTOGENIC: 'PHOTOGENIC', COSTUME: 'COSTUME', STUDIO: 'STUDIO AWARD',
};
const typeOf = sec => sec.startsWith('TITLE') ? 'TITLE' : TYPE_OF[sec];
// 1ST counts as a first place where the row is a ranked result; titles,
// pageant and studio awards are wins of a different kind and stay 0.
const FIRSTABLE = new Set(['OVERALL', 'TOPSCORE', 'SHOWCASE']);

function parseTxt(content) {
  const meta = {};
  const rows = [];
  let flagged = 0;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(Event|Year|DateString|Location|SourceFile|SourceURL):\s*(.*)$/);
    if (m) { meta[m[1].toLowerCase()] = m[2].trim(); continue; }
    if (line.startsWith('FLAGGED:')) { flagged++; continue; }
    if (!line.startsWith('Sec: ')) { rows.push({ badLine: line }); continue; }
    const body = line.split(/\s+# CHECK:/)[0];
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
    newDancers: 0, links: 0, firsts: 0, flagged: 0, badLines: 0,
    photoLocal: 0, photoFuzzy: 0, photoGlobal: 0, photoNew: 0, noStudio: 0 };

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
    // dancer name (lowercased) -> {dancerId, studioId} seen in THIS file,
    // so studio-less PHOTOGENIC winners land on the right profile
    const localNames = new Map();
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
        let studioId = await ensureStudio(r.studio);
        let dancerIds = [];

        if (r.sec === 'PHOTOGENIC') {
          // dedupe BEFORE dancer resolution: an ambiguous global name makes
          // the resolved dancer id run-dependent, but event + label +
          // winner name is stable
          if (event) {
            const pdupe = await db.get(
              `SELECT a.id FROM awards a
                 JOIN award_dancers ad ON ad.award_id = a.id
                 JOIN dancers d ON d.id = ad.dancer_id
               WHERE a.event_id = ? AND a.award_type = 'PHOTOGENIC'
                 AND IFNULL(a.place, '') = ? AND LOWER(d.name) = LOWER(?)`,
              [event.id, r.place, r.dancers[0] || '']);
            if (pdupe) { existing++; continue; }
          }
          const key = r.dancers[0] ? r.dancers[0].toLowerCase() : '';
          // pageant pages print middle names the rosters omit ("Ramsey Kate
          // Cantrell" vs "RAMSEY CANTRELL") - fall back to a unique
          // first+last token match within this event
          let hit = key ? localNames.get(key) : null;
          let fuzzy = false;
          if (!hit && key && key.includes(' ')) {
            const toks = key.split(/\s+/);
            const fl = `${toks[0]} ${toks[toks.length - 1]}`;
            const cands = [...localNames.entries()].filter(([n]) => {
              const t = n.split(/\s+/);
              return `${t[0]} ${t[t.length - 1]}` === fl;
            });
            if (cands.length === 1) { hit = cands[0][1]; fuzzy = true; }
          }
          if (hit) {
            dancerIds = [hit.dancerId];
            if (studioId === null) studioId = hit.studioId;
            totals.photoLocal++;
            if (fuzzy) totals.photoFuzzy++;
          } else if (key) {
            const global = await db.all('SELECT id FROM dancers WHERE LOWER(name) = ? LIMIT 2', [key]);
            if (global.length === 1) {
              dancerIds = [global[0].id];
              totals.photoGlobal++;
            } else {
              // not documented anywhere else (2023 books only print placing
              // routines) - a studio-less profile is the honest record
              totals.photoNew++;
              if (apply) {
                const ins = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)',
                  [generateDancerId(r.dancers[0]), r.dancers[0]]);
                dancerIds = [ins.lastID];
              }
            }
            // the same winner can hold two pageant titles in one book -
            // register so the next row reuses this profile
            localNames.set(key, { dancerId: dancerIds[0] ?? null, studioId: null });
          }
        } else if (r.dancers.length) {
          if (apply && studioId !== null) {
            for (const name of r.dancers) dancerIds.push(await ensureDancer(name, studioId));
            dancerIds = dancerIds.filter(id => id !== null);
            for (let i = 0; i < r.dancers.length; i++) {
              const id = dancerIds[i];
              if (id) localNames.set(r.dancers[i].toLowerCase(), { dancerId: id, studioId });
            }
          } else if (!apply) {
            // dry run: count creations without writing. A dancer of a
            // studio that doesn't exist yet is necessarily new too.
            for (const name of r.dancers) {
              const key = `${name.toLowerCase()}|${studioId === null ? 's:' + r.studio.toLowerCase() : studioId}`;
              if (!dancerCache.has(key)) {
                const d = studioId === null ? null : await db.get(
                  `SELECT d.id FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id
                   WHERE LOWER(d.name) = LOWER(?) AND ds.studio_id = ?`, [name, studioId]);
                if (!d) totals.newDancers++;
                dancerCache.set(key, d ? d.id : null);
              }
              localNames.set(name.toLowerCase(), { dancerId: dancerCache.get(key), studioId });
            }
          }
        }
        if (!r.studio && r.sec !== 'PHOTOGENIC' && r.sec !== 'STUDIO') totals.noStudio++;
        const first = FIRSTABLE.has(r.sec) && /^1ST$/i.test(r.place) ? 1 : 0;
        if (!event) {   // dry run against a not-yet-created event: no dupe check possible
          inserted++;
          totals.firsts += first;
          totals.links += dancerIds.length || r.dancers.length;
          continue;
        }

        const soloId = dancerIds.length === 1 ? dancerIds[0] : null;
        const dupe = await db.get(
          `SELECT id FROM awards WHERE event_id = ? AND IFNULL(place, '') = ? AND IFNULL(age_division, '') = ?
             AND IFNULL(performance_name, '') = ? AND IFNULL(performance_number, '') = ?
             AND IFNULL(studio_id, -1) = ? AND IFNULL(dancer_id, -1) = ?`,
          [event.id, r.place, r.cat, r.routine, r.entry,
            studioId === null ? -1 : studioId, soloId === null ? -1 : soloId]);
        if (dupe) {
          existing++;
          if (apply) {   // re-complete junction rows interrupted mid-import
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
            `INSERT INTO awards (event_id, place, performance_name, performance_number, award_type, category, age_division, studio_id, dancer_id, is_first_place)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [event.id, r.place, r.routine || null, r.entry || null, typeOf(r.sec),
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
    console.log(`${f}: ${eventName} — ${inserted} new, ${existing} already present${event ? '' : ' [event would be created]'}`);
  }

  console.log(`\n${apply ? 'IMPORTED' : 'DRY RUN'}: ${totals.events} events (${totals.newEvents} new), ` +
    `${totals.inserted} awards ${apply ? 'inserted' : 'to insert'} (${totals.firsts} firsts), ${totals.existing} already present, ` +
    `${totals.newStudios} new studios, ${totals.newDancers} new dancers, ${totals.links} dancer links.`);
  console.log(`Photogenic linking: ${totals.photoLocal} via event roster (${totals.photoFuzzy} first+last fuzzy), ${totals.photoGlobal} via unique global name, ` +
    `${totals.photoNew} new studio-less profiles. ${totals.noStudio} non-photogenic rows without a studio, ` +
    `${totals.flagged} FLAGGED lines skipped.`);
  if (!apply) console.log('Re-run with --apply to write. (txt reviewed? then go.)');
  if (totals.badLines) console.log(`⚠ ${totals.badLines} unparseable lines — those files were skipped entirely.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
