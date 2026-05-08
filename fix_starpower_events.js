const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

const db = new sqlite3.Database('./database.sqlite');
db.allAsync = promisify(db.all.bind(db));
db.runAsync = promisify(db.run.bind(db));

async function run() {
  const events = await db.allAsync("SELECT * FROM events WHERE org_id = 4");
  console.log(`Found ${events.length} Starpower events to fix...`);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    try {
      console.log(`[${i+1}/${events.length}] Fetching ${event.url}...`);
      const { data } = await axios.get(event.url);
      const $ = cheerio.load(data);
      
      // Look for the 24px header div first, fallback to the very first table
      let loc = $('div[style*="24px"]').first().text().trim().replace(/\s+/g, ' ');
      if (!loc) {
        loc = $('table').first().text().trim().replace(/\s+/g, ' ');
      }
      
      if (loc && loc.length < 150) {
        const yearMatch = loc.match(/\b(20[1-3][0-9])\b/);
        const year = yearMatch ? parseInt(yearMatch[1]) : event.year;
        const name = `Starpower - ${loc.split('20')[0].trim()}`;
        
        await db.runAsync(
          "UPDATE events SET name = ?, date_string = ?, year = ? WHERE id = ?",
          [name, loc, year, event.id]
        );
        console.log(`✅ Fixed to: ${name}`);
      } else {
        console.log(`⚠️ Could not parse clean location for: ${event.id}`);
      }
    } catch (e) {
      console.log(`❌ Error fetching ${event.url}: ${e.message}`);
    }
  }
  console.log("Done fixing events!");
}

run();
