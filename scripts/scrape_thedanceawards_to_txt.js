// The Dance Awards (thedanceawards.com) -> reviewable txt (step 1 of the
// two-step import). Break The Floor's season-ending championship — the
// sibling finale to our JUMP/NUVO/24SEVEN imports.
//
// The site is an AngularJS SPA; the winners section loads STATIC JSON:
//   content/json/all-results.json   every event 2011-2026 (27 events,
//                                   Orlando + Las Vegas, earlier New York),
//                                   ~8.5k rows, fully structured
//   content/json/hall-of-fame.json  Best Dancer winners + SOTY (photos) —
//                                   redundant with all-results, not used
//   content/json/winners.json       year/city index
// No PDFs, no scraping heuristics — the cleanest source of any org so far.
//
// Row anatomy varies by award: Best Dancer rows carry dancer NAME + gender
// + age + placement (1/2/3 or Top-N finalist tiers); Class Scholarship
// rows carry names; Best Performance / High Score / Specialty rows are
// routine+studio (a few with a dancer field). Specialty rows carry their
// real award name in `specialtyaward` (Best Performance by Genre,
// Outstanding Technical Achievement, Best <style> Studio, People's
// Choice...) plus genre/choreographer/director extras. Known data warts
// handled here: one 'c    horeographer' key with embedded spaces, an
// 'undefined' key, 74 empty {} rows, one numeric routine title.
//
// JSON is cached under raw/thedanceawards/ (delete to refetch, or pass
// --refresh); txt lands in tobeprocessed/thedanceawards/txt/, one file per
// event. Review before running the importer.
//
// Usage: node scripts/scrape_thedanceawards_to_txt.js [--refresh]
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE = 'https://thedanceawards.com/content/json';
const RAW = path.join(__dirname, '..', 'raw', 'thedanceawards');
const OUT = path.join(__dirname, '..', 'tobeprocessed', 'thedanceawards', 'txt');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const ORDINAL = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th'}`;

async function fetchJson(name, refresh) {
  fs.mkdirSync(RAW, { recursive: true });
  const cache = path.join(RAW, `${name}.json`);
  if (!refresh && fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const res = await axios.get(`${BASE}/${name}.json`, { headers: { 'User-Agent': UA }, timeout: 60000 });
  fs.writeFileSync(cache, JSON.stringify(res.data));
  return res.data;
}

// keys arrive with embedded whitespace ('c    horeographer') and one
// literal 'undefined'
const cleanRow = r => Object.fromEntries(
  Object.entries(r)
    .filter(([k]) => k !== 'undefined')
    .map(([k, v]) => [k.replace(/\s+/g, ''), typeof v === 'number' && k === 'routine' ? String(v) : v]));

const dash = v => (v === null || v === undefined || v === '' ? '-' : String(v).trim());

function placeText(p) {
  if (p === null || p === undefined || p === '') return '-';
  if (/^\d+$/.test(String(p))) return ORDINAL(parseInt(p, 10)).toUpperCase();
  return String(p).replace(/^TOP/i, 'Top');   // Top 10 / TOP 20 -> Top N
}

function rowLine(r) {
  const g = k => (r[k] === undefined || r[k] === null || r[k] === '' ? null : String(r[k]).trim());
  let sec, cat = [], place = placeText(r.placement), routine = g('routine'),
      dancers = g('dancer') || g('name'), note = [];
  switch (r.award) {
    case 'Best Dancer':
      sec = 'BEST-DANCER';
      cat = [g('age'), g('gender')];
      break;
    case 'Best Performance':
    case 'Best Performances':
      sec = 'BEST-PERFORMANCE';
      cat = [g('age')];
      break;
    case 'High Score by Age Division':
      sec = 'HIGH-SCORE-AGE';
      cat = [g('age'), g('category')];
      break;
    case 'High Score by Performance Division':
      sec = 'HIGH-SCORE-PERF';
      cat = [g('age'), g('perfCategory')];
      break;
    case 'Specialty Award':
    case 'Specialty Awards':
      sec = 'SPECIALTY';
      cat = [g('specialtyaward'), g('genre'), g('age')];
      if (g('choreographer')) note.push(`choreographer: ${g('choreographer')}`);
      if (g('director')) note.push(`director: ${g('director')}`);
      break;
    case 'Class Scholarship Winners':
      sec = 'SCHOLARSHIP';
      place = 'Class Scholarship';
      break;
    case 'Studio Of The Year':
      sec = 'STUDIO-OF-THE-YEAR';
      place = 'Studio of the Year';
      if (g('director')) note.push(`director: ${g('director')}`);
      break;
    default:
      return null;
  }
  let line = `Sec: ${sec} | Cat: ${dash(cat.filter(Boolean).join(' ~ '))} | Place: ${place} | Entry: - | ` +
    `Routine: ${dash(routine)} | Studio: ${dash(g('studio'))} | Dancers: ${dash(dancers)}`;
  if (note.length) line += `   # ${note.join('; ')}`;
  return line;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const all = await fetchJson('all-results', refresh);
  await fetchJson('winners', refresh);       // cached for reference
  await fetchJson('hall-of-fame', refresh);  // cached for reference (photos)
  fs.mkdirSync(OUT, { recursive: true });

  let events = 0, rows = 0, skipped = 0;
  for (const [key, list] of Object.entries(all)) {
    const clean = list.map(cleanRow).filter(r => r.award);
    skipped += list.length - clean.length;
    if (!clean.length) continue;
    const year = clean[0].year || parseInt(key.match(/\d{4}/)?.[0], 10);
    const city = clean[0].city || key.replace(/\s*\d{4}\s*/, '').trim() || 'New York';
    const fname = `${year}-${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
    const lines = [
      '# The Dance Awards -> reviewable txt (see scrape_thedanceawards_to_txt.js). Review before importing.',
      `Event: ${city}`,
      `Year: ${year}`,
      `DateString: ${year}`,
      `SourceFile: thedanceawards/all-results.json ["${key}"]`,
      'SourceURL: https://thedanceawards.com/content/json/all-results.json',
    ];
    for (const r of clean) {
      const line = rowLine(r);
      if (line) lines.push(line);
      else lines.push(`FLAGGED: unknown award type: ${JSON.stringify(r).slice(0, 120)}`);
    }
    fs.writeFileSync(path.join(OUT, fname), lines.join('\n') + '\n');
    events++;
    rows += clean.length;
    console.log(`${fname}: ${key} — ${clean.length} rows`);
  }
  console.log(`\n${events} events -> ${rows} rows (${skipped} empty rows skipped).`);
  console.log('Review tobeprocessed/thedanceawards/txt before importing.');
}

main().catch(err => { console.error(err); process.exit(1); });
