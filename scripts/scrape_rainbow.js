const cheerio = require('cheerio');
const { fetchWithCache } = require('./fetch_cache');
const { openDb } = require('../database');
const crypto = require('crypto');
const slugify = require('slugify');
const { generateDancerId, generateStudioId } = require('../utils');

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
        // The results site nests a "Play Video" link inside the routine
        // cell; .text() concatenates it into the title ("Steam Heat Play
        // Video"). Strip it — it also breaks import idempotency (suffixed
        // refetch != clean prior row -> re-insert). See fix_play_video_titles.js.
        perfName = perfName.replace(/(\s*Play Video)+\s*$/i, '').trim();
        // Studio-level awards have no routine; the site renders the cell
        // as a bare "– #" placeholder. Store blank, not the placeholder
        // (display groups blank-name dancer-less awards as "Studio Awards").
        if (/^[–—-]?\s*#?$/.test(perfName)) {
          perfName = '';
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

      // Ensure studio exists — following merges, so re-imports land on the
      // canonical studio instead of resurrecting a merged-away duplicate.
      let studio = await db.get(`SELECT id, status, merged_into_id FROM studios WHERE name = ?`, [studioName]);
      if (studio && studio.status === 'merged' && studio.merged_into_id) {
        studio = { id: studio.merged_into_id };
      }
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

      let awardClass = 'adjudication';
      const typeLower = awardType.toLowerCase();
      if (typeLower.includes('high score') || typeLower.includes('overall') || typeLower.includes('champion') || typeLower.includes('place')) {
        awardClass = 'overall';
      } else if (typeLower.includes('scholarship') || typeLower.includes('dancer of the year')) {
        awardClass = 'scholarship';
      } else if (typeLower.includes('title') || typeLower.includes('miss') || typeLower.includes('mr.')) {
        awardClass = 'title';
      } else if (typeLower.includes('studio') || typeLower.includes('sportsmanship')) {
        awardClass = 'studio';
      } else if (typeLower.includes('judges') || typeLower.includes('entertaining') || typeLower.includes('choreography')) {
        awardClass = 'special';
      }

      // Insert award if it doesn't already exist. The identity key is the
      // award's OBSERVABLE fields (event, studio, type, routine, category,
      // place) — NEVER award_class, which is derived by our own classifier:
      // including it once caused every classifier improvement to re-insert
      // the whole event (8,835 duplicate awards, repaired 2026-08-21 by
      // scripts/dedup_reimported_awards.js — keep the two keys in sync).
      const existingAward = await db.get(
        `SELECT id, award_class FROM awards
         WHERE event_id = ? AND studio_id = ? AND award_type = ? AND category = ?
           AND performance_name = ? AND IFNULL(place, "") = IFNULL(?, "")`,
        [event.id, studio.id, awardType, category, perfName, place]
      );

      if (!existingAward) {
        await db.run(
          `INSERT INTO awards (event_id, place, performance_name, performance_number, award_class, award_type, category, dancer_id, studio_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [event.id, place, perfName, perfNumber, awardClass, awardType, category, dancerId, studio.id]
        );
      } else if (existingAward.award_class !== awardClass) {
        // Classifier improvements propagate in place instead of duplicating
        await db.run('UPDATE awards SET award_class = ? WHERE id = ?', [awardClass, existingAward.id]);
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
