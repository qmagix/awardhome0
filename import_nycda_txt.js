const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { generateDancerId, generateStudioId } = require('./utils');

const db = new sqlite3.Database('./database.sqlite');
db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));

async function getOrCreateOrg(orgName = 'NYCDA') {
  let org = await db.getAsync('SELECT * FROM organizations WHERE name = ?', [orgName]);
  if (!org) {
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await db.runAsync('INSERT INTO organizations (name, slug) VALUES (?, ?)', [orgName, slug]);
    org = await db.getAsync('SELECT * FROM organizations WHERE name = ?', [orgName]);
  }
  return org;
}

async function getOrCreateEvent(orgId, city, year) {
  const eventName = `NYCDA - ${city}`;
  let event = await db.getAsync('SELECT * FROM events WHERE org_id = ? AND name = ? AND year = ?', [orgId, eventName, year]);
  if (!event) {
    await db.runAsync('INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)', [orgId, eventName, year, String(year), '']);
    event = await db.getAsync('SELECT * FROM events WHERE org_id = ? AND name = ? AND year = ?', [orgId, eventName, year]);
  }
  return event;
}

async function getOrCreateStudio(studioName) {
  if (!studioName || studioName.trim() === '' || studioName.trim().toLowerCase() === 'n/a') return null;
  const name = studioName.trim();
  let studio = await db.getAsync('SELECT * FROM studios WHERE LOWER(name) = LOWER(?)', [name]);
  if (!studio) {
    const uniqueId = generateStudioId(name);
    await db.runAsync('INSERT INTO studios (unique_id, name) VALUES (?, ?)', [uniqueId, name]);
    studio = await db.getAsync('SELECT * FROM studios WHERE LOWER(name) = LOWER(?)', [name]);
    console.log(`    [+] Created new studio: ${name}`);
  }
  return studio;
}

function parseFilename(filename) {
  // GOOD-atlanta_Atlanta-Comp-2025.pdf.txt
  const base = filename.replace('GOOD-', '');
  const city = base.split('_')[0].charAt(0).toUpperCase() + base.split('_')[0].slice(1).replace('-', ' ');
  
  let year = 2025; // fallback
  if (base.includes('25-26') || base.includes('2026') || base.includes('-26')) year = 2026;
  else if (base.includes('24-25') || base.includes('2025') || base.includes('-25')) year = 2025;
  else if (base.includes('23-24') || base.includes('2024') || base.includes('-24')) year = 2024;
  else if (base.includes('22-23') || base.includes('2023') || base.includes('-23')) year = 2023;
  else if (base.includes('21-22') || base.includes('2022') || base.includes('-22')) year = 2022;
  
  return { city, year };
}

async function processFile(filePath, filename, orgId) {
  const { city, year } = parseFilename(filename);
  const event = await getOrCreateEvent(orgId, city, year);
  console.log(`Processing Event: ${event.name} (${event.year})`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.startsWith('Cat: ')) continue;
    
    // Cat: Mini High Score Soloist | Class: overall | Award: High Score | Place: 10th | Routine: Dreamer | Dancer: Annika Linder | Studio: The Atlanta Dance Academy, GA
    const match = line.match(/Cat: (.*) \| Class: (.*) \| Award: (.*) \| Place: (.*) \| Routine: (.*) \| Dancer: (.*) \| Studio: (.*)/);
    if (!match) continue;

    const [_, category, awardClass, awardType, placeRaw, routineStr, dancerStr, studioStr] = match;
    
    // Ignore PDF artifacts
    if (category && (category.toLowerCase().includes('running order') || category.toLowerCase().includes('stage '))) continue;
    if (dancerStr && dancerStr !== 'N/A' && dancerStr !== 'null' && dancerStr.trim().length <= 2) continue;

    const place = placeRaw === 'N/A' || placeRaw === 'null' ? null : placeRaw;
    const routine = routineStr === 'N/A' || routineStr === 'null' ? null : routineStr;
    const isConvention = awardClass === 'scholarship' && !routine;
    const isStudio = awardClass === 'studio';

    const studio = await getOrCreateStudio(studioStr);
    const studioId = studio ? studio.id : null;

    let dancers = [];
    if (dancerStr && dancerStr !== 'N/A' && dancerStr !== 'null') {
      dancers = dancerStr.split(/,|&/).map(d => d.trim()).filter(d => d.length > 0);
    }

    // 1. Idempotency Check & Award Creation
    let awardId = null;
    if (isConvention || isStudio) {
      // For conventions and studio awards, we group by category, class, and studio.
      let award = await db.getAsync(
        'SELECT id FROM awards WHERE event_id = ? AND category = ? AND award_class = ? AND studio_id IS ?',
        [event.id, category, awardClass, studioId]
      );
      if (!award) {
        await db.runAsync(`
          INSERT INTO awards (event_id, place, performance_name, category, award_class, award_type, studio_id) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [event.id, place, routine, category, awardClass, awardType, studioId]);
        award = await db.getAsync('SELECT id FROM awards WHERE event_id = ? AND category = ? AND award_class = ? AND studio_id IS ?', [event.id, category, awardClass, studioId]);
      }
      awardId = award.id;
    } else {
      // For competitions, we map by routine name, place, class, and studio.
      let award = await db.getAsync(
        'SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name IS ? AND place IS ? AND award_class = ? AND studio_id IS ?',
        [event.id, category, routine, place, awardClass, studioId]
      );
      if (!award) {
        await db.runAsync(`
          INSERT INTO awards (event_id, place, performance_name, category, award_class, award_type, studio_id) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [event.id, place, routine, category, awardClass, awardType, studioId]);
        award = await db.getAsync('SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name IS ? AND place IS ? AND award_class = ? AND studio_id IS ?', [event.id, category, routine, place, awardClass, studioId]);
      }
      awardId = award.id;
    }

    // 2. Dancer Linking
    for (const dName of dancers) {
      let dancer = null;
      if (studioId) {
        dancer = await db.getAsync('SELECT d.* FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id WHERE LOWER(d.name) = LOWER(?) AND ds.studio_id = ?', [dName, studioId]);
      }
      if (!dancer) {
        dancer = await db.getAsync('SELECT * FROM dancers WHERE LOWER(name) = LOWER(?) LIMIT 1', [dName]);
      }
      
      if (!dancer) {
        const uniqueId = generateDancerId(dName);
        await db.runAsync('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [uniqueId, dName]);
        dancer = await db.getAsync('SELECT * FROM dancers WHERE unique_id = ?', [uniqueId]);
        console.log(`    [+] Created new dancer: ${dName}`);
      }

      await db.runAsync('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [awardId, dancer.id]);
      if (studioId) {
        await db.runAsync('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, ?)', [dancer.id, studioId, 'active']);
      }
    }
  }
}

async function run() {
  const txtDir = path.join(__dirname, 'tobeprocessed', 'pdf', 'nycda', 'txt');
  if (!fs.existsSync(txtDir)) {
    console.error("Txt directory not found!");
    return;
  }

  const files = fs.readdirSync(txtDir).filter(f => f.endsWith('.txt') && !f.startsWith('IGNORE-'));
  console.log(`Found ${files.length} valid NYCDA results files.`);

  const org = await getOrCreateOrg();

  await db.runAsync('BEGIN TRANSACTION');
  try {
    let i = 0;
    for (const file of files) {
      i++;
      console.log(`[${i}/${files.length}] Processing ${file}`);
      await processFile(path.join(txtDir, file), file, org.id);
    }
    await db.runAsync('COMMIT');
    console.log(`\nImport complete!`);
  } catch (error) {
    await db.runAsync('ROLLBACK');
    console.error("Fatal error during import, rolling back:", error);
  }
}

run().catch(console.error);
