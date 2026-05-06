const axios = require('axios');
const cheerio = require('cheerio');
const { openDb } = require('./database');
const crypto = require('crypto');
const slugify = require('slugify');

// Add a simple sleep function to prevent rate-limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeKarYear(year) {
  const baseUrl = `https://dancekar.com/competition/results/${year}`;
  console.log(`Fetching events list from ${baseUrl}...`);
  const { data: listData } = await axios.get(baseUrl);
  const $list = cheerio.load(listData);
  
  const eventUrls = new Set();
  
  $list('a').each((i, el) => {
    const href = $list(el).attr('href');
    if (href && href.includes(`/competition/results/${year}/`) && href.includes('/overview')) {
      const match = href.match(new RegExp(`/competition/results/${year}/(\\d+)`));
      if (match) {
        eventUrls.add(`https://dancekar.com/competition/results/${year}/${match[1]}`);
      }
    }
  });

  const urlsToScrape = Array.from(eventUrls);
  console.log(`Found ${urlsToScrape.length} events to scrape for ${year}.`);
  
  const db = await openDb();
  
  // Seed Organization
  let org = await db.get(`SELECT id FROM organizations WHERE slug = ?`, ['kar']);
  if (!org) {
    console.error("KAR organization not found. Please run seed_orgs.js first.");
    return;
  }

  for (let i = 0; i < urlsToScrape.length; i++) {
    const url = urlsToScrape[i];
    console.log(`[${i+1}/${urlsToScrape.length}] Scraping ${url}...`);
    
    try {
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);
      
      let event = await db.get(`SELECT id FROM events WHERE url = ?`, [url]);
      if (!event) {
        const titleText = $('title').text() || `KAR ${year} Event`;
        let eventName = `KAR ${year} Event`;
        let dateStr = '';
        
        // title format: KAR Dance Competition - Mesa, AZ - 11/15/2024 Results
        const parts = titleText.split('-');
        if (parts.length >= 3) {
           eventName = parts[1].trim();
           dateStr = parts[2].replace('Results', '').trim();
        } else {
           eventName = titleText.replace('KAR Dance Competition - ', '').replace('Results', '').trim();
        }

        const res = await db.run(`INSERT INTO events (org_id, name, year, date_string, url) VALUES (?, ?, ?, ?, ?)`, [org.id, eventName, year, dateStr, url]);
        event = { id: res.lastID };
      }

      const tables = $('table.table-bordered');
      if (tables.length === 0) {
        console.log(`  -> No tables found. Skipping.`);
        await sleep(1000);
        continue;
      }
      
      console.log(`  -> Found ${tables.length} tables.`);

      for (let t = 0; t < tables.length; t++) {
        const table = tables.eq(t);
        const categoryContainer = table.prev();
        const awardType = categoryContainer.text().trim() || 'Unknown Award Type';
        
        const headers = table.find('thead th').map((i, el) => $(el).text().trim()).get();
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

          let studio = await db.get(`SELECT id FROM studios WHERE name = ?`, [studioName]);
          if (!studio) {
            const studioSlug = slugify(studioName, { lower: true, strict: true });
            const studioUuid = `${crypto.randomUUID()}-${studioSlug}`;
            const res = await db.run(`INSERT INTO studios (unique_id, name) VALUES (?, ?)`, [studioUuid, studioName]);
            studio = { id: res.lastID };
          }

          let dancerId = null;
          if (awardType.toLowerCase().includes('solo') && dancerNames) {
            let dancer = await db.get(`
              SELECT d.id FROM dancers d
              JOIN dancer_studios ds ON d.id = ds.dancer_id
              WHERE d.name = ? AND ds.studio_id = ?
            `, [dancerNames, studio.id]);
            if (!dancer) {
              const slug = slugify(dancerNames, { lower: true, strict: true });
              const uniqueId = `${crypto.randomUUID()}-${slug}`;
              const res = await db.run(`INSERT INTO dancers (unique_id, name) VALUES (?, ?)`, [uniqueId, dancerNames]);
              dancer = { id: res.lastID };
            }
            dancerId = dancer.id;

            const pivot = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [dancerId, studio.id]);
            if (!pivot) {
              await db.run(`INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)`, [dancerId, studio.id]);
            }
          }

          await db.run(
            `INSERT INTO awards (event_id, place, performance_name, performance_number, award_type, category, dancer_id, studio_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [event.id, place, perfName, perfNumber, awardType, category, dancerId, studio.id]
          );
        }
      }
    } catch (e) {
      console.error(`  -> Failed to scrape ${url}: ${e.message}`);
    }
    
    // Sleep to be polite to the server
    await sleep(1000);
  }
  
  console.log(`Finished scraping all ${year} events.`);
}

if (require.main === module) {
  scrapeKarYear(2025).then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { scrapeKarYear };
