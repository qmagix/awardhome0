const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const crypto = require('crypto');

// Promisify SQLite methods
const db = new sqlite3.Database('./database.sqlite');
db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));
db.allAsync = promisify(db.all.bind(db));

async function getOrCreateOrg(orgName = 'Starpower Talent Competition') {
  const name = orgName;
  let org = await db.getAsync('SELECT * FROM organizations WHERE name = ?', [name]);
  if (!org) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await db.runAsync('INSERT INTO organizations (name, slug) VALUES (?, ?)', [name, slug]);
    org = await db.getAsync('SELECT * FROM organizations WHERE name = ?', [name]);
  }
  return org;
}

async function getOrCreateEvent(orgId, url, dateString, location) {
  let event = await db.getAsync('SELECT * FROM events WHERE url = ? AND org_id = ?', [url, orgId]);
  if (!event) {
    // Attempt to extract year from date string (e.g. "April 17, 2026")
    const yearMatch = dateString.match(/\b(20[1-3][0-9])\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
    const name = `Starpower - ${location}`;
    await db.runAsync('INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)', [orgId, name, year, dateString, url]);
    event = await db.getAsync('SELECT * FROM events WHERE url = ? AND org_id = ?', [url, orgId]);
  }
  return event;
}

function generateUniqueId() {
  return crypto.randomBytes(8).toString('hex');
}

async function getOrCreateStudio(studioName) {
  if (!studioName || studioName.trim() === '') return null;
  const name = studioName.trim();
  let studio = await db.getAsync('SELECT * FROM studios WHERE LOWER(name) = LOWER(?)', [name]);
  if (!studio) {
    const uniqueId = 'STU-' + generateUniqueId();
    await db.runAsync('INSERT INTO studios (unique_id, name) VALUES (?, ?)', [uniqueId, name]);
    studio = await db.getAsync('SELECT * FROM studios WHERE LOWER(name) = LOWER(?)', [name]);
    console.log(`    [+] Created new studio: ${name}`);
  }
  return studio;
}

async function run() {
  const url = process.argv[2] || 'https://db-all-prod-p.s3.us-east-2.amazonaws.com/comps/327/117917/results-all-results.html';
  const passedLocation = process.argv[3];
  
  console.log(`Fetching ${url}...`);
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  
  // Sanitize DOM
  $('script').remove();
  $('style').remove();

  let locationDateStr = passedLocation || 'Unknown Event';
  
  if (!passedLocation) {
    // Fallback if run standalone
    const firstTable = $('table').eq(1);
    if (firstTable.length > 0) {
      locationDateStr = firstTable.text().trim().replace(/\s+/g, ' ');
    }
  }
  
  console.log(`Event metadata: ${locationDateStr}`);

  // 2. Look up Org and Event
  const org = await getOrCreateOrg('Starpower Talent Competition');
  const event = await getOrCreateEvent(org.id, url, locationDateStr, locationDateStr.split('20')[0].trim()); // Rough heuristic for location name
  console.log(`Event DB Record ID: ${event.id} (Year: ${event.year})`);

  // 3. Parse Categories
  let totalAwards = 0;
  
  const tables = $('table');
  await db.runAsync('BEGIN TRANSACTION');
  try {
    for (let i = 0; i < tables.length; i++) {
      const tbl = tables[i];
    
    // Skip massive layout wrapper tables to prevent parsing them as categories
    if ($(tbl).find('table').length > 5) {
      continue;
    }
    
    const directRows = [];
    $(tbl).children('thead').children('tr').each((i, el) => directRows.push(el));
    $(tbl).children('tbody').children('tr').each((i, el) => directRows.push(el));
    $(tbl).children('tr').each((i, el) => directRows.push(el));
    
    if (directRows.length >= 2) {
      const categoryTitle = $(directRows[0]).text().trim().replace(/\s+/g, ' ');
      const nestedTable = $(directRows[1]).find('table');
      
      if (categoryTitle && nestedTable.length > 0) {
        // We found a category!
        console.log(`\nParsing Category: ${categoryTitle}`);
        
        const dataRows = nestedTable.first().find('tr');
        
        // Let's determine format (A vs B)
        const headerRowText = dataRows.first().text().trim();
        const isFormatA = headerRowText.includes('Place') && headerRowText.includes('Routine Name');
        
        for (let r = 0; r < dataRows.length; r++) {
          if (isFormatA && r === 0) continue; // Skip header row
          
          const row = dataRows[r];
          const cols = $(row).find('th, td').map((k, col) => $(col).text().trim()).get();
          if (cols.length === 0) continue;
          
          let place = null;
          let routine = null;
          let studioName = null;
          
          if (isFormatA) {
            // Place | Routine Name | Studio
            if (cols.length >= 3) {
              place = cols[0];
              routine = cols[1];
              studioName = cols[2];
            } else if (cols.length === 2) {
              // Sometimes it's Place | Routine Name, no Studio?
              place = cols[0];
              routine = cols[1];
            }
          } else {
            // Format B: Single column string like 'Routine Name - Studio'
            const str = cols[0];
            const parts = str.split(' - ');
            if (parts.length >= 2) {
              routine = parts[0].trim();
              studioName = parts.slice(1).join(' - ').trim();
              place = 'Winner'; // Default place for single-winner special awards
            } else {
              routine = str;
              place = 'Winner';
            }
          }
          
          if (!routine) continue; // Skip empty rows
          
          const studio = await getOrCreateStudio(studioName);
          const studioId = studio ? studio.id : null;
          
          // Idempotency check: Only insert if it doesn't already exist
          const existingAward = await db.getAsync(
            'SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name = ? AND place = ?',
            [event.id, categoryTitle, routine, place]
          );

          if (!existingAward) {
            await db.runAsync(`
              INSERT INTO awards (event_id, place, performance_name, category, studio_id) 
              VALUES (?, ?, ?, ?, ?)
            `, [event.id, place, routine, categoryTitle, studioId]);
            totalAwards++;
          }
        }
      } else if (categoryTitle && directRows.length >= 3) {
        // Format C: Single table, no nested table. Headers in row 1, data in row 2+
        const headers = $(directRows[1]).find('th, td').map((k, col) => $(col).text().trim()).get();
        const entryIdx = headers.findIndex(h => h.includes('Entry #'));
        const routineIdx = headers.findIndex(h => h.includes('Routine Name'));
        const dancerIdx = headers.findIndex(h => h.includes('Dancers Names') || h.includes('Dancer Name'));
        const studioIdx = headers.findIndex(h => h.includes('Studio'));

        if (routineIdx !== -1) {
          console.log(`\nParsing Choice Category: ${categoryTitle}`);
          for (let r = 2; r < directRows.length; r++) {

            const row = directRows[r];
            const cols = $(row).find('th, td').map((k, col) => $(col).text().trim()).get();
            if (cols.length === 0 || !cols[routineIdx]) continue;

            const entryNumber = entryIdx !== -1 ? cols[entryIdx] : null;
            const routine = cols[routineIdx];
            const dancerNames = dancerIdx !== -1 ? cols[dancerIdx] : null;
            const studioName = studioIdx !== -1 ? cols[studioIdx] : null;

            const studio = await getOrCreateStudio(studioName);
            const studioId = studio ? studio.id : null;

            let award = await db.getAsync(
              'SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name = ? AND place = ?',
              [event.id, categoryTitle, routine, 'Winner']
            );

            if (!award) {
              await db.runAsync(`
                INSERT INTO awards (event_id, place, performance_name, performance_number, category, studio_id) 
                VALUES (?, ?, ?, ?, ?, ?)
              `, [event.id, 'Winner', routine, entryNumber, categoryTitle, studioId]);
              totalAwards++;
              award = await db.getAsync('SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name = ? ORDER BY id DESC LIMIT 1', [event.id, categoryTitle, routine]);
            }

            // Dancers mapping
            if (dancerNames && award) {
              const dancers = dancerNames.split(',').map(d => d.trim()).filter(d => d.length > 0);
              for (const dancerName of dancers) {
                let dancer = await db.getAsync('SELECT * FROM dancers WHERE LOWER(name) = LOWER(?)', [dancerName]);
                if (!dancer) {
                  const uniqueId = 'DNC-' + generateUniqueId();
                  await db.runAsync('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [uniqueId, dancerName]);
                  dancer = await db.getAsync('SELECT * FROM dancers WHERE LOWER(name) = LOWER(?)', [dancerName]);
                  console.log(`    [+] Created new dancer: ${dancerName}`);
                }
                await db.runAsync('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [award.id, dancer.id]);
                if (studioId) {
                  await db.runAsync('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, ?)', [dancer.id, studioId, 'active']);
                }
              }
            }
          }
        }
      }
      }
    }
    await db.runAsync('COMMIT');
  } catch (error) {
    await db.runAsync('ROLLBACK');
    console.error("Fatal error during parsing, rolling back transaction:", error);
    throw error;
  }
  
  console.log(`\n--- Import Complete ---`);
  console.log(`Inserted ${totalAwards} awards successfully!`);
}

run().catch(console.error);
