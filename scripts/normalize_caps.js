const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');

function toTitleCase(str) {
    if (!str) return str;
    return str.replace(
        /\w\S*/g,
        function(txt) {
            // Handle edge cases like "O'Connor" or "McKinley" later if needed,
            // but simple Title Case is a huge improvement over ALL CAPS.
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

function isAllCaps(str) {
    return str === str.toUpperCase() && str !== str.toLowerCase();
}

async function run() {
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    console.log("Normalizing Dancer Names...");
    const allDancers = await db.all(`SELECT id, name FROM dancers`);
    let dancersMerged = 0;
    let dancersRenamed = 0;

    for (const dancer of allDancers) {
        if (dancer.name && isAllCaps(dancer.name)) {
            const titleCaseName = toTitleCase(dancer.name);
            
            // Check if title case version already exists
            const existing = await db.get(`SELECT id FROM dancers WHERE name = ? AND id != ?`, [titleCaseName, dancer.id]);
            
            if (existing) {
                // Merge needed
                // Update award_dancers
                await db.run(`UPDATE award_dancers SET dancer_id = ? WHERE dancer_id = ?`, [existing.id, dancer.id]);
                // Update awards (soloists)
                await db.run(`UPDATE awards SET dancer_id = ? WHERE dancer_id = ?`, [existing.id, dancer.id]);
                
                // For dancer_studios, insert ignore basically
                const links = await db.all(`SELECT * FROM dancer_studios WHERE dancer_id = ?`, [dancer.id]);
                for (const link of links) {
                    const existsLink = await db.get(`SELECT * FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [existing.id, link.studio_id]);
                    if (!existsLink) {
                        await db.run(`UPDATE dancer_studios SET dancer_id = ? WHERE id = ?`, [existing.id, link.id]);
                    } else {
                        await db.run(`DELETE FROM dancer_studios WHERE id = ?`, [link.id]);
                    }
                }
                
                // Delete the old all-caps dancer
                await db.run(`DELETE FROM dancers WHERE id = ?`, [dancer.id]);
                dancersMerged++;
            } else {
                // Just rename
                await db.run(`UPDATE dancers SET name = ? WHERE id = ?`, [titleCaseName, dancer.id]);
                dancersRenamed++;
            }
        }
    }

    console.log(`Dancers Merged: ${dancersMerged}`);
    console.log(`Dancers Renamed: ${dancersRenamed}`);

    console.log("Normalizing Routine Names...");
    const allAwards = await db.all(`SELECT id, performance_name FROM awards WHERE performance_name IS NOT NULL`);
    let routinesRenamed = 0;

    for (const award of allAwards) {
        if (award.performance_name && isAllCaps(award.performance_name)) {
            const titleCaseRoutine = toTitleCase(award.performance_name);
            await db.run(`UPDATE awards SET performance_name = ? WHERE id = ?`, [titleCaseRoutine, award.id]);
            routinesRenamed++;
        }
    }
    
    console.log(`Routines Renamed: ${routinesRenamed}`);
}

run().catch(console.error);
