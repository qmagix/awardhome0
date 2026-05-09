const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPromise = sqlite.open({
  filename: path.join(__dirname, 'database.sqlite'),
  driver: sqlite3.Database
});

async function dedupStudios() {
  const db = await dbPromise;

  console.log("Fetching all studios...");
  const studios = await db.all('SELECT id, name, aka FROM studios');
  
  // Create a map for quick lookup by lowercased name
  const nameToId = new Map();
  for (const s of studios) {
    nameToId.set(s.name.trim().toLowerCase(), s.id);
  }

  let mergeCount = 0;

  await db.run('BEGIN TRANSACTION');

  try {
    for (const studio of studios) {
      if (studio.name.includes(',')) {
        const parts = studio.name.split(',');
        const baseName = parts[0].trim();
        const baseNameLower = baseName.toLowerCase();

        // Check if the base name exists
        if (nameToId.has(baseNameLower)) {
          const baseId = nameToId.get(baseNameLower);
          
          // Ensure we don't merge a studio into itself
          if (baseId !== studio.id) {
            console.log(`\nMerging [${studio.name}] (ID: ${studio.id}) INTO [${baseName}] (ID: ${baseId})`);
            
            // 0. Reassign awards mappings
            await db.run('UPDATE awards SET studio_id = ? WHERE studio_id = ?', [baseId, studio.id]);
            
            // 1. Reassign dancer_studios mappings
            // Note: we might have UNIQUE constraint failures if a dancer is somehow mapped to both.
            // We use 'INSERT OR IGNORE' logic manually or rely on 'ON CONFLICT IGNORE'
            
            const dancerStudios = await db.all('SELECT id, dancer_id FROM dancer_studios WHERE studio_id = ?', [studio.id]);
            for (const ds of dancerStudios) {
               // Check if the dancer is already mapped to the base studio
               const existing = await db.get('SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [ds.dancer_id, baseId]);
               if (existing) {
                 // Already mapped, just delete the duplicate mapping
                 await db.run('DELETE FROM dancer_studios WHERE id = ?', [ds.id]);
               } else {
                 // Update to the base studio
                 await db.run('UPDATE dancer_studios SET studio_id = ? WHERE id = ?', [baseId, ds.id]);
               }
            }

            // 2. Append to AKA field
            const baseStudio = await db.get('SELECT aka FROM studios WHERE id = ?', [baseId]);
            let newAka = baseStudio.aka || '';
            if (!newAka.includes(studio.name)) {
               newAka = newAka ? newAka + ' | ' + studio.name : studio.name;
               await db.run('UPDATE studios SET aka = ? WHERE id = ?', [newAka, baseId]);
            }

            // 3. Delete the duplicate studio
            await db.run('DELETE FROM studios WHERE id = ?', [studio.id]);
            
            mergeCount++;
          }
        }
      }
    }
    await db.run('COMMIT');
    console.log(`\nSuccessfully merged ${mergeCount} duplicate studios.`);
  } catch (err) {
    await db.run('ROLLBACK');
    console.error("Error during deduplication, rolled back transaction:", err);
  }
}

dedupStudios().catch(console.error);
