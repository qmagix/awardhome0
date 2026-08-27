// JUMP (jumptour.com) results -> reviewable txt. Step 1 of the two-step
// import; scripts/import_jump_txt.js loads the txt after human review.
//
// Usage: node scripts/scrape_jump_to_txt.js [--from=2022] [--to=2026] [--id=N]
//
// JUMP publishes results as real HTML tables, so this is a plain Cheerio
// parse — no PDF, no positional work:
//   https://jumptour.com/past-seasons/   lists EVERY season's events (the
//     ?season= query is ignored server-side; each season sits in its own
//     .year-YYYY_YYYY div, hidden by JS), giving id + city + date.
//   https://jumptour.com/results/?id=N   one event, sectioned by <h3>
//     (SPECIAL AWARDS / HIGH SCORE BY AGE / HIGH SCORE BY PERFORMANCE /
//     SCHOLARSHIPS) and <h4> (the category, e.g. "Junior : Duo/Trio").
//
// Four table shapes appear, told apart by their <th> row:
//   Place | Routine / Dancer | Studio   solo placements — dancer in parens
//   Place | Routine | Studio            group placements
//   Place | Studio | Dancer             scholarships (WINNER)
//   Studio | Routine                    Best in Studio style awards
//
// Pages are cached under raw/jump/<year>/<id>.html so re-runs are offline
// and deterministic.
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'raw', 'jump');
const OUT_DIR = path.join(ROOT, 'tobeprocessed', 'jump', 'txt');
const INDEX_URL = 'https://jumptour.com/past-seasons/';
const RESULTS_URL = 'https://jumptour.com/results/?id=';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const arg = (k, d) => {
  const a = process.argv.find(x => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : d;
};
const FROM = Number(arg('from', 2022));
const TO = Number(arg('to', 2026));
const ONLY_ID = arg('id', '');

const norm = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function fetchCached(url, cacheFile) {
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 45000, maxRedirects: 5 });
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, res.data);
  await new Promise(r => setTimeout(r, 500));
  return res.data;
}

// every season's events live in the one index page
async function loadIndex() {
  const html = await fetchCached(INDEX_URL, path.join(RAW_DIR, 'past-seasons.html'));
  const $ = cheerio.load(html);
  const events = [];
  $('div[class^="year-"], div[class*=" year-"]').each((_, div) => {
    const cls = ($(div).attr('class') || '').match(/year-(\d{4})_(\d{4})/);
    if (!cls) return;
    const season = `${cls[1]}-${cls[2]}`;
    $(div).find('h2 a[href*="/results/?id="]').each((__, a) => {
      const id = Number(($(a).attr('href').match(/id=(\d+)/) || [])[1]);
      if (!id) return;
      const city = norm($(a).text());
      // city and date live in separate wrappers; ".content.container" is
      // the one block that holds both (plus the RESULTS button)
      const block = $(a).closest('.content.container');
      const text = norm((block.length ? block : $(a).closest('.tour-date-main-content-wrapper')).text());
      const dm = text.match(/([A-Z]{3}\.?\s+\d{1,2}(?:\s*-\s*\d{1,2})?,\s*(\d{4}))/);
      events.push({ id, season, city, date: dm ? dm[1] : '', year: dm ? Number(dm[2]) : null });
    });
  });
  // de-dupe (the page repeats a nav copy of some links)
  const byId = new Map();
  for (const e of events) if (!byId.has(e.id) || (!byId.get(e.id).year && e.year)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// "Tiny Dancer (Gemma Smith)" -> routine + dancers
function splitRoutineDancer(cell) {
  const t = norm(cell);
  const m = t.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!m) return { routine: t, dancers: '' };
  return { routine: norm(m[1]), dancers: norm(m[2]) };
}

function parseEvent(html) {
  const $ = cheerio.load(html);
  const rows = [];
  const flags = [];

  $('table.jt-results-table').each((_, table) => {
    const $t = $(table);
    const headers = $t.find('th').map((i, th) => norm($(th).text())).get();
    const shape = headers.join('|');

    // nearest preceding h4 = category, nearest preceding h3 = section
    const $h4 = $t.parents().addBack().prevAll('h4.jt-main-heading').first();
    const category = norm($h4.length ? $h4.text() : $t.closest('div').prevAll('h4').first().text());
    const $h3 = $t.parents().addBack().prevAll('h3.jt-main-heading').first();
    let section = norm($h3.length ? $h3.text() : '');
    if (!section) section = 'COMPETITION';

    $t.find('tbody tr').each((__, tr) => {
      const cells = $(tr).find('td').map((i, td) => norm($(td).text())).get();
      if (!cells.length || cells.every(c => !c)) return;
      let place = '', routine = '', dancers = '', studio = '';

      if (shape === 'Place|Routine / Dancer|Studio') {
        place = cells[0];
        ({ routine, dancers } = splitRoutineDancer(cells[1]));
        studio = cells[2] || '';
      } else if (shape === 'Place|Routine|Studio') {
        place = cells[0]; routine = cells[1] || ''; studio = cells[2] || '';
      } else if (shape === 'Place|Studio|Dancer') {
        place = cells[0]; studio = cells[1] || ''; dancers = cells[2] || '';
      } else if (shape === 'Studio|Routine') {
        studio = cells[0] || ''; routine = cells[1] || '';
      } else {
        // unknown shape: keep the raw cells visible for review
        flags.push(`unknown table shape [${shape}] under "${category}": ${cells.join(' | ')}`);
        return;
      }
      if (!studio && !dancers && !routine) return;
      rows.push({ section, category, place, routine, dancers, studio });
    });
  });
  return { rows, flags };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const events = await loadIndex();
  console.log(`index: ${events.length} events across ${new Set(events.map(e => e.season)).size} seasons`);

  let files = 0, totalRows = 0, totalFlags = 0, skipped = 0;
  for (const ev of events) {
    if (ONLY_ID && String(ev.id) !== ONLY_ID) continue;
    if (!ONLY_ID && (!ev.year || ev.year < FROM || ev.year > TO)) continue;

    let html;
    try {
      html = await fetchCached(RESULTS_URL + ev.id, path.join(RAW_DIR, String(ev.year), `${ev.id}.html`));
    } catch (err) {
      console.log(`[${ev.id}] FETCH FAILED (${ev.city}): ${err.message}`);
      skipped++;
      continue;
    }
    const { rows, flags } = parseEvent(html);
    if (!rows.length) {
      console.log(`[${ev.id}] ${ev.date} ${ev.city} — no results published, skipped`);
      skipped++;
      continue;
    }

    const eventName = `JUMP ${ev.year} ${ev.city}`;
    const out = [
      `# JUMP ${ev.season} season — scraped ${new Date().toISOString().slice(0, 10)} from ${RESULTS_URL}${ev.id}`,
      `# Source is real HTML tables; section from <h3>, category from <h4>.`,
      `Event: ${eventName}`,
      `Year: ${ev.year}`,
      `Date: ${ev.date}`,
      `City: ${ev.city}`,
      `SourceURL: ${RESULTS_URL}${ev.id}`,
      `# Format: Sec | Cat | Place | Routine | Dancers | Studio`,
      '',
      ...rows.map(r => `Sec: ${r.section} | Cat: ${r.category || '-'} | Place: ${r.place || '-'} | ` +
        `Routine: ${r.routine || '-'} | Dancers: ${r.dancers || '-'} | Studio: ${r.studio || '-'}`),
    ];
    if (flags.length) out.push('', `# ---- ${flags.length} FLAGGED (review) ----`, ...flags.map(f => `# ${f}`));

    const file = path.join(OUT_DIR, `${ev.year}-${ev.id}-${slug(ev.city)}.txt`);
    fs.writeFileSync(file, out.join('\n') + '\n');
    files++; totalRows += rows.length; totalFlags += flags.length;
    console.log(`[${ev.id}] ${ev.date} ${eventName} — ${rows.length} rows${flags.length ? `, ${flags.length} flagged` : ''}`);
  }
  console.log(`\n${files} events → ${totalRows} rows, ${totalFlags} flagged, ${skipped} skipped.`);
  console.log(`Review ${path.relative(ROOT, OUT_DIR)} before importing.`);
}

main().catch(err => { console.error(err); process.exit(1); });
