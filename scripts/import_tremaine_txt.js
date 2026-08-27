// Step 3 of the Tremaine import: read the REVIEWED txt files produced by
// scripts/extract_tremaine.py + extract_tremaine_doty.py
// (tobeprocessed/tremaine/txt/) and import them. Two-step by design — run
// only after human review.
//
// Row shapes (Sec tells them apart):
//   PLACEMENT    1ST..4TH per Age ~ Category ~ Style     -> award_type ''
//   QUALIFIER    Nationals Qualifier (incl. '**'-starred
//                placing routines, Addtl. NF Qual)       -> NATIONALS QUALIFIER
//   HIGH SCORE   "JR SOLO HIGH SCORE" etc                -> HIGH SCORE
//   OVATION      "SR GROUP JUDGES' OVATION"              -> JUDGES' OVATION
//   SHOWMANSHIP  pre-2020 name of the ovation award      -> BEST SHOWMANSHIP
//   NF-AWARD     finals medals ("JR NF Solo Gold")       -> NATIONAL FINALS
//   FACULTY      "Faculty Show Invitee N"                -> FACULTY SHOW
//   IDA          "I.D.A. Winner"                         -> I.D.A.
//   DOTY         "<Division> Dancer of the Year", one
//                pseudo-event per season                 -> DANCER OF THE YEAR
//
// category = the style (last Cat segment), matching how other orgs carry
// the dance style; age_division = the full published section.
//
// Dancers: Tremaine publishes no rosters — names exist only for
// independents ("Independent - Maely Weaver") and DOTY titles. Every named
// dancer gets an award_dancers junction row; single-dancer awards also set
// dancer_id (several public queries still read it). DOTY rows mostly have
// no studio: match a globally unique name, else create a studio-less
// profile; their dupe check is event + place + winner NAME (resolution of
// an ambiguous name is run-dependent, the name text is not).
//
// Year scope: --from/--to (default 2022-2026 per the 2026-08-28 decision;
// older extracted seasons stay in txt for a later backfill).
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/import_tremaine_txt.js           # dry run
//   node scripts/import_tremaine_txt.js --apply   # write to the DB
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateStudioId, generateDancerId } = require('../utils');

const txtDir = path.join(__dirname, '..', 'tobeprocessed', 'tremaine', 'txt');
const ORG_SLUG = 'tremaine';
const ORG_NAME = 'Tremaine Dance Conventions & Competitions';
const ORG_SITE = 'https://www.tremainedance.com';

const argv = Object.fromEntries(process.argv.slice(2)
  .map(a => a.match(/^--(\w+)(?:=(.*))?$/)).filter(Boolean).map(m => [m[1], m[2] ?? true]));
const FROM = parseInt(argv.from || '2022', 10);
const TO = parseInt(argv.to || '2026', 10);

const TYPE_OF = {
  PLACEMENT: '', QUALIFIER: 'NATIONALS QUALIFIER', 'HIGH SCORE': 'HIGH SCORE',
  OVATION: "JUDGES' OVATION", SHOWMANSHIP: 'BEST SHOWMANSHIP',
  'NF-AWARD': 'NATIONAL FINALS', FACULTY: 'FACULTY SHOW', IDA: 'I.D.A.',
  DOTY: 'DANCER OF THE YEAR',
};

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
    const body = line.split(/\s+# /)[0];   // strip "# CHECK:" / "# <home town>"
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

const styleOf = cat => {
  const parts = (cat || '').split('~').map(s => s.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 1] : null;
};

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
  const totals = { events: 0, newEvents: 0, skippedYears: 0, inserted: 0, existing: 0,
    newStudios: 0, newDancers: 0, links: 0, firsts: 0, flagged: 0, badLines: 0,
    dotyGlobal: 0, dotyNew: 0 };

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
    if (year < FROM || year > TO) { totals.skippedYears++; continue; }
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
        let studioId = await ensureStudio(r.studio);
        let dancerIds = [];

        if (r.sec === 'DOTY') {
          // dupe on the stable key BEFORE name resolution (see header)
          if (event) {
            const pdupe = await db.get(
              `SELECT a.id FROM awards a
                 JOIN award_dancers ad ON ad.award_id = a.id
                 JOIN dancers d ON d.id = ad.dancer_id
               WHERE a.event_id = ? AND a.award_type = 'DANCER OF THE YEAR'
                 AND IFNULL(a.place, '') = ? AND LOWER(d.name) = LOWER(?)`,
              [event.id, r.place, r.dancers[0] || '']);
            if (pdupe) { existing++; continue; }
          }
          const name = r.dancers[0];
          if (name && studioId !== null && apply) {
            dancerIds = [await ensureDancer(name, studioId)].filter(Boolean);
          } else if (name && studioId === null) {
            const global = await db.all('SELECT id FROM dancers WHERE LOWER(name) = LOWER(?) LIMIT 2', [name]);
            if (global.length === 1) {
              dancerIds = [global[0].id];
              totals.dotyGlobal++;
            } else {
              totals.dotyNew++;
              if (apply) {
                const ins = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [generateDancerId(name), name]);
                dancerIds = [ins.lastID];
              }
            }
          }
        } else if (r.dancers.length && studioId !== null && apply) {
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

        const first = r.sec === 'PLACEMENT' && /^1ST$/i.test(r.place) ? 1 : 0;
        if (!event) {   // dry run against a not-yet-created event
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
            `INSERT INTO awards (event_id, place, performance_name, performance_number, award_type, category, age_division, studio_id, dancer_id, is_first_place)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [event.id, r.place, r.routine || null, r.entry || null, awardType,
              styleOf(r.cat), r.cat || null, studioId, soloId, first]);
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

  console.log(`\n${apply ? 'IMPORTED' : 'DRY RUN'}: ${totals.events} events (${totals.newEvents} new, ` +
    `${totals.skippedYears} files outside ${FROM}-${TO}), ${totals.inserted} awards ` +
    `${apply ? 'inserted' : 'to insert'} (${totals.firsts} firsts), ${totals.existing} already present, ` +
    `${totals.newStudios} new studios, ${totals.newDancers} new dancers, ${totals.links} dancer links.`);
  console.log(`DOTY dancer linking: ${totals.dotyGlobal} via unique global name, ${totals.dotyNew} new studio-less profiles. ` +
    `${totals.flagged} FLAGGED lines skipped.`);
  if (!apply) console.log('Re-run with --apply to write. (txt reviewed? then go.)');
  if (totals.badLines) console.log(`⚠ ${totals.badLines} unparseable/unknown lines.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
