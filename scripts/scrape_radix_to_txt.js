// RADIX (radixdance.com) results -> reviewable txt. Thin config around
// the shared DanceOne-platform scraper (scripts/lib/danceone.js) — same
// page anatomy as JUMP/NUVO; RADIX's youngest age division is "Rookie".
// NOTE the brands share one results backend: radixdance.com will serve
// ANY event id, so only ids from RADIX's own /past-seasons/ index are
// fetched (which is what the shared loadIndex does).
// Usage: node scripts/scrape_radix_to_txt.js [--from=2022] [--to=2026] [--id=N]
const path = require('path');
const { run } = require('./lib/danceone');

run({
  label: 'RADIX',
  base: 'https://radixdance.com',
  rawDir: path.join(__dirname, '..', 'raw', 'radix'),
  outDir: path.join(__dirname, '..', 'tobeprocessed', 'radix', 'txt'),
}).catch(err => { console.error(err); process.exit(1); });
