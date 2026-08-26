// Weekly refresh of the Upcoming Events Directory (phase 2, ideas.md §7).
// Usage: node scripts/scrape_upcoming_events.js [--apply] [--only=key]
//
// Scrapes published tour schedules for the 10 orgs whose sites share the
// DanceBug platform, in three markup flavors:
//   karGrid — .event-details blocks (KAR's own grid, Rainbow's table,
//             Refresh) with ISO data-date attrs or sibling .date-column text
//   ultra   — .sc_events_item blocks ("Tour Stop N" theme markup)
//   widget  — dancebug.com/rf/events_list.php?ifid=N tables with
//             data-title'd cells (the Star Dance Alliance brands et al.)
//
// Rules of the table (org_upcoming_events):
//   - owner rows are NEVER touched — the dashboard is authoritative
//   - scraped rows upsert on org+start+city+venue+name; if no exact match,
//     a single non-owner candidate on org+start+city is updated in place
//     (converges seed naming onto scraped naming without duplicates)
//   - after a healthy scrape (>= MIN_ROWS), future non-owner rows the
//     scrape didn't see get status='unlisted' (hidden publicly, kept for
//     history; revived to 'active' if they reappear)
//
// Dry-run by default; --apply writes. Respects DB_PATH (the Monday weekly
// pipeline runs this against the staging copy like everything else).
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { openDb } = require(path.join(__dirname, '..', 'database'));
const { ensureUpcomingTable } = require(path.join(__dirname, '..', 'utils', 'upcoming'));

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const MIN_ROWS = 5; // below this a parse is considered broken: no unlisting
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ifids verified 2026-08-26 against hand-checked seed data (first rows of
// each widget matched the org's known tour). If a widget ever returns a
// suspicious city set, re-verify the ifid before trusting it.
const SOURCES = [
  { key: 'kar',        org: 'KAR Dance Competition',                type: 'karGrid', url: 'https://dancekar.com/competition/schedule',            base: 'https://dancekar.com' },
  { key: 'rainbow',    org: 'Rainbow National Dance Competition',   type: 'karGrid', url: 'https://www.rainbowdance.com/schedule',                base: 'https://www.rainbowdance.com' },
  { key: 'refresh',    org: 'Refresh Dance Competition',            type: 'karGrid', url: 'https://refreshdance.com/competition/schedule',        base: 'https://refreshdance.com' },
  { key: 'ultra',      org: 'Ultra Dance Tour',                     type: 'ultra',   url: 'https://www.ultradancetour.com/competition/schedule',  base: 'https://www.ultradancetour.com' },
  { key: 'starpower',  org: 'Starpower Talent Competition',         type: 'widget',  ifid: 161, nationalsLabel: 'National Championships' },
  { key: 'revolution', org: 'Revolution Talent Competition',        type: 'widget',  ifid: 154 },
  { key: 'believe',    org: 'Believe Talent Competition',           type: 'widget',  ifid: 152 },
  { key: 'imagine',    org: 'Imagine Dance Challenge',              type: 'widget',  ifid: 150 },
  { key: 'nexstar',    org: 'Nexstar National Dance Competition',   type: 'widget',  ifid: 148 },
  { key: 'dreammaker', org: 'DreamMaker Dance Competition',         type: 'widget',  ifid: 146 },
];

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// "January 29-31, 2027" | "June 28 - July 4, 2027" | "February 15, 2027"
// Refresh-style year-less dates ("Feb 12-14") take seasonYear from the
// event link path; season labels are spring years, so Aug-Dec dates
// belong to the calendar year before (KAR's Nov 2026 stops sit in the
// "2027 season").
function parseDateRange(text, seasonYear) {
  const m = String(text || '').trim().replace(/\s+/g, ' ')
    .match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:\s*[-–]\s*(?:([A-Za-z]+)\.?\s+)?(\d{1,2}))?,?\s*(\d{4})?$/);
  if (!m) return null;
  const m1 = MONTHS[m[1].toLowerCase()];
  if (!m1) return null;
  let year;
  if (m[5]) year = Number(m[5]);
  else if (seasonYear) year = m1 >= 8 ? seasonYear - 1 : seasonYear;
  else return null;
  const start = iso(year, m1, Number(m[2]));
  let end = null;
  if (m[4]) {
    const m2 = m[3] ? MONTHS[m[3].toLowerCase()] : m1;
    if (!m2) return null;
    // a range like "Dec 28 - Jan 2" rolls into the next year
    const endYear = m2 < m1 ? year + 1 : year;
    end = iso(endYear, m2, Number(m[4]));
  }
  return { start, end };
}

// "Redondo Beach, CA" → { city, state }. Widget locations look like
// "City, Full State, US" and sometimes embed the org's own display
// suffixes ("Wilmington, OH-1, Ohio, US", "TBA Tampa TBA, Florida, US") —
// strip country, state, redundant state-code tokens, and TBA markers.
function parsePlace(text) {
  const parts = String(text || '').trim().replace(/\s+/g, ' ').split(',').map(s => s.trim()).filter(Boolean);
  let state = '';
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (/^(us|usa|canada)$/i.test(last)) { parts.pop(); continue; }
    if (!state && STATES[last.toLowerCase()]) { state = STATES[last.toLowerCase()]; parts.pop(); continue; }
    if (!state && /^[A-Z]{2}$/.test(last)) { state = last; parts.pop(); continue; }
    if (state && /^[A-Z]{2}(\s*-\s*\d+)?(\s*\(.*\))?$/i.test(last)) { parts.pop(); continue; }
    break;
  }
  const city = parts.join(', ').replace(/\bTBA\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return { city, state };
}

const spanDays = (ev) => ev.end
  ? Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 86400000)
  : 0;

function stopName(src, ev) {
  const label = spanDays(ev) >= 4 ? (src.nationalsLabel || 'Nationals') : 'Regional';
  return `${label} — ${ev.city}`;
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeout: 30000, maxRedirects: 5,
  });
  return res.data;
}

function parseKarGrid(src, html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.event-details').each((_, el) => {
    const $el = $(el);
    let start = $el.attr('data-date') || '';
    let end = null;
    const href0 = $el.find('a').first().attr('href') || '';
    const seasonYear = Number((href0.match(/\/(20\d{2})\//) || [])[1]) || null;
    const humanDates = $el.attr('data-dates')
      || $el.closest('tr').find('.date-column').first().text()
      || $el.closest('.events-list-group').find('.date-column').first().text();
    const range = parseDateRange(humanDates, seasonYear);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) start = range ? range.start : '';
    if (range) end = range.end;
    if (!start) return;
    // city text can embed the org's own labels: "KAR Exclusive Panama
    // City, FL National Finals", "Redondo Beach, CA - 2" — strip labels
    // before splitting city/state.
    let cityText = $el.find('.event-city').first().text();
    const natGrid = /national\s+finals?|nationals\b/i.test(cityText);
    cityText = cityText
      .replace(/national\s+finals?/ig, ' ').replace(/\bnationals\b/ig, ' ')
      .replace(/\b[\w]+\s+exclusive\b/ig, ' ')
      .replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
    const { city, state } = parsePlace(cityText);
    if (!city) return;
    const venue = $el.find('.event-location').first().text().replace(/\s+/g, ' ').replace(/^\s*\/\s*/, '').trim();
    const ev = { start, end, city, state, venue, regUrl: href0 ? new URL(href0, src.base).href : null, sourceUrl: src.url };
    ev.name = (natGrid || spanDays(ev) >= 4)
      ? `${src.nationalsLabel || 'Nationals'} — ${city}`
      : `Regional — ${city}`;
    out.push(ev);
  });
  return out;
}

function parseUltra(src, html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.sc_events_item').each((_, el) => {
    const $el = $(el);
    const range = parseDateRange($el.find('.event-dates').first().text());
    if (!range) return;
    const { city, state } = parsePlace($el.find('.event-title').first().text());
    if (!city) return;
    const venue = $el.find('.sc_events_item_venue').first().text().replace(/\s+/g, ' ').trim();
    const stopNo = $el.find('.sc_events_item_day').first().text().trim();
    const label = $el.find('.sc_events_item_month').first().text().trim();
    const href = $el.attr('href') || $el.find('a').first().attr('href') || '';
    const ev = { start: range.start, end: range.end, city, state, venue, regUrl: href ? new URL(href, src.base).href : null, sourceUrl: src.url };
    ev.name = (label && stopNo) ? `${label} ${stopNo} — ${city}` : stopName(src, ev);
    out.push(ev);
  });
  return out;
}

function parseWidget(src, html) {
  const $ = cheerio.load(html);
  const out = [];
  const sourceUrl = `https://dancebug.com/rf/events_list.php?ifid=${src.ifid}`;
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const cell = (title) => $tr.find(`td[data-title="${title}"]`).first().text().replace(/\s+/g, ' ').trim();
    const range = parseDateRange(cell('Event Date'));
    if (!range) return;
    // "December 31" single-day rows are this platform's TBA placeholder
    if (!range.end && range.start.slice(5) === '12-31') return;
    const { city, state } = parsePlace(cell('Location'));
    if (!city) return;
    const venue = cell('Venue').replace(/\s*Map\s*$/i, '').replace(/^TBA$/i, '').trim();
    // some orgs put the nationals label inside the location cell
    // ("National Championship Round Rock, Texas, US")
    const nat = city.match(/^national(?:s)?(?:\s+championships?|\s+finals?)?\s+(.+)$/i);
    const cleanCity = nat ? nat[1].trim() : city;
    const ev = { start: range.start, end: range.end, city: cleanCity, state, venue, regUrl: null, sourceUrl };
    ev.name = (nat || spanDays(ev) >= 4)
      ? `${src.nationalsLabel || 'Nationals'} — ${cleanCity}`
      : `Regional — ${cleanCity}`;
    out.push(ev);
  });
  return out;
}

const PARSERS = { karGrid: parseKarGrid, ultra: parseUltra, widget: parseWidget };

async function upsertScraped(db, orgId, ev, counts, touched) {
  let row = await db.get(`
    SELECT * FROM org_upcoming_events
    WHERE org_id = ? AND start_date = ? AND LOWER(COALESCE(city, '')) = LOWER(?)
      AND LOWER(COALESCE(venue, '')) = LOWER(?) AND LOWER(name) = LOWER(?)
  `, [orgId, ev.start, ev.city, ev.venue, ev.name]);

  if (!row) {
    // Converge older seed/scraped rows (different name or venue wording)
    // onto this scrape without creating a duplicate — but only when the
    // match is unambiguous.
    const cands = await db.all(`
      SELECT * FROM org_upcoming_events
      WHERE org_id = ? AND start_date = ? AND LOWER(COALESCE(city, '')) = LOWER(?)
        AND source != 'owner'
    `, [orgId, ev.start, ev.city]);
    if (cands.length === 1) row = cands[0];
    else if (cands.length > 1) row = cands.find(c => (c.venue || '').toLowerCase() === ev.venue.toLowerCase()) || null;
  }

  if (row && row.source === 'owner') { counts.ownerKept++; touched.add(row.id); return; }

  if (!row) {
    counts.inserted++;
    if (APPLY) {
      const ins = await db.run(`
        INSERT INTO org_upcoming_events (org_id, name, city, state, venue, start_date, end_date, registration_url, source, source_url, status, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scraped', ?, 'active', CURRENT_TIMESTAMP)
      `, [orgId, ev.name, ev.city, ev.state || null, ev.venue || null, ev.start, ev.end, ev.regUrl, ev.sourceUrl]);
      touched.add(ins.lastID);
    }
    return;
  }

  touched.add(row.id);
  const same = row.name === ev.name && (row.venue || '') === ev.venue &&
    (row.end_date || '') === (ev.end || '') && (row.state || '') === (ev.state || '') &&
    (!ev.regUrl || row.registration_url === ev.regUrl) && row.status === 'active';
  if (same) {
    counts.unchanged++;
    if (APPLY) await db.run(`UPDATE org_upcoming_events SET last_seen_at = CURRENT_TIMESTAMP, source = 'scraped' WHERE id = ?`, [row.id]);
  } else {
    counts.updated++;
    if (APPLY) {
      // keep an existing registration link when this source has none
      await db.run(`
        UPDATE org_upcoming_events
        SET name = ?, state = ?, venue = ?, end_date = ?,
            registration_url = COALESCE(?, registration_url), source_url = ?,
            source = 'scraped', status = 'active',
            updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [ev.name, ev.state || null, ev.venue || null, ev.end, ev.regUrl, ev.sourceUrl, row.id]);
    }
  }
}

async function main() {
  const db = await openDb();
  await ensureUpcomingTable(db);
  const orgs = await db.all('SELECT id, name FROM organizations');
  const orgByName = new Map(orgs.map(o => [o.name.toLowerCase(), o.id]));

  let failures = 0;
  for (const src of SOURCES) {
    if (ONLY && src.key !== ONLY) continue;
    const orgId = orgByName.get(src.org.toLowerCase());
    if (!orgId) { console.log(`[${src.key}] SKIP — org "${src.org}" not in DB`); failures++; continue; }

    let events;
    try {
      const url = src.type === 'widget' ? `https://dancebug.com/rf/events_list.php?ifid=${src.ifid}` : src.url;
      events = PARSERS[src.type](src, await fetchHtml(url));
    } catch (err) {
      console.log(`[${src.key}] FETCH/PARSE FAILED — ${err.message}`);
      failures++;
      continue;
    }

    if (process.env.DUMP) {
      for (const ev of events) console.log(`    [parsed] ${ev.start}${ev.end ? '→' + ev.end : ''} | ${ev.name} | ${ev.city}, ${ev.state} | ${ev.venue}`);
    }

    if (events.length < MIN_ROWS) {
      console.log(`[${src.key}] only ${events.length} rows parsed (< ${MIN_ROWS}) — treating as broken, no changes`);
      failures++;
      continue;
    }

    const counts = { inserted: 0, updated: 0, unchanged: 0, ownerKept: 0 };
    const touched = new Set();
    for (const ev of events) await upsertScraped(db, orgId, ev, counts, touched);

    // Future rows this healthy scrape didn't see are presumed dropped from
    // the schedule — hide them (kept as 'unlisted', never deleted).
    let unlisted = 0;
    const staleRows = await db.all(`
      SELECT id, name, start_date FROM org_upcoming_events
      WHERE org_id = ? AND source != 'owner' AND status = 'active'
        AND COALESCE(end_date, start_date) >= date('now')
    `, [orgId]);
    for (const r of staleRows) {
      if (touched.has(r.id)) continue;
      unlisted++;
      if (APPLY) await db.run(`UPDATE org_upcoming_events SET status = 'unlisted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [r.id]);
      else console.log(`    would unlist: ${r.start_date} ${r.name}`);
    }

    console.log(`[${src.key}] ${events.length} rows — insert ${counts.inserted}, update ${counts.updated}, unchanged ${counts.unchanged}, owner-kept ${counts.ownerKept}, unlisted ${unlisted}`);
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}${failures ? ` — ${failures} source(s) failed` : ''}`);
  if (!APPLY) console.log('re-run with --apply to write.');
  if (failures) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
