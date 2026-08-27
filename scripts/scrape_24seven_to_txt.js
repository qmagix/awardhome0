// 24SEVEN (24sevendance.com) results -> reviewable txt. Thin config around
// the shared DanceOne-platform scraper (scripts/lib/danceone.js) — fourth
// sibling of JUMP/NUVO/RADIX; 24SEVEN's youngest age division is
// "Sidekick". Only ids from 24SEVEN's own /past-seasons/ index are fetched
// (the brands share one results backend; indexes verified disjoint).
// Usage: node scripts/scrape_24seven_to_txt.js [--from=2022] [--to=2026] [--id=N]
const path = require('path');
const { run } = require('./lib/danceone');

run({
  label: '24SEVEN',
  base: 'https://24sevendance.com',
  rawDir: path.join(__dirname, '..', 'raw', '24seven'),
  outDir: path.join(__dirname, '..', 'tobeprocessed', '24seven', 'txt'),
}).catch(err => { console.error(err); process.exit(1); });
