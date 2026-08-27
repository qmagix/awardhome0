// Step 1 of the Inspire NDC import: download results files from the org's
// public DanceComp Genie portal (inspirendc.dancecompgenie.com).
//
// CompGenie's public results module (Dance-Competition/result.aspx) is an
// ASP.NET WebForms page: select a year (__doPostBack on ddlYear), click
// Search (btnSearch), then walk the gridview pager (Page$N postbacks).
// Each grid row is Date | State | Results link | Score Sheets (login-gated).
// The Results link is one of:
//   .pdf   full results book under /ClientData/Modules/Dance-Competition/Pdf/
//          (Overall Awards tables with FULL group performer rosters, Title
//          Winners, Top Score sessions, photogenic/costume/studio awards)
//   .zip   same, zipped (seen once, March 2024)
//   empty.aspx?action=ViewReport&...&locationId=<guid>
//          HTML "Title Result" report — Miss/Mr. title winners ONLY (some
//          2023/2024 events published nothing else)
//   none   event never posted results (all of 2022 is like this)
//
// Files land in raw/inspirendc/<year>/ under their original basename
// (title_<locationId>.html for aspx reports) with an index.json describing
// every grid row (date, state, url, file, kind) — the extractor's map.
// Incremental: files already on disk are not re-downloaded.
//
// Step 2 (offline): scripts/extract_inspirendc.py -> tobeprocessed/inspirendc/txt/
// for review, then scripts/import_inspirendc_txt.js. Never import unreviewed.
//
// Usage: node scripts/scrape_inspirendc_results.js [--from=2023] [--to=2026]
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE = 'https://inspirendc.dancecompgenie.com';
const URL = `${BASE}/Dance-Competition/result.aspx`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const RAW = path.join(__dirname, '..', 'raw', 'inspirendc');

const argv = Object.fromEntries(process.argv.slice(2)
  .map(a => a.match(/^--(\w+)(?:=(.*))?$/)).filter(Boolean).map(m => [m[1], m[2] ?? true]));
const FROM = parseInt(argv.from || '2023', 10);
const TO = parseInt(argv.to || '2026', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Minimal cookie jar — ASP.NET needs its session cookie across postbacks.
const jar = {};
function absorbCookies(res) {
  for (const c of res.headers['set-cookie'] || []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar[kv.slice(0, i)] = kv.slice(i + 1);
  }
}
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function get(url, opts = {}) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, Cookie: cookieHeader() },
    maxRedirects: 5, timeout: 60000, ...opts,
  });
  absorbCookies(res);
  return res;
}

async function post(url, form) {
  const res = await axios.post(url, new URLSearchParams(form).toString(), {
    headers: { 'User-Agent': UA, Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 5, timeout: 60000,
  });
  absorbCookies(res);
  return res;
}

const hiddenFields = html => Object.fromEntries(
  [...html.matchAll(/<input type="hidden" name="([^"]+)"[^>]*value="([^"]*)"/g)].map(m => [m[1], m[2]]));

const yearFields = year => ({
  'ctl00$cpSite$LocationHotels1$ddlYear': String(year),
  'ctl00$cpSite$LocationHotels1$ddlMonth': '',
  'ctl00$cpSite$LocationHotels1$ddlLocationType': '',
  'ctl00$cpSite$LocationHotels1$ddlState': '',
  'ctl00$cpSite$LocationHotels1$ddlCounty': '',
});

function gridRows(html) {
  const rows = [];
  const re = /<tr(?: class="alternatingrowstyle")?>\s*<td class="ItemStyle1">\s*([^<]+?)\s*<\/td><td class="ItemStyle2">\s*([^<]+?)\s*<\/td><td class="ItemStyle4">\s*<span[^>]*>([\s\S]*?)<\/span>/g;
  for (const m of html.matchAll(re)) {
    const href = m[3].match(/href='([^']+)'/);
    rows.push({ date: m[1].trim(), location: m[2].trim(), url: href ? href[1].replace(/&amp;/g, '&') : null });
  }
  return rows;
}

function kindOf(url) {
  if (!url) return 'none';
  const u = url.toLowerCase();
  if (u.endsWith('.pdf')) return 'pdf';
  if (u.endsWith('.zip')) return 'zip';
  if (u.includes('empty.aspx')) return 'title-report';
  return 'other';
}

function fileNameFor(row) {
  if (row.kind === 'pdf' || row.kind === 'zip' || row.kind === 'other') return path.basename(row.url.split('?')[0]);
  const guid = row.url.match(/locationId=([0-9a-f-]+)/i);
  return `title_${guid ? guid[1] : 'unknown'}.html`;
}

async function collectYear(year) {
  // Fresh session per year keeps the postback state simple.
  for (const k of Object.keys(jar)) delete jar[k];
  let html = (await get(URL)).data;
  let form = { ...hiddenFields(html), ...yearFields(year),
    __EVENTTARGET: 'ctl00$cpSite$LocationHotels1$ddlYear', __EVENTARGUMENT: '' };
  html = (await post(URL, form)).data;
  form = { ...hiddenFields(html), ...yearFields(year), 'ctl00$cpSite$LocationHotels1$btnSearch': 'Search' };
  html = (await post(URL, form)).data;

  const rows = gridRows(html);
  const pages = [...new Set([...html.matchAll(/Page\$(\d+)/g)].map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);
  for (const pg of pages) {
    form = { ...hiddenFields(html), ...yearFields(year),
      __EVENTTARGET: 'ctl00$cpSite$LocationHotels1$gridview1', __EVENTARGUMENT: `Page$${pg}` };
    html = (await post(URL, form)).data;
    rows.push(...gridRows(html));
  }
  return rows.map(r => ({ ...r, kind: kindOf(r.url) }));
}

async function main() {
  let downloaded = 0, cached = 0, empty = 0;
  for (let year = FROM; year <= TO; year++) {
    const dir = path.join(RAW, String(year));
    fs.mkdirSync(dir, { recursive: true });
    const rows = await collectYear(year);
    const index = [];
    for (const row of rows) {
      const entry = { date: row.date, location: row.location, kind: row.kind, url: row.url, file: null };
      if (row.kind === 'none') { empty++; index.push(entry); continue; }
      entry.file = fileNameFor(row);
      const dest = path.join(dir, entry.file);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        cached++;
      } else {
        const url = row.url.startsWith('http') ? row.url : BASE + row.url;
        try {
          const res = await get(url, { responseType: 'arraybuffer' });
          fs.writeFileSync(dest, res.data);
          downloaded++;
          console.log(`${year}: ${row.date} ${row.location} -> ${entry.file} (${res.data.length}b)`);
        } catch (e) {
          entry.error = e.message;
          console.error(`${year}: FAILED ${url}: ${e.message}`);
        }
        await sleep(600);
      }
      index.push(entry);
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
    console.log(`${year}: ${rows.length} grid rows — ${rows.filter(r => r.kind === 'pdf').length} pdf, ` +
      `${rows.filter(r => r.kind === 'zip').length} zip, ${rows.filter(r => r.kind === 'title-report').length} title-report, ` +
      `${rows.filter(r => r.kind === 'none').length} unposted`);
  }
  console.log(`\nDone: ${downloaded} downloaded, ${cached} already cached, ${empty} rows without results.`);
}

main().catch(err => { console.error(err); process.exit(1); });
