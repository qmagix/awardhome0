// NUVO (gonuvo.com) results -> reviewable txt. Thin config around the
// shared DanceOne-platform scraper (scripts/lib/danceone.js) — same page
// anatomy as JUMP; NUVO's youngest age division is "NUbie" and its class
// scholarships add a Faculty column (ignored by the shared parser).
// Usage: node scripts/scrape_nuvo_to_txt.js [--from=2022] [--to=2026] [--id=N]
const path = require('path');
const { run } = require('./lib/danceone');

run({
  label: 'NUVO',
  base: 'https://gonuvo.com',
  rawDir: path.join(__dirname, '..', 'raw', 'nuvo'),
  outDir: path.join(__dirname, '..', 'tobeprocessed', 'nuvo', 'txt'),
}).catch(err => { console.error(err); process.exit(1); });
