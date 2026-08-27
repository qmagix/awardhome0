// Step 2 of the JUMP import — thin config around the shared DanceOne
// importer (scripts/lib/danceone_import.js). Run only after reviewing
// tobeprocessed/jump/txt/.
// Usage: node scripts/import_jump_txt.js [--apply]
const path = require('path');
const { run } = require('./lib/danceone_import');

run({
  slug: 'jump',
  name: 'JUMP Dance Convention',
  site: 'https://jumptour.com',
  txtDir: path.join(__dirname, '..', 'tobeprocessed', 'jump', 'txt'),
}).then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
