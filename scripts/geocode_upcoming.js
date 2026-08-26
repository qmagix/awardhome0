// Fill org_upcoming_events.lat/lng from a committed city-centroid cache.
// Usage: node scripts/geocode_upcoming.js [--apply] [--fetch]
//
//   --apply  write coords onto rows (default: report only)
//   --fetch  resolve cache misses via Nominatim (OpenStreetMap), 1.1s
//            apart with a proper User-Agent, and save them into the cache
//
// The cache (scripts/seed/city_coords.json, committed) is the source of
// truth at runtime — prod never needs --fetch unless a brand-new city
// appears; the weekly pipeline runs with --fetch to pick up the few new
// cities a season adds. Coordinates are city centroids: near-me sorting
// needs ~city accuracy, not venue accuracy.
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { openDb } = require(path.join(__dirname, '..', 'database'));
const { ensureUpcomingTable } = require(path.join(__dirname, '..', 'utils', 'upcoming'));

const APPLY = process.argv.includes('--apply');
const FETCH = process.argv.includes('--fetch');
const CACHE_FILE = path.join(__dirname, 'seed', 'city_coords.json');
const UA = 'AwardHome-geocoder/1.0 (hello@awardhome.com)';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const keyOf = (city, state) => `${city}|${state || ''}`.toLowerCase();

async function fetchCoords(city, state) {
  const q = new URLSearchParams({
    city, country: 'USA', format: 'json', limit: '1',
    ...(state ? { state } : {}),
  });
  const res = await axios.get(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { 'User-Agent': UA }, timeout: 20000,
  });
  const hit = Array.isArray(res.data) && res.data[0];
  return hit ? [Number(Number(hit.lat).toFixed(5)), Number(Number(hit.lon).toFixed(5))] : null;
}

async function main() {
  const db = await openDb();
  await ensureUpcomingTable(db);

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { }

  const rows = await db.all(`
    SELECT DISTINCT city, COALESCE(state, '') AS state
    FROM org_upcoming_events
    WHERE city != '' AND (lat IS NULL OR lng IS NULL)
  `);

  let cached = 0, fetched = 0, missing = 0, updated = 0;
  for (const r of rows) {
    const key = keyOf(r.city, r.state);
    if (!(key in cache)) {
      if (!FETCH) { missing++; continue; }
      try {
        // "City/Alt" and "City (Note)" forms geocode on the first segment
        const cleanCity = r.city.split('/')[0].replace(/\(.*\)/, '').trim();
        cache[key] = await fetchCoords(cleanCity, r.state);
        fetched++;
        console.log(`  fetched ${r.city}, ${r.state} → ${JSON.stringify(cache[key])}`);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
        await sleep(1100);
      } catch (err) {
        console.log(`  FETCH FAILED ${r.city}, ${r.state}: ${err.message}`);
        missing++;
        continue;
      }
    } else {
      cached++;
    }
    const coords = cache[key];
    if (!coords) { missing++; continue; }
    if (APPLY) {
      const res = await db.run(`
        UPDATE org_upcoming_events SET lat = ?, lng = ?
        WHERE city = ? AND COALESCE(state, '') = ? AND (lat IS NULL OR lng IS NULL)
      `, [coords[0], coords[1], r.city, r.state]);
      updated += res.changes;
    }
  }

  const still = await db.get(`SELECT COUNT(*) AS n FROM org_upcoming_events WHERE city != '' AND lat IS NULL`);
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — ${rows.length} distinct places: ${cached} cache hits, ${fetched} fetched, ${missing} unresolved; ${updated} rows updated; ${APPLY ? still.n : '?'} rows still missing coords`);
  if (missing && !FETCH) console.log('re-run with --fetch to geocode cache misses (1.1s/request, Nominatim).');
}

main().catch(err => { console.error(err); process.exit(1); });
