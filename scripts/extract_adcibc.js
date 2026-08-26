// ADC|IBC (Youth International Ballet Competition, adcibc.com) winners →
// reviewable txt. Two-step convention: this script only writes
// tobeprocessed/adcibc/txt/<year>.txt for human review; the importer is a
// separate step after the txt is approved.
//
// Usage: node scripts/extract_adcibc.js [year ...]   (default 2022..2026)
//
// Source pages (https://www.adcibc.com/<year>-winners) are Wix but the
// winners are server-rendered. The page is one linear flow, so parsing is
// a state machine over cleaned text lines:
//   FEMALE/MALE DIVISION ... PRIMARY/JUNIOR/SENIOR DIVISION ... venue line
//   award label (GOLD MEDAL, 4TH PLACE, TOP 25, 1ST PLACE, ...) then one
//   "Name (Studio, ST)" line per recipient. ENSEMBLE DIVISION swaps the
//   age divisions for CLASSICAL PAS DE DEUX / DUET | TRIO / LARGE
//   ENSEMBLE; SPECIAL AWARDS carries its own headers.
// Cash-prize lines ($...) are skipped. Anything unrecognized is kept with
// a FLAG so review catches format drift.
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'raw', 'adcibc');
const OUT_DIR = path.join(ROOT, 'tobeprocessed', 'adcibc', 'txt');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const years = process.argv.slice(2).filter(a => /^\d{4}$/.test(a)).map(Number);
const YEARS = years.length ? years : [2022, 2023, 2024, 2025, 2026];

// page-chrome lines that never carry results
const CHROME = new Set(['HOME', 'ABOUT US', 'OUR JURY', 'SUPPORT US', 'LOCATIONS',
  'COMPETITOR INFO', 'REGISTRATION', 'REGISTER', 'GET UPDATED', 'WINNERS', 'RESULTS',
  'TOP PLACEMENTS', 'FAQ', 'CONTACT', 'MERCHANDISE', 'SCHOLARSHIPS']);

const GENDER_RE = /^(FEMALE|MALE)\s+DIVISION$/i;
const AGEDIV_RE = /^([A-Z][A-Z\- ]+?)\s+DIVISION$/;
const ENSEMBLE_SECTIONS = /^(CLASSICAL PAS DE DEUX|CONTEMPORARY PAS DE DEUX|DUET\s*\|\s*TRIO|DUET|TRIO|SMALL ENSEMBLE|LARGE ENSEMBLE|ENSEMBLE)$/i;
const VENUE_RE = /^([A-Z][A-Z.\- ]+?)\s+FINALS$/;
const AWARD_RE = /^(GOLD MEDAL|SILVER MEDAL|BRONZE MEDAL|[1-9](?:ST|ND|RD|TH) PLACE|TOP \d+|GRAND PRIX.*|.*GRAND PRIX RECIPIENT.*|HONORABLE MENTION.*)$/i;
const SPECIAL_HDR_RE = /AWARD|OUTSTANDING|ENCOURAGEMENT|EXCELLENCE|PHOTOGRAPHER|MENTION/i;
// "Name (Studio, ST)" / "Name (Studio, COUNTRY)" / "Name (Independent)"
const ENTRY_RE = /^(.+?)\s*\(([^()]+)\)\s*$/;

const PLACE_FOR = (award) => {
  const a = award.toUpperCase();
  if (a.includes('GOLD MEDAL')) return '1';
  if (a.includes('SILVER MEDAL')) return '2';
  if (a.includes('BRONZE MEDAL')) return '3';
  const m = a.match(/^([1-9])(?:ST|ND|RD|TH) PLACE$/);
  if (m) return m[1];
  if (a.includes('GRAND PRIX')) return '1';
  return '';
};

function pageToLines(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '\n');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
  return t.split('\n')
    .map(l => l.replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => l && !CHROME.has(l.toUpperCase()));
}

async function fetchYear(year) {
  const cacheFile = path.join(RAW_DIR, String(year), 'winners.html');
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  const res = await axios.get(`https://www.adcibc.com/${year}-winners`, {
    headers: { 'User-Agent': UA }, timeout: 30000, maxRedirects: 5,
  });
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, res.data);
  return res.data;
}

function extract(year, lines) {
  // The Wix page is a two-column grid per age division and linearized DOM
  // order emits the FEMALE/MALE column headers in bursts before the award
  // runs they describe. Every solo list starts at GOLD MEDAL, so gender
  // headers go into a queue and each run consumes one; a run with no
  // queued gender is a combined division (2022's Primary). Age = latest
  // age header at run start. Grand Prix entries sit between blocks and
  // take the nearest preceding age header.

  // merge entries whose "(Studio, ST)" got split across markup nodes
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    let guard = 0;
    while (l.includes('(') && !l.includes(')') && i + 1 < lines.length && guard++ < 3) {
      l = `${l} ${lines[++i]}`.replace(/\s+/g, ' ');
    }
    // stray doubled close-parens ("...NC))") break the entry regex
    if ((l.match(/\(/g) || []).length === 1) l = l.replace(/\)+\s*$/, ')');
    merged.push(l);
  }

  const rows = [];
  const flags = [];
  let mode = 'SOLO';               // SOLO -> ENSEMBLE -> SPECIAL
  let pendingRoutine = null;       // ensemble rows arrive as routine+studio, then dancers
  const flushPending = () => {
    if (pendingRoutine) { rows.push(pendingRoutine); pendingRoutine = null; }
  };
  // Gender attribution: the Wix two-column layout emits FEMALE/MALE
  // DIVISION headers in bursts before the runs they describe, so we queue
  // them and consume one per GOLD MEDAL run. A run with no queued gender
  // is a combined division (2022's Primary). Age comes from the latest
  // age header at run start.
  const genderQueue = [];
  let runGender = '', runAge = '';
  let lastAgeHeader = '';          // also serves the Grand Prix blocks
  let ensembleSection = '';
  let venue = '';
  let award = '';

  const SKIP_RE = /^\$[\d,.]|Prize Sponsored|Highest Scoring|Scoring .*Cash Prize|^ghest Scoring|Medalist out of/i;
  const SPECIAL_CHROME = /@|Click For|bottom of page|^Contracts,|TRADEMARK|^\d{4} Honoree$|^ADC IBC INCLUDES/i;

  for (const line of merged) {
    if (SKIP_RE.test(line)) continue;
    if (line.length < 3) continue; // markup fragments ("Hi" from a split "Highest…")
    if (/^ENSEMBLE DIVISION$/i.test(line)) { flushPending(); mode = 'ENSEMBLE'; award = ''; continue; }
    if (/^SPECIAL AWARDS$/i.test(line)) { flushPending(); mode = 'SPECIAL'; award = ''; continue; }
    if (VENUE_RE.test(line)) { venue = line.match(VENUE_RE)[1].trim(); continue; }
    const genderM = line.match(GENDER_RE);
    if (genderM) { if (mode === 'SOLO') genderQueue.push(genderM[1].toUpperCase()); continue; }
    const ageM = line.match(AGEDIV_RE);
    if (mode === 'SOLO' && ageM && !/ENSEMBLE/i.test(line)) { lastAgeHeader = ageM[1].trim(); continue; }
    if (mode === 'ENSEMBLE' && ENSEMBLE_SECTIONS.test(line)) { flushPending(); ensembleSection = line.toUpperCase(); award = ''; continue; }

    if (AWARD_RE.test(line)) {
      flushPending();
      award = line.toUpperCase();
      if (mode === 'SOLO' && award === 'GOLD MEDAL') {
        runGender = genderQueue.shift() || '';
        runAge = lastAgeHeader;
      }
      continue;
    }
    if (mode === 'SPECIAL' && line === line.toUpperCase() && SPECIAL_HDR_RE.test(line) && line.length < 60) {
      award = line; continue;
    }
    if (!award) continue;

    // recipient line: "Who (Studio, LOC)", or plain names (ensembles,
    // special awards, entries whose studio simply is not listed)
    let who = line, studio = '', loc = '';
    const entry = line.match(ENTRY_RE);
    if (entry) {
      who = entry[1].trim();
      let inParens = entry[2].trim();
      const li = inParens.lastIndexOf(',');
      if (li > 0) {
        const tail = inParens.slice(li + 1).trim();
        if (/^[A-Z]{2}$/.test(tail) || (/^[A-Z][A-Za-z .]+$/.test(tail) && tail.length <= 20)) {
          studio = inParens.slice(0, li).trim(); loc = tail;
        } else studio = inParens;
      } else studio = inParens;
    } else {
      if (mode === 'SPECIAL' && SPECIAL_CHROME.test(line)) continue;
      if (mode === 'SOLO') { flags.push(`UNPARSED (after "${award}"): ${line}`); continue; }
      if (/^[A-Z |&.\d-]+$/.test(line)) continue; // stray all-caps header
    }

    let sec;
    if (mode === 'SPECIAL') sec = 'SPECIAL AWARDS';
    else if (mode === 'ENSEMBLE') sec = `ENSEMBLE — ${ensembleSection || '?'}`;
    else if (award.includes('GRAND PRIX')) sec = `GRAND PRIX — ${lastAgeHeader || '?'}`;
    else sec = [runGender, runAge || '?'].filter(Boolean).join(' ');

    if (mode === 'ENSEMBLE') {
      if (entry) {
        // routine + studio line — hold for the dancers line that follows
        flushPending();
        pendingRoutine = { sec, award, place: PLACE_FOR(award), who: '', routine: who, studio, loc, venue };
      } else if (pendingRoutine && pendingRoutine.award === award) {
        pendingRoutine.who = who;
        flushPending();
      } else {
        flushPending();
        rows.push({ sec, award, place: PLACE_FOR(award), who, routine: '', studio, loc, venue });
      }
      continue;
    }
    rows.push({ sec, award, place: PLACE_FOR(award), who, routine: '', studio, loc, venue });
  }
  flushPending();
  return { rows, flags };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const year of YEARS) {
    let html;
    try { html = await fetchYear(year); }
    catch (err) { console.log(`[${year}] FETCH FAILED: ${err.message}`); continue; }
    const { rows, flags } = extract(year, pageToLines(html));

    const venue = rows.find(r => r.venue) ? rows.find(r => r.venue).venue : '';
    const out = [
      `# ADC|IBC ${year} World Finals winners — extracted ${new Date().toISOString().slice(0, 10)} from https://www.adcibc.com/${year}-winners`,
      `# Venue line on page: ${venue || 'none found'}`,
      `# NOTE gender attribution assumes each age division lists the FEMALE column first`,
      `# (matches the visible page layout) — sanity-check a few names per section.`,
      `# Format: Sec | Award | Place | Recipient | Studio | Loc`,
      '',
      ...rows.map(r => `Sec: ${r.sec} | Award: ${r.award} | Place: ${r.place} | Who: ${r.who} | Studio: ${r.studio} | Loc: ${r.loc}${r.routine ? ` | Routine: ${r.routine}` : ''}`),
    ];
    if (flags.length) {
      out.push('', `# ---- ${flags.length} FLAGGED LINES (review) ----`,
        ...flags.map(f => `# ${f}`));
    }
    const outFile = path.join(OUT_DIR, `${year}.txt`);
    fs.writeFileSync(outFile, out.join('\n') + '\n');
    console.log(`[${year}] ${rows.length} awards → ${path.relative(ROOT, outFile)}  (${flags.length} flagged)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
