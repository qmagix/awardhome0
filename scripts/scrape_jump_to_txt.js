// JUMP (jumptour.com) results -> reviewable txt. Thin config around the
// shared DanceOne-platform scraper (scripts/lib/danceone.js) — JUMP, NUVO
// and sibling brands publish identically.
// Usage: node scripts/scrape_jump_to_txt.js [--from=2022] [--to=2026] [--id=N]
const path = require('path');
const { run } = require('./lib/danceone');

run({
  label: 'JUMP',
  base: 'https://jumptour.com',
  rawDir: path.join(__dirname, '..', 'raw', 'jump'),
  outDir: path.join(__dirname, '..', 'tobeprocessed', 'jump', 'txt'),
}).catch(err => { console.error(err); process.exit(1); });
