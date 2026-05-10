const cheerio = require('cheerio');
const { fetchWithCache } = require('./fetch_cache');
const { openDb } = require('./database');
const crypto = require('crypto');
const slugify = require('slugify');
const { generateDancerId, generateStudioId } = require('./utils');

async function scrapeYagp(url, dryRun = true) {
  console.log(`Fetching YAGP Results from ${url}...`);
  try {
    const yearMatch = url.match(/yagp-(\d{4})-/i);
    const year = yearMatch ? yearMatch[1] : 'all';
    const { data } = await fetchWithCache(url, 'yagp', year);
    const $ = cheerio.load(data);
    
    const table = $('table').first();
    if (!table.length) {
      console.log("No table found on this page.");
      return;
    }

    let currentAgeDivision = '';
    let currentCategory = '';
    let pendingAward = null;
    let pendingPasDeDeux = null;
    let pendingSpecialAward = null;
    
    // Some event names are in the page title or URL
    const eventMatch = url.match(/yagp-(\d{4})-(.+)-winners/);
    const year = eventMatch ? eventMatch[1] : 'Unknown';
    const location = eventMatch ? eventMatch[2].replace(/-/g, ' ').toUpperCase() : 'Unknown';
    const eventName = `YAGP ${year} ${location}`;
    
    console.log(`\nEvent: ${eventName}`);
    console.log('====================================================');

    const parsedAwards = [];

    table.find('tr').each((i, row) => {
      // console.log("Processing row " + i);
      const cols = [];
      $(row).find('td, th').each((j, col) => {
        cols.push($(col).text().trim().replace(/\s+/g, ' '));
      });

      // Standard YAGP format has ~8 columns
      // [0] empty, [1] Place, [2] empty, [3] Name/Title, [4] empty, [5] Age/Type, [6] empty, [7] Studio
      const placeCol = cols[1] || '';
      const mainCol = cols[3] || '';
      const ageCol = cols[5] || '';
      const studioCol = cols[7] || '';

      // Check for Age Division
      if (mainCol.toUpperCase().includes('AGE DIVISION') || mainCol.toUpperCase() === 'PRE-COMPETITIVE') {
        currentAgeDivision = mainCol;
        pendingAward = null;
        return;
      }

      // Check for Category or Special Awards
      const mainUpper = mainCol.toUpperCase();
      if (mainUpper === 'ENSEMBLES' || mainUpper === 'PAS DE DEUX' || mainUpper.includes('PAS DE DEUX') || mainUpper.includes('ENSEMBLES') || mainUpper === 'SPECIAL AWARDS') {
        currentAgeDivision = ''; // Clear age division for ensembles section
      }
      if (!placeCol && !/^TOP\s+\d+/.test(mainUpper) && (mainUpper.includes('CATEGORY') || mainUpper.includes('ENSEMBLES') || mainUpper.includes('PAS DE DEUX') || mainUpper === 'SPECIAL AWARDS')) {
        currentCategory = mainCol;
        if (ageCol && mainUpper !== 'SPECIAL AWARDS') currentCategory += ` - ${ageCol}`;
        pendingAward = null;
        pendingPasDeDeux = null;
        pendingSpecialAward = null;
        return;
      }
      if (mainUpper.includes('OUTSTANDING CHOREOGRAPHER') || mainUpper.includes('OUTSTANDING TEACHER') || mainUpper.includes('OUTSTANDING SCHOOL')) {
        currentCategory = mainCol;
        currentAgeDivision = ''; // Clear age division for special awards
        pendingAward = 'Winner';
        return;
      }

      // Check for Top N Header (e.g., TOP 12, TOP 6, TOP 24)
      if (/^TOP\s+\d+/.test(mainUpper)) {
        pendingAward = mainCol;
        return;
      }

      const isPasDeDeux = currentCategory.toUpperCase().includes('PAS DE DEUX');
      
      if (isPasDeDeux) {
        if (pendingPasDeDeux && !placeCol && mainCol) {
           const dancer2 = mainCol.trim();
           const age2 = ageCol;
           const studio = studioCol;
           
           parsedAwards.push({
             place: pendingPasDeDeux.place,
             age_division: currentAgeDivision,
             category: currentCategory,
             dancer_name: [pendingPasDeDeux.dancer1, dancer2],
             performance_name: pendingPasDeDeux.performance,
             studio: studio,
             age: pendingPasDeDeux.age1 && age2 ? `${pendingPasDeDeux.age1}, ${age2}` : (pendingPasDeDeux.age1 || age2)
           });
           
           pendingPasDeDeux = null;
           return;
        } else if (placeCol || pendingAward) {
           const actualPlace = placeCol || pendingAward;
           if (mainCol) {
             pendingPasDeDeux = {
               place: actualPlace,
               dancer1: mainCol.replace('&', '').trim(),
               age1: ageCol,
               performance: studioCol
             };
           }
           return;
        }
      }
      
      if (currentCategory.toUpperCase() === 'SPECIAL AWARDS') {
         if (!pendingSpecialAward && mainCol) {
           pendingSpecialAward = mainCol;
           return;
         } else if (pendingSpecialAward && mainCol) {
           parsedAwards.push({
             place: pendingSpecialAward, // Put the special award name as the place
             age_division: currentAgeDivision,
             category: currentCategory,
             dancer_name: mainCol,
             performance_name: '',
             studio: '',
             age: ''
           });
           pendingSpecialAward = null;
           return;
         }
      }


      // Check for explicit Place Award
      const isExplicitAward = placeCol.toUpperCase().includes('PLACE') || 
                              placeCol.toUpperCase().includes('GRAND PRIX') || 
                              placeCol.toUpperCase().includes('TOP ') ||
                              placeCol.toUpperCase().includes('WINNER');

      // It is an award row if it has an explicit place, OR if it has a pending award state and a mainCol value
      if (isExplicitAward || (pendingAward && mainCol)) {
        const place = isExplicitAward ? placeCol : pendingAward;
        
        // Ensembles usually don't have dancer names, mainCol is the Performance Name
        const isEnsemble = currentCategory.toUpperCase().includes('ENSEMBLE');
        const isChoreographer = currentCategory.toUpperCase().includes('CHOREOGRAPHER');
        const isTeacher = currentCategory.toUpperCase().includes('TEACHER');
        const isSchool = currentCategory.toUpperCase().includes('SCHOOL');
        
        let dancerName = '';
        let perfName = '';
        let finalStudio = studioCol;
        
        if (isEnsemble) {
           perfName = mainCol;
        } else if (isChoreographer) {
           dancerName = mainCol;
           perfName = studioCol; // For choreography, studio col holds routine name
           finalStudio = '';
        } else if (isTeacher) {
           dancerName = mainCol;
        } else if (isSchool) {
           finalStudio = mainCol;
        } else {
           dancerName = mainCol;
        }

        // Only add if we actually extracted something meaningful
        if (dancerName || perfName || finalStudio) {
          const award = {
            place: place,
            age_division: currentAgeDivision,
            category: currentCategory,
            dancer_name: dancerName,
            performance_name: perfName,
            studio: finalStudio,
            age: ageCol
          };
          parsedAwards.push(award);
        }
      }
    });

    if (dryRun) {
      console.log(JSON.stringify(parsedAwards, null, 2));
      console.log(`\nFound ${parsedAwards.length} total awards.`);
    } else {
      const db = await openDb();
      let insertedCount = 0;
      let skippedCount = 0;

      // 0. Ensure YAGP Org exists
      let orgRow = await db.get('SELECT id FROM organizations WHERE slug = ?', ['yagp']);
      let orgId = null;
      if (orgRow) {
        orgId = orgRow.id;
      } else {
        const resOrg = await db.run('INSERT INTO organizations (name, slug) VALUES (?, ?)', ['Youth America Grand Prix', 'yagp']);
        orgId = resOrg.lastID;
      }

      // 1. Ensure Event exists
      let eventRow = await db.get('SELECT id FROM events WHERE name = ? AND year = ?', [eventName, parseInt(year) || 2024]);
      let eventId;
      if (!eventRow) {
        // Insert with org_id
        const res = await db.run('INSERT INTO events (name, org_id, year, date_string, url) VALUES (?, ?, ?, ?, ?)', [eventName, orgId, parseInt(year) || 2024, `${year}-01-01`, url]);
        eventId = res.lastID;
      } else {
        eventId = eventRow.id;
        // Backfill org_id if it's missing
        if (!eventRow.org_id) {
           await db.run('UPDATE events SET org_id = ? WHERE id = ?', [orgId, eventId]);
        }
      }

      for (const award of parsedAwards) {
        // Skip continuations or empty places
        if (!award.place) continue;

        // Ensure studio exists
        let studio_id = null;
        if (award.studio) {
          let studioRow = await db.get('SELECT id FROM studios WHERE name = ?', [award.studio]);
          if (!studioRow) {
            const studioUuid = generateStudioId(award.studio);
            const joinCode = Array.from(crypto.randomFillSync(new Uint8Array(3))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
            const res = await db.run('INSERT INTO studios (unique_id, name, join_code) VALUES (?, ?, ?)', [studioUuid, award.studio, joinCode]);
            studio_id = res.lastID;
          } else {
            studio_id = studioRow.id;
          }
        }

        // Determine award_type based on category
        let awardType = '';
        const catUpper = award.category.toUpperCase();
        if (catUpper.includes('CLASSICAL') || catUpper.includes('BALLET')) awardType = 'Ballet';
        else if (catUpper.includes('CONTEMPORARY') || catUpper.includes('MODERN')) awardType = 'Contemporary';

        // Resolve dancers before idempotency check to prevent false collisions
        let primary_dancer_id = null;
        let dancer_ids = [];
        if (award.dancer_name) {
           const names = Array.isArray(award.dancer_name) ? award.dancer_name : [award.dancer_name];
           for (const dName of names) {
             let dancerRow;
             if (studio_id) {
               dancerRow = await db.get('SELECT d.id FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id WHERE d.name = ? AND ds.studio_id = ?', [dName, studio_id]);
             } else {
               dancerRow = await db.get('SELECT id FROM dancers WHERE name = ? LIMIT 1', [dName]);
             }
             let d_id;
             if (!dancerRow) {
               // Generate standard unique ID
               let unique_id = generateDancerId(dName);
               const res = await db.run('INSERT INTO dancers (name, unique_id) VALUES (?, ?)', [dName, unique_id]);
               d_id = res.lastID;
               if (studio_id) {
                 await db.run('INSERT INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [d_id, studio_id]);
               }
             } else {
               d_id = dancerRow.id;
             }
             dancer_ids.push(d_id);
           }
           
           // For solos, we set primary_dancer_id to the first dancer. For duets/ensembles, leave it null.
           if (!Array.isArray(award.dancer_name)) {
             primary_dancer_id = dancer_ids[0];
           }
        }

        // Check Idempotency: Does this award already exist?
        const existingAward = await db.get(`
          SELECT id FROM awards 
          WHERE event_id = ? 
            AND place = ? 
            AND (performance_name = ? OR (performance_name IS NULL AND ? = ''))
            AND (category = ? OR (category IS NULL AND ? = ''))
            AND (studio_id = ? OR (studio_id IS NULL AND ? IS NULL))
            AND (dancer_id = ? OR (dancer_id IS NULL AND ? IS NULL))
        `, [
          eventId, 
          award.place, 
          award.performance_name, award.performance_name,
          award.category, award.category,
          studio_id, studio_id,
          primary_dancer_id, primary_dancer_id
        ]);

        if (existingAward) {
          // Retroactively backfill the age_division if it was missing from the older import
          await db.run('UPDATE awards SET age_division = ? WHERE id = ?', [award.age_division, existingAward.id]);
          skippedCount++;
          continue; // Safely skip duplicate
        }

        // Insert new award
        const resAward = await db.run(`
          INSERT INTO awards (event_id, place, performance_name, award_type, category, age_division, dancer_id, studio_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          eventId,
          award.place,
          award.performance_name,
          awardType,
          award.category,
          award.age_division,
          primary_dancer_id,
          studio_id
        ]);
        
        for (const d_id of dancer_ids) {
           await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, status) VALUES (?, ?, ?)', [resAward.lastID, d_id, 'approved']);
        }
        
        insertedCount++;
      }
      console.log(`Successfully inserted ${insertedCount} new awards. Skipped ${skippedCount} existing awards.`);
    }

  } catch (err) {
    console.error("Error scraping:", err.message);
  }
}

// CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const testUrl = args.find(a => a.startsWith('http')) || 'https://yagp.org/yagp-2024-austin-tx-winners/';
  
  scrapeYagp(testUrl, isTest).then(() => {
    process.exit(0);
  });
} else {
  module.exports = { scrapeYagp };
}
