const { openDb } = require('./database');
const crypto = require('crypto');
const slugify = require('slugify');

async function fixDuplicates() {
  const db = await openDb();
  
  // Find dancers with multiple studios
  const duplicates = await db.all(`
    SELECT dancer_id, COUNT(*) as c 
    FROM dancer_studios 
    GROUP BY dancer_id 
    HAVING c > 1
  `);
  
  console.log(`Found ${duplicates.length} dancers associated with multiple studios. Cleaning up...`);

  let splitCount = 0;

  for (const dup of duplicates) {
    const oldDancerId = dup.dancer_id;
    const dancer = await db.get(`SELECT * FROM dancers WHERE id = ?`, [oldDancerId]);
    if (!dancer) continue;
    
    // Get all their studio links
    const links = await db.all(`SELECT id, studio_id FROM dancer_studios WHERE dancer_id = ?`, [oldDancerId]);
    
    // The first link stays with the original dancer. 
    // We create clones for the rest.
    for (let i = 1; i < links.length; i++) {
      const link = links[i];
      
      const slug = slugify(dancer.name, { lower: true, strict: true });
      const newUniqueId = `${crypto.randomUUID()}-${slug}`;
      
      // Create new dancer
      const res = await db.run(`
        INSERT INTO dancers (unique_id, name, birthday, change_log, needs_investigation)
        VALUES (?, ?, ?, ?, ?)
      `, [newUniqueId, dancer.name, dancer.birthday, dancer.change_log, dancer.needs_investigation]);
      
      const newDancerId = res.lastID;
      
      // Re-point the dancer_studios pivot to the new dancer
      await db.run(`
        UPDATE dancer_studios 
        SET dancer_id = ? 
        WHERE id = ?
      `, [newDancerId, link.id]);
      
      // Re-point the awards for this specific studio to the new dancer using the junction table
      await db.run(`
        UPDATE award_dancers 
        SET dancer_id = ? 
        WHERE dancer_id = ? AND award_id IN (SELECT id FROM awards WHERE studio_id = ?)
      `, [newDancerId, oldDancerId, link.studio_id]);

      splitCount++;
    }
  }
  
  console.log(`Cleanup complete! Successfully split ${splitCount} corrupted dancer records.`);
}

if (require.main === module) {
  fixDuplicates().then(() => {
    process.exit(0);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
