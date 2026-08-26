// Step 2 of the ADC|IBC import: read the REVIEWED txt files produced by
// extract_adcibc.js (tobeprocessed/adcibc/txt/<year>.txt) and import them.
// Two-step by design — run only after human review.
//
// Conventions mirror the YAGP data (ballet, dancer-centric):
//   place        = the award label ("GOLD MEDAL", "TOP 25", "1ST PLACE",
//                  "GRAND PRIX RECIPIENT", special-award names)
//   age_division = the section ("FEMALE JUNIOR DIVISION", "PRIMARY
//                  DIVISION", "ENSEMBLE DIVISION", "SPECIAL AWARDS")
//   category     = ensemble subsection ("CLASSICAL PAS DE DEUX", ...)
//   performance_name = routine title (ensembles only; solos are unnamed
//                  variations, left empty like YAGP)
// Dancers match by name+studio (per the data rules); solos use
// awards.dancer_id, ensembles link every listed dancer via award_dancers.
// Special-award curation: people-not-dancer awards (Outstanding
// Choreographer/Coach, photographer) are SKIPPED; Outstanding School
// imports as a studio-level award (no dancer); the rest (jury awards,
// Traditional Excellence, Outstanding International Dancer, Fernando
// Bujones Memorial) import as dancer awards.
//
// Idempotent: events dedupe on org+name+year; awards on event + place +
// age_division + category + performance_name + studio + dancer.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/import_adcibc_txt.js           # dry run
//   node scripts/import_adcibc_txt.js --apply   # write to the DB
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateStudioId, generateDancerId } = require('../utils');

const txtDir = path.join(__dirname, '..', 'tobeprocessed', 'adcibc', 'txt');
const ORG_SLUG = 'adcibc';
const ORG_NAME = 'ADC IBC';
const ORG_SITE = 'https://www.adcibc.com';

const SKIP_SPECIALS = /OUTSTANDING CHOREOGRAPHER|OUTSTANDING COACH|PHOTOGRAPHER/i;
const SCHOOL_SPECIAL = /OUTSTANDING SCHOOL/i;
const FIRSTS = /^(GOLD MEDAL|1ST PLACE|GRAND PRIX)/i;

function parseTxt(content) {
  const rows = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('Sec: ')) continue;
    // "Loc: ?" — an empty trailing Loc loses its space to trim()
    const r = line.match(/^Sec: (.*?) \| Award: (.*?) \| Place: (.*?) \| Who: (.*?) \| Studio: (.*?) \| Loc: ?(.*?)(?: \| Routine: (.*))?$/);
    if (!r) { rows.push({ badLine: line }); continue; }
    rows.push({
      sec: r[1].trim(), award: r[2].trim(), placeNum: r[3].trim(),
      who: r[4].trim(), studio: r[5].trim(), loc: r[6].trim(),
      routine: (r[7] || '').trim(),
    });
  }
  return rows;
}

// split "A (X), B, C (Y)" on commas outside parentheses
function splitRecipients(who) {
  return who.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
}

// map an extracted row to one or more award specs
function toSpecs(r) {
  const specs = [];
  const isEnsemble = r.sec.startsWith('ENSEMBLE');
  const isSpecial = r.sec === 'SPECIAL AWARDS';
  const gpMatch = r.sec.match(/^GRAND PRIX — (.+)$/);

  if (isSpecial && SKIP_SPECIALS.test(r.award)) return { specs, skipped: 1 };

  if (isSpecial && SCHOOL_SPECIAL.test(r.award)) {
    specs.push({ place: r.award, ageDiv: 'SPECIAL AWARDS', category: '', routine: '',
      studioName: r.who, dancers: [], first: false });
    return { specs, skipped: 0 };
  }

  if (isEnsemble) {
    const category = r.sec.replace(/^ENSEMBLE — /, '');
    specs.push({ place: r.award, ageDiv: 'ENSEMBLE DIVISION', category, routine: r.routine,
      studioName: r.studio, dancers: splitRecipients(r.who).map(d => d.replace(/\s*\(.*\)$/, '')),
      first: FIRSTS.test(r.award) });
    return { specs, skipped: 0 };
  }

  if (gpMatch) {
    specs.push({ place: 'GRAND PRIX RECIPIENT', ageDiv: `${gpMatch[1]} DIVISION`, category: '', routine: '',
      studioName: r.studio, dancers: [r.who], solo: true, first: true });
    return { specs, skipped: 0 };
  }

  if (isSpecial) {
    // may name several recipients, each optionally with "(Their Studio)"
    for (const token of splitRecipients(r.who)) {
      const m = token.match(/^(.+?)\s*\(([^()]+)\)$/);
      const name = m ? m[1].trim() : token;
      let studioName = m ? m[2].trim() : r.studio;
      studioName = studioName.replace(/,\s*[A-Z]{2}$/, '').trim();
      specs.push({ place: r.award, ageDiv: 'SPECIAL AWARDS', category: '', routine: '',
        studioName, dancers: [name], solo: true, first: false });
    }
    return { specs, skipped: 0 };
  }

  // solo medal/placement/top-N row
  specs.push({ place: r.award, ageDiv: `${r.sec} DIVISION`, category: '', routine: '',
    studioName: r.studio, dancers: [r.who], solo: true, first: FIRSTS.test(r.award) });
  return { specs, skipped: 0 };
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

  const files = fs.readdirSync(txtDir).filter(f => /^\d{4}\.txt$/.test(f)).sort();
  const studioCache = new Map();
  const dancerCache = new Map();
  const totals = { events: 0, newEvents: 0, inserted: 0, existing: 0, skippedSpecials: 0, newStudios: 0, newDancers: 0, links: 0, badLines: 0 };

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
    const year = parseInt(f, 10);
    const rows = parseTxt(fs.readFileSync(path.join(txtDir, f), 'utf8'));
    const bad = rows.filter(r => r.badLine);
    if (bad.length) {
      console.error(`${f}: ${bad.length} unparseable line(s), e.g. "${bad[0].badLine.slice(0, 80)}" — fix and re-run. SKIPPED.`);
      totals.badLines += bad.length;
      continue;
    }
    if (!rows.length) { console.log(`${f}: no rows — skipped`); continue; }

    const eventName = `ADC IBC ${year} St. Petersburg FL World Finals`;
    totals.events++;
    let event = await db.get('SELECT * FROM events WHERE org_id = ? AND name = ? AND year = ?', [org.id, eventName, year]);
    if (!event) {
      totals.newEvents++;
      if (apply) {
        await db.run('INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)',
          [org.id, eventName, year, String(year), `https://www.adcibc.com/${year}-winners`]);
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
        const { specs, skipped } = toSpecs(r);
        totals.skippedSpecials += skipped || 0;
        for (const spec of specs) {
          const studioId = await ensureStudioMaybe(spec, apply, ensureStudio);
          if (!event) { inserted++; continue; } // dry run on a brand-new event

          // resolve solo dancer first — it is part of the idempotency key
          let dancerId = null;
          if (spec.solo && spec.dancers.length === 1 && studioId !== null && apply) {
            dancerId = await ensureDancer(spec.dancers[0], studioId);
          }
          const dupe = await db.get(
            `SELECT id FROM awards WHERE event_id = ? AND IFNULL(place, '') = ? AND IFNULL(age_division, '') = ?
               AND IFNULL(category, '') = ? AND IFNULL(performance_name, '') = ?
               AND IFNULL(studio_id, -1) = ? AND IFNULL(dancer_id, -1) = ?`,
            [event.id, spec.place, spec.ageDiv, spec.category, spec.routine,
              studioId === null ? -1 : studioId, dancerId === null ? -1 : dancerId]);
          if (dupe) { existing++; continue; }
          inserted++;
          if (apply) {
            const ins = await db.run(
              `INSERT INTO awards (event_id, place, performance_name, award_type, category, age_division, studio_id, dancer_id, is_first_place)
               VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`,
              [event.id, spec.place, spec.routine || null, spec.category || null, spec.ageDiv,
                studioId, dancerId, spec.first ? 1 : 0]);
            if (!spec.solo && spec.dancers.length && studioId !== null) {
              for (const dName of spec.dancers) {
                const dId = await ensureDancer(dName, studioId);
                await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [ins.lastID, dId]);
                totals.links++;
              }
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
    `${totals.newStudios} new studios, ${totals.newDancers} new dancers, ${totals.links} ensemble dancer links, ` +
    `${totals.skippedSpecials} non-dancer specials skipped (choreographer/coach/photographer).`);
  if (!apply) console.log('Re-run with --apply to write. (Review the txt files first!)');
  if (totals.badLines) console.log(`⚠ ${totals.badLines} unparseable lines — those files were skipped entirely.`);
}

// studio for a spec (shared by solo/ensemble/school paths)
async function ensureStudioMaybe(spec, apply, ensureStudio) {
  return spec.studioName ? await ensureStudio(spec.studioName) : null;
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
