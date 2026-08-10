const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

const db = new sqlite3.Database(require('path').join(__dirname, '..', 'database.sqlite'));
db.runAsync = promisify(db.run.bind(db));
db.allAsync = promisify(db.all.bind(db));

async function purge() {
  console.log("Starting Showstopper Purge...");
  try {
    const org = await promisify(db.get.bind(db))("SELECT id FROM organizations WHERE name = 'Showstopper'");
    if (!org) {
      console.log("Showstopper org not found.");
      return;
    }
    const orgId = org.id;
    console.log(`Showstopper Org ID: ${orgId}`);

    // Delete award_dancers mapped to Showstopper awards
    const res1 = await db.runAsync(`
      DELETE FROM award_dancers 
      WHERE award_id IN (
        SELECT id FROM awards WHERE event_id IN (
          SELECT id FROM events WHERE org_id = ?
        )
      )
    `, [orgId]);
    console.log(`Deleted ${res1?.changes || 'many'} award_dancers.`);

    // Delete Showstopper awards
    const res2 = await db.runAsync(`
      DELETE FROM awards 
      WHERE event_id IN (
        SELECT id FROM events WHERE org_id = ?
      )
    `, [orgId]);
    console.log(`Deleted ${res2?.changes || 'many'} awards.`);

    // Delete Showstopper events
    const res3 = await db.runAsync(`DELETE FROM events WHERE org_id = ?`, [orgId]);
    console.log(`Deleted ${res3?.changes || 'many'} events.`);

    // Delete Showstopper org
    const res4 = await db.runAsync(`DELETE FROM organizations WHERE id = ?`, [orgId]);
    console.log(`Deleted org.`);

    // Clean up orphans
    await db.runAsync(`DELETE FROM dancers WHERE id NOT IN (SELECT dancer_id FROM award_dancers)`);
    await db.runAsync(`DELETE FROM dancer_studios WHERE dancer_id NOT IN (SELECT id FROM dancers)`);
    // Not deleting studios just in case, but could do:
    // await db.runAsync(`DELETE FROM studios WHERE id NOT IN (SELECT studio_id FROM dancer_studios)`);
    
    console.log("Purge complete.");
  } catch(e) {
    console.error(e);
  }
}

purge();
