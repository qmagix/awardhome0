const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const PDFParser = require('pdf2json');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'database.sqlite');
const PDF_DIR = path.join(__dirname, 'tobeprocessed', 'pdf', 'spotlight');

function toTitleCase(str) {
    if (!str) return str;
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

function parsePDF(filePath) {
    return new Promise((resolve, reject) => {
        let pdfParser = new PDFParser(this, 1);
        
        pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
        pdfParser.on("pdfParser_dataReady", pdfData => {
            let lines = [];
            const safeDecode = (str) => {
                try { return decodeURIComponent(str); }
                catch (e) { return unescape(str); }
            };
            
            for (const page of pdfData.Pages) {
                const texts = page.Texts;
                texts.sort((a, b) => {
                    if (Math.abs(a.y - b.y) < 0.2) {
                        return a.x - b.x;
                    }
                    return a.y - b.y;
                });
                let currentLine = [];
                let currentY = -1000;
                for (const t of texts) {
                    if (Math.abs(t.y - currentY) > 0.3) {
                        if (currentLine.length > 0) {
                            lines.push(currentLine.map(tt => safeDecode(tt.R[0].T)).join('   '));
                        }
                        currentLine = [t];
                        currentY = t.y;
                    } else {
                        currentLine.push(t);
                    }
                }
                if (currentLine.length > 0) {
                    lines.push(currentLine.map(tt => safeDecode(tt.R[0].T)).join('   '));
                }
            }
            
            let currentCategory = "";
            let categoryPendingAwards = [];
            const results = [];

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;
                
                // Ignore table headers
                if (line.startsWith("Placement") && line.includes("Entry ID")) {
                    continue;
                }

                // Check if it's a category line
                if (line.includes(" ~ ")) {
                    currentCategory = line;
                    // If we had pending awards (they appeared before the header in the raw text stream), assign this category
                    if (categoryPendingAwards.length > 0) {
                        for (let a of categoryPendingAwards) {
                            a.category = currentCategory;
                            results.push(a);
                        }
                        categoryPendingAwards = [];
                    }
                    continue;
                }

                // Check if it's an award row
                const placementMatch = line.match(/^(1st Runner Up|2nd Runner Up|3rd Runner Up|4th Runner Up|5th Runner Up|WINNER|1st|2nd|3rd|\d+th|DIAMOND|RUBY|EMERALD|SAPPHIRE|CRYSTAL)\s+(.+)$/i);
                if (placementMatch) {
                    const place = placementMatch[1];
                    let rest = placementMatch[2];
                    
                    rest = rest.replace(/\u00A0/g, '   '); // replace non-breaking spaces
                    const tokens = rest.split(/\s{2,}/).map(t => t.trim()).filter(t => t.length > 0);
                    
                    let entryId = null;
                    let studio = null;
                    let routine = null;
                    let dancer = null;

                    if (currentCategory && currentCategory.toLowerCase().includes("title winner") && tokens.length >= 2) {
                        // Title winners usually don't have entry ID or routine
                        studio = toTitleCase(tokens[0]);
                        dancer = toTitleCase(tokens.slice(1).join(' '));
                        routine = "Title Routine";
                    } else if (tokens.length >= 3) {
                        entryId = tokens[0];
                        studio = toTitleCase(tokens[1]);
                        routine = toTitleCase(tokens[2]);
                        dancer = tokens.length > 3 ? toTitleCase(tokens.slice(3).join(' ')) : null;
                    }

                    if (studio) {
                        const award = {
                            category: currentCategory,
                            place: place,
                            entryId: entryId,
                            studio: studio,
                            routine: routine,
                            dancer: dancer
                        };

                        if (!currentCategory) {
                            categoryPendingAwards.push(award);
                        } else {
                            results.push(award);
                        }
                    }
                }
            }

            // Flush any remaining pending awards (if category was never found, we just keep them without category)
            for (let a of categoryPendingAwards) {
                results.push(a);
            }

            resolve(results);
        });

        pdfParser.loadPDF(filePath);
    });
}

function extractEventInfoFromFilename(filename) {
    // Examples: spotlightevents_AUS-Results-2026.pdf, spotlightevents_Results-ABQ-2025.pdf
    let year = 2024; // default
    const yearMatch = filename.match(/(?:202\d|2\d)(?:\.pdf|-)/);
    if (yearMatch) {
        let yrStr = yearMatch[0].replace(/\.pdf|-/g, '');
        if (yrStr.length === 2) yrStr = '20' + yrStr;
        year = parseInt(yrStr, 10);
    }

    let location = "Unknown";
    // Try to get location code (usually 3 chars or city name)
    const locMatch = filename.match(/spotlightevents_(?:Results-)?(?:Report-)?([A-Za-z0-9]+)/i);
    if (locMatch && locMatch[1].toLowerCase() !== 'results') {
        location = locMatch[1];
    }

    // fallback for names like spotlightevents_Results-Detroit-2022.pdf -> "Detroit" is handled by above.
    // spotlightevents_AUS-Results -> "AUS"

    return { name: `Spotlight - ${location} ${year}`, year: year };
}

async function run() {
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    // Ensure Spotlight org exists
    let org = await db.get(`SELECT id FROM organizations WHERE name = 'Spotlight Dance Cup'`);
    if (!org) {
        const res = await db.run(`INSERT INTO organizations (name, slug, website) VALUES (?, ?, ?)`, ['Spotlight Dance Cup', 'spotlight', 'https://spotlightevents.com']);
        org = { id: res.lastID };
    }

    const files = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
    console.log(`Found ${files.length} PDFs to process.`);

    // Set subset limit here (e.g. 3 for verification, or files.length for all)
    const limit = process.env.LIMIT ? parseInt(process.env.LIMIT) : files.length;
    
    for (let i = 0; i < limit; i++) {
        const file = files[i];
        console.log(`\n[${i+1}/${limit}] Processing ${file}...`);
        
        try {
            const awardsData = await parsePDF(path.join(PDF_DIR, file));
            console.log(`  Extracted ${awardsData.length} awards.`);
            
            if (awardsData.length === 0) continue;

            const eventInfo = extractEventInfoFromFilename(file);
            
            // Create/Find Event
            let event = await db.get(`SELECT id FROM events WHERE name = ? AND year = ?`, [eventInfo.name, eventInfo.year]);
            if (!event) {
                const res = await db.run(`INSERT INTO events (org_id, name, year, date_string) VALUES (?, ?, ?, ?)`, [org.id, eventInfo.name, eventInfo.year, `${eventInfo.year}-01-01`]);
                event = { id: res.lastID };
            }

            // Begin Transaction for inserts
            await db.run('BEGIN TRANSACTION');

            let insertedCount = 0;
            let skippedCount = 0;

            for (const item of awardsData) {
                // Determine award_type based on category
                let awardType = 'Overall';
                const catLower = (item.category || '').toLowerCase();
                if (catLower.includes('solo') || catLower.includes('duo') || catLower.includes('trio') || catLower.includes('title')) {
                    awardType = 'Solo/Duo/Trio';
                }

                // Studio mapping
                let studioId = null;
                if (item.studio) {
                    let studio = await db.get(`SELECT id FROM studios WHERE name = ?`, [item.studio]);
                    if (!studio) {
                        const res = await db.run(`INSERT INTO studios (unique_id, name, is_claimed) VALUES (?, ?, ?)`, [uuidv4(), item.studio, 0]);
                        studioId = res.lastID;
                    } else {
                        studioId = studio.id;
                    }
                }

                // Dancer mapping
                let dancerId = null;
                if (item.dancer && awardType === 'Solo/Duo/Trio') {
                    let dancer = null;
                    if (studioId) {
                        dancer = await db.get(`SELECT d.id FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id WHERE d.name = ? AND ds.studio_id = ?`, [item.dancer, studioId]);
                    } else {
                        dancer = await db.get(`SELECT id FROM dancers WHERE name = ? LIMIT 1`, [item.dancer]);
                    }

                    if (!dancer) {
                        const res = await db.run(`INSERT INTO dancers (unique_id, name) VALUES (?, ?)`, [uuidv4(), item.dancer]);
                        dancerId = res.lastID;
                    } else {
                        dancerId = dancer.id;
                    }

                    // Link dancer to studio
                    if (studioId && dancerId) {
                        const link = await db.get(`SELECT * FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [dancerId, studioId]);
                        if (!link) {
                            await db.run(`INSERT INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, 'active')`, [dancerId, studioId]);
                        }
                    }
                }

                // Insert Award
                // Note: Spotlight sometimes lacks category if parsing missed it, we handle it gracefully.
                const existingAward = await db.get(`
                    SELECT id FROM awards 
                    WHERE event_id = ? AND performance_name = ? AND place = ? AND category = ?
                `, [event.id, item.routine, item.place, item.category || '']);

                if (!existingAward) {
                    const res = await db.run(`
                        INSERT INTO awards (event_id, place, performance_name, performance_number, award_type, category, dancer_id, studio_id) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        event.id, 
                        item.place, 
                        item.routine, 
                        item.entryId, 
                        awardType, 
                        item.category || '', 
                        dancerId, 
                        studioId
                    ]);

                    // Map multi-dancers (e.g. Duos/Trios) to award_dancers table
                    if (dancerId) {
                        const dancerNames = item.dancer.split(/&|,/).map(d => d.trim()).filter(d => d);
                        for (const dName of dancerNames) {
                            let dInfo = null;
                            if (studioId) {
                                dInfo = await db.get(`SELECT d.id FROM dancers d JOIN dancer_studios ds ON d.id = ds.dancer_id WHERE d.name = ? AND ds.studio_id = ?`, [dName, studioId]);
                            } else {
                                dInfo = await db.get(`SELECT id FROM dancers WHERE name = ? LIMIT 1`, [dName]);
                            }
                            
                            if (!dInfo) {
                                const dRes = await db.run(`INSERT INTO dancers (unique_id, name) VALUES (?, ?)`, [uuidv4(), dName]);
                                dInfo = { id: dRes.lastID };
                                if (studioId) {
                                    await db.run(`INSERT INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, 'active')`, [dInfo.id, studioId]);
                                }
                            }
                            await db.run(`INSERT INTO award_dancers (award_id, dancer_id) VALUES (?, ?)`, [res.lastID, dInfo.id]);
                        }
                    }

                    insertedCount++;
                } else {
                    skippedCount++;
                }
            }

            await db.run('COMMIT');
            console.log(`  -> Inserted ${insertedCount} new awards. Skipped ${skippedCount} duplicates.`);

        } catch (err) {
            console.error(`  -> Failed to parse ${file}:`, err);
            // If it failed, we must commit any open transaction just in case (though we wrap per-file)
            try { await db.run('ROLLBACK'); } catch(e) {}
        }
    }

    console.log('\nFinished processing PDFs.');
}

run().catch(console.error);
