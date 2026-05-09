const axios = require('axios');
const cheerio = require('cheerio');
const { openDb } = require('./database');
const crypto = require('crypto');
const slugify = require('slugify');
const { generateDancerId, generateStudioId } = require('./utils');

async function scrapeDanceKar() {
  const url = 'https://dancekar.com/competition/results/2026/1900';
  console.log(`Fetching data from ${url}...`);
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  const db = await openDb();

  // 1. Seed Organization
  let org = await db.get(`SELECT id FROM organizations WHERE slug = ?`, ['kar']);
  if (!org) {
    const res = await db.run(`INSERT INTO organizations (name, slug, website) VALUES (?, ?, ?)`, ['KAR Dance Competition', 'kar', 'https://dancekar.com']);
    org = { id: res.lastID };
  }

  // 2. Seed Event
  let event = await db.get(`SELECT id FROM events WHERE url = ?`, [url]);
  if (!event) {
    const eventName = 'Hayward, CA - 2/13/2026';
    const res = await db.run(`INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)`, [org.id, eventName, 2026, '2/13/2026', url]);
    event = { id: res.lastID };
  }

  const tables = $('table.table-bordered');
  console.log(`Found ${tables.length} tables to process.`);

  for (let i = 0; i < tables.length; i++) {
    const table = tables.eq(i);
    const categoryContainer = table.prev();
    const awardType = categoryContainer.text().trim() || 'Unknown Award Type';
    
    // Parse headers to find column indices
    const headers = table.find('thead th').map((i, el) => $(el).text().trim()).get();
    
    // Default standard indices
    let placeIdx = 0, perfIdx = 1, studioIdx = 2, dancerIdx = 3, categoryIdx = -1;
    
    const headerStr = headers.join(' | ');
    if (headerStr.includes('Place | Performance Name | Studio | Dancer')) {
      placeIdx = 0; perfIdx = 1; studioIdx = 2; dancerIdx = 3; categoryIdx = -1;
    } else if (headerStr.includes(' | Performance Name | Studio | Dancer')) {
      placeIdx = 0; perfIdx = 1; studioIdx = 2; dancerIdx = 3; categoryIdx = -1;
    } else if (headerStr.includes(' | Performance Name | Studio | Category')) {
      placeIdx = 0; perfIdx = 1; studioIdx = 2; dancerIdx = -1; categoryIdx = 3;
    } else if (headerStr.includes(' | Dancer | Studio | Category')) {
      placeIdx = 0; perfIdx = -1; dancerIdx = 1; studioIdx = 2; categoryIdx = 3;
    }

    // Process rows
    const rows = table.find('tbody tr');
    for (let j = 0; j < rows.length; j++) {
      const row = rows.eq(j);
      const cols = row.find('td');
      
      const place = $(cols[placeIdx]).text().trim();
      let perfName = '', perfNumber = '', studioName = '', dancerNames = '', category = '';

      if (perfIdx >= 0 && cols[perfIdx]) {
        let perfInfo = $(cols[perfIdx]).text().trim().replace(/\s+/g, ' ');
        perfName = perfInfo;
        const match = perfInfo.match(/#(\d+)\s+(.+)/);
        if (match) {
          perfNumber = match[1];
          perfName = match[2];
        }
      }

      if (studioIdx >= 0 && cols[studioIdx]) {
        studioName = $(cols[studioIdx]).text().trim();
      }

      if (dancerIdx >= 0 && cols[dancerIdx]) {
        dancerNames = $(cols[dancerIdx]).text().trim();
      }

      if (categoryIdx >= 0 && cols[categoryIdx]) {
        category = $(cols[categoryIdx]).text().trim();
      }

      if (!studioName) continue;

      // 3. Ensure studio exists (with unique_id)
      let studio = await db.get(`SELECT id FROM studios WHERE name = ?`, [studioName]);
      if (!studio) {
        const studioUuid = generateStudioId(studioName);
        const res = await db.run(`INSERT INTO studios (unique_id, name) VALUES (?, ?)`, [studioUuid, studioName]);
        studio = { id: res.lastID };
      }

      let dancerId = null;
      // 4. Handle Dancer if it's a solo
      if (awardType.toLowerCase().includes('solo') && dancerNames) {
        let dancer = await db.get(`
          SELECT d.id FROM dancers d
          JOIN dancer_studios ds ON d.id = ds.dancer_id
          WHERE d.name = ? AND ds.studio_id = ?
        `, [dancerNames, studio.id]);
        if (!dancer) {
          const uniqueId = generateDancerId(dancerNames);
          const res = await db.run(`INSERT INTO dancers (unique_id, name) VALUES (?, ?)`, [uniqueId, dancerNames]);
          dancer = { id: res.lastID };
        }
        dancerId = dancer.id;

        // 5. Ensure dancer_studios pivot exists
        const pivot = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [dancerId, studio.id]);
        if (!pivot) {
          await db.run(`INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)`, [dancerId, studio.id]);
        }
      }

      const existingAward = await db.get(
        'SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name = ? AND place = ?',
        [event.id, category, perfName, place]
      );

      if (!existingAward) {
        await db.run(
          `INSERT INTO awards (event_id, place, performance_name, performance_number, award_type, category, dancer_id, studio_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [event.id, place, perfName, perfNumber, awardType, category, dancerId, studio.id]
        );
      }
    }
  }
  console.log("Scraping completed and data saved to database.");
}

if (require.main === module) {
  scrapeDanceKar().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { scrapeDanceKar };
