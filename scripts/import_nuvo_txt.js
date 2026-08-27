// Step 2 of the NUVO import — thin config around the shared DanceOne
// importer (scripts/lib/danceone_import.js). Run only after reviewing
// tobeprocessed/nuvo/txt/. NUVO's youngest age division is "NUbie".
// Usage: node scripts/import_nuvo_txt.js [--apply]
const path = require('path');
const { run } = require('./lib/danceone_import');

run({
  slug: 'nuvo',
  name: 'NUVO Dance Convention',
  site: 'https://gonuvo.com',
  txtDir: path.join(__dirname, '..', 'tobeprocessed', 'nuvo', 'txt'),
}).then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
