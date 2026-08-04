const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPromise = sqlite.open({
  filename: path.join(__dirname, 'database.sqlite'),
  driver: sqlite3.Database
});

async function recover() {
  const db = await dbPromise;

  // 1. Find all awards with an orphaned studio_id
  const orphanedAwards = await db.all(`
    SELECT id, event_id, performance_name, studio_id 
    FROM awards 
    WHERE studio_id IS NOT NULL 
      AND studio_id NOT IN (SELECT id FROM studios)
  `);

  console.log(`Found ${orphanedAwards.length} orphaned awards.`);

  let recoveredCount = 0;
  let unrecoverableCount = 0;

  for (const award of orphanedAwards) {
    // Find dancers in this award
    const dancers = await db.all('SELECT dancer_id FROM award_dancers WHERE award_id = ?', [award.id]);
    
    if (dancers.length === 0) {
      unrecoverableCount++;
      continue;
    }

    // Get all studio_ids for these dancers
    const studioCounts = {};
    for (const d of dancers) {
      const studios = await db.all('SELECT studio_id FROM dancer_studios WHERE dancer_id = ?', [d.dancer_id]);
      for (const s of studios) {
        studioCounts[s.studio_id] = (studioCounts[s.studio_id] || 0) + 1;
      }
    }

    // The recovered studio is likely the one that the most dancers in this award belong to
    let bestStudio = null;
    let maxCount = 0;
    for (const [sId, count] of Object.entries(studioCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestStudio = sId;
      }
    }

    if (bestStudio) {
      await db.run('UPDATE awards SET studio_id = ? WHERE id = ?', [bestStudio, award.id]);
      recoveredCount++;
    } else {
      unrecoverableCount++;
    }
  }

  console.log(`Recovered ${recoveredCount} awards. Unrecoverable: ${unrecoverableCount}.`);
}

recover().catch(console.error);
