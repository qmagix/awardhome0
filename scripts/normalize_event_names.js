const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');

// Map organization names to their standard short prefix.
const orgPrefixes = {
  'KAR Dance Competition': 'KAR',
  'Rainbow National Dance Competition': 'Rainbow',
  'Youth America Grand Prix': 'YAGP',
  'Revolution Talent Competition': 'Revolution',
  'Starpower Talent Competition': 'Starpower',
  'Imagine Dance Challenge': 'Imagine',
  'Believe Talent Competition': 'Believe',
  'DreamMaker Dance Competition': 'DreamMaker',
  'Spotlight Dance Cup': 'Spotlight',
  'Starbound National Talent Competition': 'Starbound'
};

// Fallback logic if the exact name isn't in the map above
function derivePrefix(orgName) {
  if (orgPrefixes[orgName]) return orgPrefixes[orgName];
  // Default fallback: take the first word of the organization
  return orgName.split(' ')[0];
}

async function run() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  console.log('Fetching organizations...');
  const orgs = await db.all(`SELECT id, name FROM organizations`);
  
  // Create a mapping of org_id -> prefix
  const orgMap = {};
  for (const org of orgs) {
    orgMap[org.id] = derivePrefix(org.name);
    console.log(`Mapped Org [${org.name}] -> Prefix [${orgMap[org.id]}]`);
  }

  console.log('\nScanning events...');
  const events = await db.all(`SELECT id, name, org_id FROM events`);
  
  let updateCount = 0;
  let skipCount = 0;

  for (const event of events) {
    const prefix = orgMap[event.org_id];
    if (!prefix) {
      console.warn(`WARNING: Event ${event.id} has an unknown org_id ${event.org_id}. Skipping.`);
      skipCount++;
      continue;
    }

    const eventNameLower = (event.name || '').toLowerCase();
    const prefixLower = prefix.toLowerCase();

    // Check if it already starts with the prefix (e.g., "yagp...", "Starpower...")
    if (eventNameLower.startsWith(prefixLower)) {
      // Already normalized or originally scraped with the name
      skipCount++;
    } else {
      // Normalize it!
      const newName = `${prefix} - ${event.name}`;
      await db.run(`UPDATE events SET name = ? WHERE id = ?`, [newName, event.id]);
      updateCount++;
      // Log occasionally to avoid spam
      if (updateCount % 100 === 0 || updateCount <= 10) {
        console.log(`Normalized: "${event.name}" -> "${newName}"`);
      }
    }
  }

  console.log(`\nDone! Normalized ${updateCount} events. Skipped ${skipCount} correctly formatted events.`);
}

run().catch(console.error);
