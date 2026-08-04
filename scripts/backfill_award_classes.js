const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

async function run() {
  const orgs = await new Promise((resolve, reject) => {
    db.all('SELECT id, award_metadata FROM organizations WHERE award_metadata IS NOT NULL', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');

    // 1. Hardcoded overrides for NYCDA hacks
    db.run(`UPDATE awards SET award_class = 'scholarship', performance_name = NULL WHERE performance_name = '(Convention)'`);
    db.run(`UPDATE awards SET award_class = 'studio', performance_name = NULL WHERE performance_name = '(Studio Award)'`);

    // 2. Iterate through organizations and their metadata mapping
    orgs.forEach(org => {
      let metadata;
      try {
        metadata = JSON.parse(org.award_metadata);
      } catch (e) { return; }
      
      const classes = metadata.classes;
      if (!classes) return;

      Object.keys(classes).forEach(awardClass => {
        const types = classes[awardClass];
        if (!types || types.length === 0) return;

        const placeholders = types.map(() => '?').join(',');
        
        // Update awards for this org that match these types
        db.run(`
          UPDATE awards 
          SET award_class = ? 
          WHERE award_class IS NULL 
            AND award_type IN (${placeholders})
            AND event_id IN (SELECT id FROM events WHERE org_id = ?)
        `, [awardClass, ...types, org.id], function(err) {
          if (err) console.error(err);
        });
      });
    });

    // 3. Any remaining NULLs default to 'adjudication' if place is null, or 'overall' if place exists
    db.run(`UPDATE awards SET award_class = 'adjudication' WHERE award_class IS NULL AND place IS NULL`);
    db.run(`UPDATE awards SET award_class = 'overall' WHERE award_class IS NULL AND place IS NOT NULL`);

    db.run('COMMIT;', (err) => {
      if (err) console.error("Commit error:", err);
      else console.log("Backfill complete.");
    });
  });
}

run().catch(console.error);
