const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { generateDancerId, generateStudioId } = require('../utils');

const db = new sqlite3.Database('./database.sqlite');
db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));

async function getOrCreateOrg(orgName = 'Showstopper', website = 'https://goshowstopper.com') {
  let org = await db.getAsync('SELECT * FROM organizations WHERE name = ?', [orgName]);
  if (!org) {
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await db.runAsync('INSERT INTO organizations (name, slug, website) VALUES (?, ?, ?)', [orgName, slug, website]);
    org = await db.getAsync('SELECT * FROM organizations WHERE name = ?', [orgName]);
    console.log(`Created Organization: ${orgName}`);
  }
  return org;
}

async function getOrCreateEvent(orgId, city, year) {
  const eventName = `Showstopper - ${city}`;
  let event = await db.getAsync('SELECT * FROM events WHERE org_id = ? AND name = ? AND year = ?', [orgId, eventName, year]);
  if (!event) {
    await db.runAsync('INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)', [orgId, eventName, year, String(year), '']);
    event = await db.getAsync('SELECT * FROM events WHERE org_id = ? AND name = ? AND year = ?', [orgId, eventName, year]);
  }
  return event;
}

async function getOrCreateStudio(studioName) {
  const name = studioName && studioName.trim() !== '' && studioName.trim().toLowerCase() !== 'n/a' ? studioName.trim() : 'Unknown Studio';
  let studio = await db.getAsync('SELECT * FROM studios WHERE LOWER(name) = LOWER(?)', [name]);
  if (!studio) {
    const uniqueId = generateStudioId(name);
    await db.runAsync('INSERT INTO studios (unique_id, name) VALUES (?, ?)', [uniqueId, name]);
    studio = await db.getAsync('SELECT * FROM studios WHERE LOWER(name) = LOWER(?)', [name]);
  }
  return studio;
}

function parseFilename(filename, folderYear) {
  // filename like: battle-creek.txt
  const base = filename.replace('.txt', '');
  // replace dashes with spaces, capitalize words
  const city = base.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return { city, year: parseInt(folderYear) };
}

async function processFile(filePath, filename, folderYear, orgId) {
  const { city, year } = parseFilename(filename, folderYear);
  const event = await getOrCreateEvent(orgId, city, year);
  console.log(`Processing Event: ${event.name} (${event.year})`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.startsWith('Cat: ')) continue;
    
    // Cat: Mini (8 yrs. & Under) Solo | Level: Advanced | Place: 1 | Routine: Sweet Child O' Mine | Dancer: Scarlett Pieroni | Studio: Devotion Dance Academy
    const match = line.match(/Cat: (.*) \| Level: (.*) \| Place: (.*) \| Routine: (.*) \| Dancer: (.*) \| Studio: (.*)/);
    if (!match) continue;

    const [_, category, levelRaw, placeRaw, routineStr, dancerStr, studioStr] = match;
    
    // Ignore PDF artifacts
    if (category && category.toLowerCase().includes('running order')) continue;
    if (dancerStr && dancerStr !== 'N/A' && dancerStr !== 'null' && dancerStr.trim().length <= 2) continue;

    const place = placeRaw === 'N/A' || placeRaw === 'null' ? null : placeRaw;
    const routine = routineStr === 'N/A' || routineStr === 'null' ? null : routineStr;
    const awardClass = 'overall';
    const awardType = 'High Score';
    // Showstopper has "Level" like "Advanced", we can append it to the category or just use the category.
    // Let's keep category exactly as parsed (e.g. "Mini (8 yrs. & Under) Solo") and maybe prepend Level
    const finalCategory = `${levelRaw.trim()} - ${category.trim()}`;

    const studio = await getOrCreateStudio(studioStr);
    const studioId = studio ? studio.id : null;

    let dancers = [];
    if (dancerStr && dancerStr !== 'N/A' && dancerStr !== 'null') {
      dancers = dancerStr.split(/,|&/).map(d => d.trim()).filter(d => d.length > 0);
    }

    // Idempotency Check & Award Creation
    let awardId = null;
    let award = await db.getAsync(
      'SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name IS ? AND place IS ? AND award_class = ? AND studio_id IS ?',
      [event.id, finalCategory, routine, place, awardClass, studioId]
    );
    
    if (!award) {
      await db.runAsync(`
        INSERT INTO awards (event_id, place, performance_name, category, award_class, award_type, studio_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [event.id, place, routine, finalCategory, awardClass, awardType, studioId]);
      award = await db.getAsync('SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name IS ? AND place IS ? AND award_class = ? AND studio_id IS ?', [event.id, finalCategory, routine, place, awardClass, studioId]);
    }
    awardId = award.id;

    // Dancer Linking
    for (const dName of dancers) {
      let dancer = await db.getAsync('SELECT d.* FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id WHERE LOWER(d.name) = LOWER(?) AND ds.studio_id = ?', [dName, studioId]);
      
      if (!dancer) {
        const uniqueId = generateDancerId(dName);
        await db.runAsync('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [uniqueId, dName]);
        dancer = await db.getAsync('SELECT * FROM dancers WHERE unique_id = ?', [uniqueId]);
      }

      await db.runAsync('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [awardId, dancer.id]);
      if (studioId) {
        await db.runAsync('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, ?)', [dancer.id, studioId, 'active']);
      }
    }
  }
}

async function run() {
  const baseTxtDir = path.join(__dirname, '..', 'tobeprocessed', 'pdf', 'showstopper', 'txt');
  if (!fs.existsSync(baseTxtDir)) {
    console.error("Txt directory not found!");
    return;
  }

  const org = await getOrCreateOrg();

  await db.runAsync('BEGIN TRANSACTION');
  try {
    const years = ['2023', '2024', '2025'];
    for (const year of years) {
      const yearDir = path.join(baseTxtDir, year);
      if (fs.existsSync(yearDir)) {
        const files = fs.readdirSync(yearDir).filter(f => f.endsWith('.txt'));
        console.log(`Found ${files.length} valid Showstopper results files for ${year}.`);
        
        let i = 0;
        for (const file of files) {
          i++;
          console.log(`[${year} - ${i}/${files.length}] Processing ${file}`);
          await processFile(path.join(yearDir, file), file, year, org.id);
        }
      }
    }
    
    await db.runAsync('COMMIT');
    console.log(`\nImport complete!`);
  } catch (error) {
    await db.runAsync('ROLLBACK');
    console.error("Fatal error during import, rolling back:", error);
  }
}

run().catch(console.error);
