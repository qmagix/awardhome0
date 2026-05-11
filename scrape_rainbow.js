const cheerio = require('cheerio');
const { fetchWithCache } = require('./fetch_cache');
const { openDb } = require('./database');
const crypto = require('crypto');
const slugify = require('slugify');
const { generateDancerId, generateStudioId } = require('./utils');

async function scrapeRainbow(url, year = 2026) {
  if (!url) {
    url = `https://rainbowdance.com/results/${year}/824`;
  }
  console.log(`Fetching data from ${url}...`);
  const { data } = await fetchWithCache(url, 'rainbow', year);
  const $ = cheerio.load(data);
  const db = await openDb();

  let org = await db.get(`SELECT id FROM organizations WHERE slug = ?`, ['rainbow']);
  if (!org) {
    console.error("Rainbow organization not found. Please run seed_orgs.js first.");
    return;
  }

  let event = await db.get(`SELECT id FROM events WHERE url = ?`, [url]);
  if (!event) {
    // Extract title
    const titleText = $('title').text() || 'Rainbow San Jose, CA';
    let eventName = 'San Jose, CA';
    let dateStr = '3/20/2026';
    
    // Parse title: Rainbow Dance Competition | San Jose, CA - 3/20/2026  Results & Highlights
    const parts = titleText.split('|');
    if (parts.length > 1) {
       const subparts = parts[1].split('Results');
       const locDate = subparts[0].trim();
       const locDateParts = locDate.split(' - ');
       if (locDateParts.length > 1) {
           eventName = locDateParts[0].trim();
           dateStr = locDateParts[1].trim();
       } else {
           eventName = locDate;
       }
    }

    if (!eventName.toLowerCase().startsWith('rainbow')) {
      eventName = `Rainbow - ${eventName}`;
    }
    const res = await db.run(`INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)`, [org.id, eventName, year, dateStr, url]);
    event = { id: res.lastID };
  }

  const tables = $('table');
  console.log(`Found ${tables.length} tables to process.`);

  for (let i = 0; i < tables.length; i++) {
    const table = tables.eq(i);
    const categoryContainer = table.prev();
    const awardType = categoryContainer.text().trim() || 'Unknown Award Type';
    
    // Skip empty tables or tables that don't look like results
    if (!awardType || awardType === 'Unknown Award Type' || table.find('thead th').length === 0) {
      continue;
    }
    
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

      // Ensure studio exists
      let studio = await db.get(`SELECT id FROM studios WHERE name = ?`, [studioName]);
      if (!studio) {
        const studioUuid = generateStudioId(studioName);
        const res = await db.run(`INSERT INTO studios (unique_id, name) VALUES (?, ?)`, [studioUuid, studioName]);
        studio = { id: res.lastID };
      }

      let dancerId = null;
      // Handle Dancer if it's a solo
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

        const pivot = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [dancerId, studio.id]);
        if (!pivot) {
          await db.run(`INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)`, [dancerId, studio.id]);
        }
      }

      // Insert award if it doesn't already exist
      const existingAward = await db.get(
        'SELECT id FROM awards WHERE event_id = ? AND category = ? AND performance_name = ? AND IFNULL(place, "") = IFNULL(?, "")',
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
  scrapeRainbow().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { scrapeRainbow };
