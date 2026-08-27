// Step 1 of the Tremaine import: download winners PDFs to raw/tremaine/<year>/.
//
// Tremaine (tremainedance.com, WordPress) posts one PDF per event under
// /wp-content/uploads/ with a stable name:
//   <YYYY>TREMAINE-<eventNum>-<CITY>-SemiFinalsWinners-ALL-<dates>.pdf
//   (also SummerWinners / NationalFinalsWinners / *_NATIONAL-FINALS-winners)
// The site only links the CURRENT season (2025-26 tour = events 833-857),
// but the Wayback Machine holds every season's links back to 2018 — and
// some de-linked files are still live on the server. The seed list
// (scripts/seed/tremaine_pdf_urls.txt) was mined 2026-08-27 from Wayback
// captures of the winners pages + a CDX sweep of /wp-content/uploads/.
//
// Sources, in order: live URL -> Wayback (web.archive.org/web/2id_/<url>,
// raw original bytes of the newest capture). The one '.pdff' typo link is
// retried with the corrected extension. Incremental: cached files are
// skipped, so future seasons only need the live winners pages, which this
// script also scrapes for new links on every run.
//
// Step 2: scripts/extract_tremaine.py -> tobeprocessed/tremaine/txt/ for
// review, then the importer. Never import unreviewed.
//
// Usage: node scripts/download_tremaine_pdfs.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const RAW = path.join(__dirname, '..', 'raw', 'tremaine');
const SEED = path.join(__dirname, 'seed', 'tremaine_pdf_urls.txt');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const PAGES = [
  'https://www.tremainedance.com/winners/winter-tour-semi-finalist-winners/',
  'https://www.tremainedance.com/winners/summer-dance-competition-winners/',
  'https://www.tremainedance.com/winners/',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, opts = {}) {
  return axios.get(url, { headers: { 'User-Agent': UA }, maxRedirects: 8, timeout: 90000, ...opts });
}

// season/calendar year for the directory: the filename's own prefix year
// ("2025TREMAINE-833-..." = a fall-2025 event even though it sits in an
// uploads/2026/01 folder); non-standard names fall back to the path year.
function yearOf(url) {
  const base = path.basename(url);
  let m = base.match(/^(20\d\d)TREMAINE/i);
  if (m) return m[1];
  m = base.match(/^(20\d\d)[_-]/);
  if (m) return m[1];
  m = url.match(/uploads\/(20\d\d)\//);
  return m ? m[1] : 'misc';
}

async function fetchPdf(url) {
  const variants = [url];
  if (url.endsWith('.pdff')) variants.push(url.slice(0, -1));
  else variants.push(url + 'f');   // the ANAHEIM-853 typo, both directions
  for (const u of variants) {
    try {
      const res = await get(u, { responseType: 'arraybuffer' });
      if (res.data.slice(0, 5).toString().startsWith('%PDF')) return { data: res.data, source: 'live' };
    } catch (e) { /* fall through */ }
  }
  // Wayback keeps what the live site dropped; it rate-limits, so back off
  // and retry. Old captures may live under either host form.
  const hosts = [url, url.replace('https://www.', 'https://')];
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const u of hosts) {
      try {
        const res = await get(`https://web.archive.org/web/2id_/${u}`, { responseType: 'arraybuffer' });
        if (res.data.slice(0, 5).toString().startsWith('%PDF')) return { data: res.data, source: 'wayback' };
      } catch (e) {
        if (e.response && (e.response.status === 429 || e.response.status >= 500)) {
          await sleep(15000 * (attempt + 1));
        }
      }
    }
  }
  return null;
}

async function main() {
  const urls = new Set(
    fs.readFileSync(SEED, 'utf8').split('\n').map(s => s.trim()).filter(s => s.startsWith('http')));
  for (const page of PAGES) {
    try {
      const html = (await get(page)).data;
      for (const m of html.matchAll(/href="(https:\/\/www\.tremainedance\.com\/wp-content\/uploads\/[^"]+\.pdff?)"/g)) {
        const u = m[1];
        if (/winner|final/i.test(u) && !/Lineup|What-To-Expect/i.test(u)) urls.add(u);
      }
    } catch (e) {
      console.error(`${page}: ${e.message}`);
    }
  }

  let downloaded = 0, cached = 0, failed = 0;
  for (const url of [...urls].sort()) {
    const name = path.basename(url).replace(/\.pdff$/, '.pdf');
    const dir = path.join(RAW, yearOf(url));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { cached++; continue; }
    const got = await fetchPdf(url);
    if (!got) {
      failed++;
      console.error(`FAILED: ${url}`);
      continue;
    }
    fs.writeFileSync(dest, got.data);
    downloaded++;
    console.log(`${yearOf(url)}/${name} (${got.data.length}b, ${got.source})`);
    await sleep(800);
  }
  console.log(`\nDone: ${downloaded} downloaded, ${cached} cached, ${failed} failed of ${urls.size} urls.`);
}

main().catch(err => { console.error(err); process.exit(1); });
