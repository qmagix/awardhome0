// Step 2 of the 24SEVEN import — thin config around the shared DanceOne
// importer (scripts/lib/danceone_import.js). Run only after reviewing
// tobeprocessed/24seven/txt/. Youngest age division: "Sidekick".
// Usage: node scripts/import_24seven_txt.js [--apply]
const path = require('path');
const { run } = require('./lib/danceone_import');

run({
  slug: 'twentyfourseven',
  name: '24SEVEN Dance Convention',
  site: 'https://24sevendance.com',
  txtDir: path.join(__dirname, '..', 'tobeprocessed', '24seven', 'txt'),
}).then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
