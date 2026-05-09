const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { generateDancerId, generateStudioId } = require('./utils');

const db = new sqlite3.Database('./database.sqlite');
const dbAll = promisify(db.all.bind(db));
const dbRun = promisify(db.run.bind(db));

async function migrate() {
  console.log('Starting Migration: Standardizing Unique IDs...');

  // 1. Migrate Dancers
  const dancers = await dbAll('SELECT id, name, unique_id FROM dancers');
  let dancersUpdated = 0;
  for (const dancer of dancers) {
    // Only update if it doesn't match the new DNC-[8-char-hex]-[slug] format
    if (!dancer.unique_id || !dancer.unique_id.match(/^DNC-[a-f0-9]{8}-/)) {
      const newId = generateDancerId(dancer.name);
      await dbRun('UPDATE dancers SET unique_id = ? WHERE id = ?', [newId, dancer.id]);
      dancersUpdated++;
    }
  }
  console.log(`Updated ${dancersUpdated} / ${dancers.length} Dancers.`);

  // 2. Migrate Studios
  const studios = await dbAll('SELECT id, name, unique_id FROM studios');
  let studiosUpdated = 0;
  for (const studio of studios) {
    // Only update if it doesn't match the new STU-[8-char-hex]-[slug] format
    if (!studio.unique_id || !studio.unique_id.match(/^STU-[a-f0-9]{8}-/)) {
      const newId = generateStudioId(studio.name);
      await dbRun('UPDATE studios SET unique_id = ? WHERE id = ?', [newId, studio.id]);
      studiosUpdated++;
    }
  }
  console.log(`Updated ${studiosUpdated} / ${studios.length} Studios.`);

  console.log('Migration Complete!');
  db.close();
}

migrate().catch(console.error);
