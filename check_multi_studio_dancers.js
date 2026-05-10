const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

const db = new sqlite3.Database('./database.sqlite');
db.all = promisify(db.all.bind(db));
db.get = promisify(db.get.bind(db));

async function runSanityCheck() {
  console.log('Running sanity check for dancers with multiple studios...\n');

  try {
    const multiStudioDancers = await db.all(`
      SELECT 
        d.id as dancer_id,
        d.unique_id,
        d.name,
        COUNT(DISTINCT ds.studio_id) as studio_count
      FROM dancers d
      JOIN dancer_studios ds ON d.id = ds.dancer_id
      GROUP BY d.id
      HAVING studio_count > 1
      ORDER BY studio_count DESC
    `);

    if (multiStudioDancers.length === 0) {
      console.log('✅ SANITY CHECK PASSED: No dancers belong to multiple studios.');
      db.close();
      return;
    }

    console.log(`❌ SANITY CHECK FAILED: Found ${multiStudioDancers.length} dancer(s) belonging to multiple studios.\n`);

    // Fetch and display details for up to 20 offenders
    const limit = Math.min(multiStudioDancers.length, 20);
    console.log(`Showing details for the top ${limit} offenders:`);
    console.log('----------------------------------------------------');

    for (let i = 0; i < limit; i++) {
      const dancer = multiStudioDancers[i];
      
      const studios = await db.all(`
        SELECT s.name, s.id
        FROM studios s
        JOIN dancer_studios ds ON s.id = ds.studio_id
        WHERE ds.dancer_id = ?
      `, [dancer.dancer_id]);

      const studioNames = studios.map(s => `"${s.name}" (ID: ${s.id})`).join(', ');

      console.log(`${i + 1}. Dancer: ${dancer.name} [${dancer.unique_id}]`);
      console.log(`   Studios (${dancer.studio_count}): ${studioNames}\n`);
    }

    if (multiStudioDancers.length > 20) {
      console.log(`... and ${multiStudioDancers.length - 20} more dancers.`);
    }

  } catch (err) {
    console.error('Error running sanity check:', err);
  }

  db.close();
}

runSanityCheck();
