// Step 2 of the RADIX import — thin config around the shared DanceOne
// importer (scripts/lib/danceone_import.js). Run only after reviewing
// tobeprocessed/radix/txt/. RADIX's youngest age division is "Rookie".
// Usage: node scripts/import_radix_txt.js [--apply]
const path = require('path');
const { run } = require('./lib/danceone_import');

run({
  slug: 'radix',
  name: 'RADIX Dance Convention',
  site: 'https://radixdance.com',
  txtDir: path.join(__dirname, '..', 'tobeprocessed', 'radix', 'txt'),
}).then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
