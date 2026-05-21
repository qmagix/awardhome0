const fs = require('fs');
const path = require('path');
const { openDb } = require('./database');

async function getOrCreateOrg(orgName = 'Starquest') {
  const db = await openDb();
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let org = await db.get('SELECT id FROM organizations WHERE slug = ?', [slug]);
  if (!org) {
    const res = await db.run('INSERT INTO organizations (name, slug) VALUES (?, ?)', [orgName, slug]);
    return res.lastID;
  }
  return org.id;
}

async function getOrCreateEvent(orgId, eventName, year) {
  const db = await openDb();
  let event = await db.get('SELECT id FROM events WHERE org_id = ? AND name = ? AND year = ?', [orgId, eventName, year]);
  if (!event) {
    const res = await db.run('INSERT INTO events (org_id, name, year) VALUES (?, ?, ?)', [orgId, eventName, year]);
    return res.lastID;
  }
  return event.id;
}

async function getOrCreateStudio(studioName) {
  const db = await openDb();
  let studio = await db.get('SELECT id FROM studios WHERE name = ?', [studioName]);
  if (!studio) {
    const uniqueId = 'STD-' + require('crypto').randomUUID();
    const res = await db.run('INSERT INTO studios (unique_id, name) VALUES (?, ?)', [uniqueId, studioName]);
    return res.lastID;
  }
  return studio.id;
}

async function runImport() {
  const txtDir = path.join(__dirname, 'tobeprocessed', 'pdf', 'starquest', 'txt');
  const jsonDir = path.join(__dirname, 'tobeprocessed', 'pdf', 'starquest'); // Metadata JSONs are in the root starquest folder
  const files = fs.readdirSync(txtDir).filter(f => f.endsWith('.txt'));

  const db = await openDb();
  const orgId = await getOrCreateOrg('Starquest');
  let totalImported = 0;

  console.log(`Starting Starquest import. Found ${files.length} TXT files.`);

  for (const file of files) {
    // The TXT filename is like GOOD-location-2026.pdf.txt
    // We need to map this back to the metadata JSON.
    // e.g. location-2026.pdf -> location-2026.json
    const originalPdfName = file.replace('GOOD-', '').replace('.txt', '');
    const jsonFileName = originalPdfName.replace('.pdf', '.json');
    const jsonPath = path.join(jsonDir, jsonFileName);

    let eventYear = 2026;
    let eventName = 'Starquest - Unknown';
    
    if (fs.existsSync(jsonPath)) {
      const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      eventYear = metadata.year;
      eventName = metadata.event_name;
    } else {
      console.warn(`[WARNING] No metadata JSON found for ${originalPdfName}, fallback to parsing filename.`);
      const yearMatch = originalPdfName.match(/202[0-9]/);
      if (yearMatch) eventYear = parseInt(yearMatch[0]);
      eventName = `Starquest - ${originalPdfName.split('.')[0]}`;
    }

    const eventId = await getOrCreateEvent(orgId, eventName, eventYear);
    const textData = fs.readFileSync(path.join(txtDir, file), 'utf8').split('\n');
    let fileImportCount = 0;

    for (const line of textData) {
      if (!line.startsWith('Cat:')) continue;
      // Format: Cat: X | Class: Y | Award: Z | Place: P | Routine: R | Dancer: D | Studio: S | Notes: [Choreographer: C]
      
      const parts = line.split('|').map(s => s.trim());
      let category, aClass, awardType, place, routine, dancer, studioName, notes;
      
      for (const p of parts) {
        if (p.startsWith('Cat:')) category = p.substring(4).trim();
        else if (p.startsWith('Class:')) aClass = p.substring(6).trim();
        else if (p.startsWith('Award:')) awardType = p.substring(6).trim();
        else if (p.startsWith('Place:')) place = p.substring(6).trim();
        else if (p.startsWith('Routine:')) routine = p.substring(8).trim();
        else if (p.startsWith('Dancer:')) dancer = p.substring(7).trim();
        else if (p.startsWith('Studio:')) studioName = p.substring(7).trim();
        else if (p.startsWith('Notes:')) notes = p.substring(6).trim();
      }

      if (routine === 'N/A') routine = null;
      if (dancer === 'N/A') dancer = null;
      if (place === 'N/A') place = null;
      
      if (!studioName) continue; // Requires a studio

      const studioId = await getOrCreateStudio(studioName);

      // Check if award already exists (idempotency)
      let query = `SELECT id, award_class FROM awards WHERE event_id = ? AND studio_id = ? AND category = ? AND award_type = ? AND place = ?`;
      const params = [eventId, studioId, category, awardType, place];

      if (routine) { query += ` AND performance_name = ?`; params.push(routine); } else { query += ` AND performance_name IS NULL`; }
      if (dancer) { query += ` AND notes LIKE ?`; params.push('%' + dancer + '%'); } // Dancer is often stored in notes if dancer_id is null

      const existing = await db.get(query, params);
      
      if (!existing) {
        let finalNotes = notes || '';
        if (dancer && !finalNotes.includes(dancer)) {
           finalNotes += ` (Dancer: ${dancer})`;
        }

        await db.run(`
          INSERT INTO awards (event_id, studio_id, place, performance_name, award_type, category, notes, verification_status, award_class)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?)
        `, [eventId, studioId, place, routine, awardType, category, finalNotes.trim(), aClass]);
        
        fileImportCount++;
        totalImported++;
      } else {
        // Update award_class if it's null or has changed
        if (existing.award_class !== aClass) {
          await db.run('UPDATE awards SET award_class = ? WHERE id = ?', [aClass, existing.id]);
        }
      }
    }
    
    console.log(`Imported ${fileImportCount} new awards from ${file}`);
  }

  console.log(`\nImport complete! Total new awards imported: ${totalImported}`);
}

runImport().catch(console.error);
