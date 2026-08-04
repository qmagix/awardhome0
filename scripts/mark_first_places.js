const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

async function openDb() {
  return open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });
}

async function markFirstPlaces() {
  const db = await openDb();

  try {
    // 1. Add column if it doesn't exist
    try {
      await db.run(`ALTER TABLE awards ADD COLUMN is_first_place BOOLEAN DEFAULT 0;`);
      console.log('Added is_first_place column.');
    } catch (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('is_first_place column already exists.');
      } else {
        throw err;
      }
    }

    // 2. Reset all to 0
    await db.run(`UPDATE awards SET is_first_place = 0;`);
    console.log('Reset all awards to is_first_place = 0.');

    // 3. Mark real first places
    // Exclude '1st Runner Up', '10th', '11th' etc.
    // Also explicitly exclude special awards like invites, scholarships, photogenic, choreography, entertainment
    const result = await db.run(`
      UPDATE awards 
      SET is_first_place = 1 
      WHERE LOWER(place) IN ('1', '1st', 'winner', '1st place', 'first place')
      AND LOWER(category) NOT LIKE '%invite%'
      AND LOWER(category) NOT LIKE '%invitation%'
      AND LOWER(category) NOT LIKE '%scholar%'
      AND LOWER(category) NOT LIKE '%photogenic%'
      AND LOWER(category) NOT LIKE '%headshot%'
      AND LOWER(category) NOT LIKE '%entertainment%'
      AND LOWER(category) NOT LIKE '%choreography%'
      AND LOWER(category) NOT LIKE '%costume%'
      AND LOWER(category) NOT LIKE '%sportsmanship%'
      AND LOWER(category) NOT LIKE '%spirit%'
      AND LOWER(category) NOT LIKE '%class act%'
      AND LOWER(category) NOT LIKE '%wild one%'
      AND LOWER(category) NOT LIKE '%wild $%'
      AND LOWER(category) NOT LIKE '%discovery spotlight%'
      AND LOWER(category) NOT LIKE '%palooza%'
      AND LOWER(category) NOT LIKE '%battle%'
      AND LOWER(category) NOT LIKE '%voucher%'
      AND LOWER(category) NOT LIKE '%kindness%'
      AND LOWER(category) NOT LIKE '%nominations%'
    `);
    
    console.log(`Successfully marked ${result.changes} awards as first places.`);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await db.close();
  }
}

markFirstPlaces();
