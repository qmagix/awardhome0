// Step 1 of the Ultra Dance Tour import (two-step, like Encore/NexStar):
// scrape ultradancetour.com results into reviewable txt files under
// tobeprocessed/ultra/txt/ — NOTHING touches the database. Review, then
// run import_ultra_txt.js (step 2).
//
// Ultra is KAR-family (same DanceBug platform as Rainbow): results index
// at /competition/results/<year>, event pages at .../<year>/<id>, tables
// "Place | Performance Name | Studio | Dancer" with the award type in the
// element before each table. The performance cell embeds a "Play Video"
// link (stripped — the same leak fixed in the KAR/Rainbow scrapers) and
// a "#<number>" entry prefix.
//
// Pages cache under raw/ultra/<year>/ via fetch_cache (scrape_log
// bookkeeping), so re-runs are cheap and deterministic.
//
// Usage (repo root):  node scripts/scrape_ultra_to_txt.js [years...]
//                     default years: 2026 2025 2024 2023 2022
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { fetchWithCache } = require('./fetch_cache');

const txtDir = path.join(__dirname, '..', 'tobeprocessed', 'ultra', 'txt');
if (!fs.existsSync(txtDir)) fs.mkdirSync(txtDir, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function clean(s) {
  return (s || '').replace(/(\s*Play Video)+\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function scrapeEvent(url, year) {
  const { data } = await fetchWithCache(url, 'ultra', year);
  const $ = cheerio.load(data);

  // "Purchase, NY - 3/6/2026 Results — Ultra Dance Tour"
  const title = $('title').text() || '';
  let city = '', dateStr = '';
  const tm = title.match(/^(.*?)\s*-\s*([\d/]+)\s*Results/);
  if (tm) { city = tm[1].trim(); dateStr = tm[2].trim(); }
  let venue = '', dateRange = '';
  $('h1, h2, h3, h4').each((i, el) => {
    const t = $(el).text().trim();
    const d = t.match(/^[A-Z][a-z]+ \d{1,2}(\s*-\s*\d{1,2})?, \d{4}$/);
    if (d && !dateRange) dateRange = t;
    else if (!venue && t && t !== city && !/results|highlights|winners|^top |awards/i.test(t) && !/^[A-Z][a-z]+ \d/.test(t)) venue = t;
  });

  const rows = [];
  $('table').each((ti, tableEl) => {
    const table = $(tableEl);
    const awardType = clean(table.prev().text()) || 'Unknown Award Type';
    const headers = table.find('thead th').map((i, el) => $(el).text().trim()).get();
    if (!headers.length) return;
    const headerStr = headers.join(' | ');
    let placeIdx = 0, perfIdx = 1, studioIdx = 2, dancerIdx = 3, categoryIdx = -1;
    if (/Performance Name \| Studio \| Dancer/.test(headerStr)) {
      placeIdx = 0; perfIdx = 1; studioIdx = 2; dancerIdx = 3; categoryIdx = -1;
    } else if (/Performance Name \| Studio \| Category/.test(headerStr)) {
      placeIdx = 0; perfIdx = 1; studioIdx = 2; dancerIdx = -1; categoryIdx = 3;
    } else if (/Dancer \| Studio \| Category/.test(headerStr)) {
      placeIdx = 0; perfIdx = -1; dancerIdx = 1; studioIdx = 2; categoryIdx = 3;
    } else if (/Performance Name \| Studio/.test(headerStr)) {
      placeIdx = 0; perfIdx = 1; studioIdx = 2; dancerIdx = -1; categoryIdx = -1;
    }

    table.find('tbody tr').each((ri, rowEl) => {
      const cols = $(rowEl).find('td');
      if (!cols.length) return;
      const cell = (idx) => idx >= 0 && cols[idx] ? clean($(cols[idx]).text()) : '';

      let place = cell(placeIdx).replace(/\s*place$/i, '').trim();
      let perfName = '', perfNumber = '';
      if (perfIdx >= 0) {
        const perfInfo = cell(perfIdx);
        perfName = perfInfo;
        const m = perfInfo.match(/#(\d+)\s*(.*)$/);
        if (m) { perfNumber = m[1]; perfName = m[2].trim(); }
        // leading duplicated placement ("1st – ") when no #number present
        perfName = perfName.replace(/^\d+(st|nd|rd|th)\s*[–-]\s*/i, '').trim();
        perfName = perfName.replace(/^"(.*)"$/, '$1').trim(); // titles arrive quoted
      }
      const studio = cell(studioIdx);
      const dancer = dancerIdx >= 0 ? cell(dancerIdx) : '';
      const category = categoryIdx >= 0 ? cell(categoryIdx) : '';
      if (!studio && !perfName && !dancer) return;
      rows.push({ section: awardType, place, entry: perfNumber, routine: perfName, studio, dancer, category });
    });
  });

  return { rows, city, venue, dateStr, dateRange };
}

async function main() {
  const years = process.argv.slice(2).filter(a => /^\d{4}$/.test(a)).map(Number);
  const runYears = years.length ? years : [2026, 2025, 2024, 2023, 2022];
  const summary = [];

  for (const year of runYears) {
    const listUrl = `https://ultradancetour.com/competition/results/${year}`;
    console.log(`\n=== ${year}: ${listUrl}`);
    let listData;
    try {
      listData = (await fetchWithCache(listUrl, 'ultra', year, 'event_list')).data;
    } catch (e) {
      console.error(`  event list failed: ${e.message}`);
      continue;
    }
    const $ = cheerio.load(listData);
    const ids = new Set();
    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(new RegExp(`/competition/results/${year}/(\\d+)`));
      if (m) ids.add(m[1]);
    });
    console.log(`  ${ids.size} events`);

    for (const id of ids) {
      const url = `https://ultradancetour.com/competition/results/${year}/${id}`;
      try {
        const r = await scrapeEvent(url, year);
        const base = `${year}-${id}`;
        const eventName = `Ultra - ${r.city || base}${r.dateRange ? ` (${r.dateRange})` : r.dateStr ? ` (${r.dateStr})` : ''}`;
        const out = [];
        out.push('# Ultra Dance Tour extraction — REVIEW before importing (scripts/import_ultra_txt.js)');
        out.push('# Edit any line freely; the importer reads "Event:", "Year:" and "Sec:" lines.');
        out.push(`Event: ${eventName}`);
        out.push(`Year: ${year}`);
        out.push(`City: ${r.city || 'UNKNOWN'}`);
        out.push(`Venue: ${r.venue || 'UNKNOWN'}`);
        out.push(`SourceURL: ${url}`);
        out.push('');
        r.rows.forEach(a => {
          out.push(`Sec: ${a.section} | Place: ${a.place || 'N/A'} | Entry: ${a.entry || ''} | Routine: ${a.routine} | Studio: ${a.studio || 'N/A'} | Dancer: ${a.dancer || '-'} | Category: ${a.category || '-'} | Flags: -`);
        });
        fs.writeFileSync(path.join(txtDir, base + '.txt'), out.join('\n') + '\n');
        const withDancer = r.rows.filter(a => a.dancer).length;
        summary.push({ file: base, year, rows: r.rows.length, withDancer, city: r.city });
        console.log(`  ${base}: ${r.rows.length} rows (${withDancer} with dancer) — ${r.city || 'city?'}`);
      } catch (e) {
        summary.push({ file: `${year}-${id}`, year, error: e.message });
        console.error(`  ${year}-${id}: FAILED — ${e.message}`);
      }
      await sleep(1000); // politeness (cache makes re-runs free)
    }
  }

  const totals = summary.reduce((s, r) => ({ rows: s.rows + (r.rows || 0), withDancer: s.withDancer + (r.withDancer || 0) }), { rows: 0, withDancer: 0 });
  const lines = [
    `# Extraction summary — ${new Date().toISOString()}`,
    `# events: ${summary.length}, rows: ${totals.rows}, with dancer: ${totals.withDancer}`,
    ...summary.map(r => r.error ? `${r.file}\tERROR\t${r.error}` : `${r.file}\t${r.rows} rows\t${r.withDancer} with dancer\t${r.city || 'city?'}`),
  ];
  fs.writeFileSync(path.join(txtDir, '_extraction_summary.txt'), lines.join('\n') + '\n');
  console.log(`\nTotal: ${totals.rows} rows across ${summary.length} events.`);
  console.log(`Review the txt files in ${txtDir}, then run: node scripts/import_ultra_txt.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
