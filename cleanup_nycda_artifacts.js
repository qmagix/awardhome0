const { openDb } = require('./database');

async function cleanup() {
  const db = await openDb();
  
  console.log("Starting safe cleanup of corrupted NYCDA awards and single-letter artifacts...");
  
  try {
    await db.run('BEGIN TRANSACTION');

    // 1. Find the corrupted award IDs (any award associated with a dancer whose name is <= 2 chars)
    const corruptedAwards = await db.all(`
      SELECT DISTINCT a.id 
      FROM awards a
      JOIN award_dancers ad ON a.id = ad.award_id
      JOIN dancers d ON ad.dancer_id = d.id
      WHERE length(d.name) <= 2
    `);
    
    if (corruptedAwards.length > 0) {
      const awardIds = corruptedAwards.map(a => a.id);
      const placeholders = awardIds.map(() => '?').join(',');
      
      console.log(`Found ${awardIds.length} corrupted awards linked to artifacts. Proceeding with deletion.`);

      // 2. Delete mappings from award_dancers
      const deletedMappings = await db.run(`
        DELETE FROM award_dancers 
        WHERE award_id IN (${placeholders})
      `, awardIds);
      console.log(`Deleted ${deletedMappings.changes} rows from award_dancers junction table.`);

      // 3. Delete the awards themselves
      const deletedAwards = await db.run(`
        DELETE FROM awards 
        WHERE id IN (${placeholders})
      `, awardIds);
      console.log(`Deleted ${deletedAwards.changes} corrupted rows from awards table.`);
    }

    // 4. Clean up the single-letter/short-name dancers
    const deletedDancers = await db.run(`
      DELETE FROM dancers 
      WHERE length(name) <= 2
    `);
    console.log(`Deleted ${deletedDancers.changes} artifact dancers (e.g. 'R', 'A2', 'T3').`);

    await db.run('COMMIT');
    console.log("Cleanup completed successfully! Transaction committed.");

  } catch (error) {
    await db.run('ROLLBACK');
    console.error("Error during cleanup! Transaction rolled back safely.", error);
  }
}

cleanup();
