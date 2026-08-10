// Weekly award-data updater. Re-scrapes the web-scraped orgs incrementally,
// downloads new result PDFs for the PDF-pipeline orgs, and runs the scoped
// post-import steps (dancer backfill, first-place marking, org rules).
// Designed for an unattended weekly cron on the server; also serves as the
// one-time catch-up when run with a wide --window.
//
//   node scripts/weekly_update.js                     # default: this season, 60-day window
//   node scripts/weekly_update.js --window 120        # catch-up: refetch events first seen <=120d ago
//   node scripts/weekly_update.js --years 2026        # explicit season(s), comma-separated
//   node scripts/weekly_update.js --orgs kar,rainbow  # subset (web: kar rainbow yagp starpower
//                                                     #   revolution believe imagine dreammaker;
//                                                     #   pdf: showstopper starquest nycda spotlight)
//   node scripts/weekly_update.js --skip-pdf | --pdf-only
//   node scripts/weekly_update.js --replay            # no cache invalidation: deterministic
//                                                     # re-import from a synced raw/ cache
//
// Freshness model (two tiers):
//   discovery pages (event_list.html / sitemap.html)  -> deleted every run, always refetched
//   result pages                                      -> refetched while "unsettled": first
//     seen within --window days (tracked in scrape_log, seeded from file mtimes); settled
//     pages serve from cache forever. Content hashes detect late edits for the report.
//
// Import scripts are insert-only + idempotent, so refetching a grown page adds
// only the new rows. Corrections on already-imported rows do NOT propagate —
// the "changed pages" section of the report flags those for manual review.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { openDb, initDb, applyOrgFirstPlaceRules } = require('../database');
const { markFirstPlacesForEvents, FIRSTISH_SQL, NOT_EXCLUDED_SQL } = require('../utils/first_place');
const { YEARS_MAP } = require('./dancebug_years');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'raw');
const PDF_ROOT = path.join(ROOT, 'tobeprocessed', 'pdf');
const DISCOVERY_FILES = new Set(['event_list.html', 'sitemap.html']);

// NOTE: batch_import.js resolves DanceBug year ids from its YEARS_MAP —
// extend that map when a new season (2027+) starts.
const WEB_ORGS = [
  { key: 'kar',        script: 'scrape_kar_year.js',    args: (y) => [y] },
  { key: 'rainbow',    script: 'scrape_rainbow_year.js', args: (y) => [y] },
  { key: 'yagp',       script: 'scrape_all_yagp.js',    args: (y) => [y] },
  { key: 'starpower',  script: 'batch_import.js',       args: (y) => ['starpower', y] },
  { key: 'revolution', script: 'batch_import.js',       args: (y) => ['revolution', y] },
  { key: 'believe',    script: 'batch_import.js',       args: (y) => ['believe', y] },
  { key: 'imagine',    script: 'batch_import.js',       args: (y) => ['imagine', y] },
  { key: 'dreammaker', script: 'batch_import.js',       args: (y) => ['dreammaker', y] },
];
// Download-only: extraction + import stay manual (the GOOD- QA step needs eyes).
const PDF_ORGS = [
  { key: 'showstopper', script: 'download_showstopper_pdfs.js', dir: 'showstopper' },
  { key: 'starquest',   script: 'download_starquest_pdfs.js',   dir: 'starquest' },
  { key: 'nycda',       script: 'download_nycda_pdfs.js',       dir: 'nycda' },
  { key: 'spotlight',   script: 'scrape_spotlight.js',          dir: 'spotlight' },
];

function argValue(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
}

function defaultYears() {
  const now = new Date();
  const years = [now.getFullYear()];
  if (now.getMonth() >= 10) years.push(now.getFullYear() + 1); // Nov/Dec: next season starts posting
  return years;
}

function md5File(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

// All cached page files for the target years, as paths relative to raw/.
// DanceBug list pages live under the internal d_year id (raw/starpower/2054/
// for season 2026), so both year spaces are swept.
function listRawFiles(years) {
  const sweepYears = [...years, ...years.map(y => YEARS_MAP[y]).filter(Boolean)];
  const out = [];
  if (!fs.existsSync(RAW)) return out;
  for (const orgDir of fs.readdirSync(RAW)) {
    for (const year of sweepYears) {
      const dir = path.join(RAW, orgDir, String(year));
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (fs.statSync(path.join(dir, f)).isFile()) out.push(path.join(orgDir, String(year), f));
      }
    }
  }
  return out;
}

function countPdfs(dir) {
  const abs = path.join(PDF_ROOT, dir);
  if (!fs.existsSync(abs)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(path.join(d, ent.name));
      else if (ent.name.toLowerCase().endsWith('.pdf')) n++;
    }
  };
  walk(abs);
  return n;
}

async function orgCounts(db) {
  const rows = await db.all(`
    SELECT o.slug, COUNT(DISTINCT e.id) events, COUNT(a.id) awards
    FROM organizations o
    LEFT JOIN events e ON e.org_id = o.id
    LEFT JOIN awards a ON a.event_id = e.id
    GROUP BY o.slug`);
  return Object.fromEntries(rows.map(r => [r.slug, { events: r.events, awards: r.awards }]));
}

async function main() {
  const REPLAY = process.argv.includes('--replay');
  const SKIP_PDF = process.argv.includes('--skip-pdf');
  const PDF_ONLY = process.argv.includes('--pdf-only');
  const WINDOW_DAYS = parseInt(argValue('--window', '60'), 10);
  const years = argValue('--years', '') ? argValue('--years', '').split(',').map(Number) : defaultYears();
  const orgFilter = argValue('--orgs', '') ? new Set(argValue('--orgs', '').split(',')) : null;
  const pick = (list) => list.filter(o => !orgFilter || orgFilter.has(o.key));

  const db = await initDb();
  const before = await orgCounts(db);
  const failures = [];
  const changedPages = [];
  let refetched = 0, discoveryDeleted = 0;

  // ---- Cache maintenance (skip in --replay: imported cache replays as-is) ----
  if (!REPLAY && !PDF_ONLY) {
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString();
    for (const rel of listRawFiles(years)) {
      const abs = path.join(RAW, rel);
      const base = path.basename(rel);
      if (DISCOVERY_FILES.has(base)) {
        fs.unlinkSync(abs);
        await db.run('DELETE FROM scrape_log WHERE file_path = ?', [rel]);
        discoveryDeleted++;
        continue;
      }
      let row = await db.get('SELECT * FROM scrape_log WHERE file_path = ?', [rel]);
      if (!row) {
        // First sight of a pre-existing cache file: seed from its mtime so
        // pages fetched before scrape_log existed settle on their real age.
        const mtime = fs.statSync(abs).mtime.toISOString();
        await db.run(`
          INSERT INTO scrape_log (file_path, org_dir, year, first_fetched_at, last_fetched_at, content_hash)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [rel, rel.split(path.sep)[0], rel.split(path.sep)[1], mtime, mtime, md5File(abs)]);
        row = { first_fetched_at: mtime };
      }
      if (row.first_fetched_at > cutoff) {
        fs.unlinkSync(abs); // unsettled: force refetch, scrape_log row stays
        refetched++;
      }
    }
    console.log(`[cache] ${discoveryDeleted} discovery pages invalidated, ${refetched} unsettled pages queued for refetch (window ${WINDOW_DAYS}d)`);
  }

  // ---- Web org scrapers ----
  if (!PDF_ONLY) {
    for (const org of pick(WEB_ORGS)) {
      for (const year of years) {
        const args = [org.script, ...org.args(year).map(String)];
        console.log(`\n[run] node ${args.join(' ')}`);
        const res = spawnSync('node', args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const tail = (res.stdout || '').trim().split('\n').slice(-3).join(' | ');
        console.log(`      ${tail}`);
        if (res.status !== 0) {
          failures.push(`${org.key} ${year}: exit ${res.status} — ${(res.stderr || '').trim().split('\n').pop()}`);
        }
      }
    }
  }

  // ---- PDF downloads (report-only; extraction/import stay manual) ----
  const pdfNew = {};
  if (!SKIP_PDF) {
    for (const org of pick(PDF_ORGS)) {
      const beforeN = countPdfs(org.dir);
      console.log(`\n[pdf] node ${org.script}`);
      const res = spawnSync('node', [org.script], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (res.status !== 0) failures.push(`${org.key} pdf download: exit ${res.status} — ${(res.stderr || '').trim().split('\n').pop()}`);
      const delta = countPdfs(org.dir) - beforeN;
      if (delta > 0) pdfNew[org.key] = delta;
    }
  }

  // ---- Post-run scrape_log sweep: record new pages, detect changed ones ----
  if (!PDF_ONLY) {
    const now = new Date().toISOString();
    for (const rel of listRawFiles(years)) {
      if (DISCOVERY_FILES.has(path.basename(rel))) continue;
      const hash = md5File(path.join(RAW, rel));
      const row = await db.get('SELECT content_hash FROM scrape_log WHERE file_path = ?', [rel]);
      if (!row) {
        await db.run(`
          INSERT INTO scrape_log (file_path, org_dir, year, first_fetched_at, last_fetched_at, content_hash)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [rel, rel.split(path.sep)[0], rel.split(path.sep)[1], now, now, hash]);
      } else if (row.content_hash !== hash) {
        await db.run('UPDATE scrape_log SET content_hash = ?, last_fetched_at = ?, last_changed_at = ? WHERE file_path = ?',
          [hash, now, now, rel]);
        changedPages.push(rel);
      } else {
        await db.run('UPDATE scrape_log SET last_fetched_at = ? WHERE file_path = ?', [now, rel]);
      }
    }
  }

  // ---- New events: stamp, then scoped post-steps ----
  const newEvents = await db.all(`
    SELECT e.id, e.name, e.year, o.slug AS org_slug, o.id AS org_id
    FROM events e LEFT JOIN organizations o ON o.id = e.org_id
    WHERE e.created_at IS NULL`);
  const newIds = newEvents.map(e => e.id);
  if (newIds.length) {
    await db.run(`UPDATE events SET created_at = CURRENT_TIMESTAMP WHERE id IN (${newIds.map(() => '?').join(',')})`, newIds);

    const marked = await markFirstPlacesForEvents(db, newIds);
    console.log(`\n[firsts] heuristic marked ${marked} first places across ${newIds.length} new events`);

    let ruleChanges = 0;
    for (const ev of newEvents) {
      if (!ev.org_id) continue;
      const { changed } = await applyOrgFirstPlaceRules(db, { eventId: ev.id });
      ruleChanges += changed;
    }
    console.log(`[firsts] org rules adjusted ${ruleChanges} awards on new events`);

    console.log(`[backfill] linking dancers on ${newIds.length} new events...`);
    const bf = spawnSync('node', [path.join(__dirname, 'run_backfill.js'), ...newIds.map(String)],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (bf.status !== 0) failures.push(`run_backfill: exit ${bf.status} — ${(bf.stderr || '').trim().split('\n').pop()}`);
  }

  // ---- Summary ----
  const after = await orgCounts(db);
  console.log('\n================ WEEKLY UPDATE SUMMARY ================');
  console.log(`Years: ${years.join(', ')}  Window: ${WINDOW_DAYS}d${REPLAY ? '  (replay)' : ''}`);
  let anyDelta = false;
  for (const slug of Object.keys(after).sort()) {
    const b = before[slug] || { events: 0, awards: 0 };
    const a = after[slug];
    if (a.events !== b.events || a.awards !== b.awards) {
      anyDelta = true;
      console.log(`  ${slug}: +${a.events - b.events} events, +${a.awards - b.awards} awards (now ${a.events}/${a.awards})`);
    }
  }
  if (!anyDelta) console.log('  no new events or awards');
  if (newEvents.length) {
    console.log(`New events (${newEvents.length}):`);
    for (const ev of newEvents.slice(0, 40)) console.log(`  [${ev.org_slug || '?'} ${ev.year}] ${ev.name}`);
    if (newEvents.length > 40) console.log(`  ... and ${newEvents.length - 40} more`);
    const suspicious = await db.get(`
      SELECT SUM(CASE WHEN ${FIRSTISH_SQL} AND ${NOT_EXCLUDED_SQL} AND a.is_first_place = 0 THEN 1 ELSE 0 END) missing,
             SUM(CASE WHEN NOT (${FIRSTISH_SQL}) AND a.is_first_place = 1 THEN 1 ELSE 0 END) odd
      FROM awards a WHERE a.event_id IN (${newIds.map(() => '?').join(',')})`, newIds);
    console.log(`First-place suspicion on new events: ${suspicious.missing || 0} missing, ${suspicious.odd || 0} odd — review /admin/first-places`);
  }
  if (changedPages.length) {
    console.log(`Changed result pages (already-imported rows are NOT auto-corrected — spot-check):`);
    for (const p of changedPages.slice(0, 20)) console.log(`  ${p}`);
    if (changedPages.length > 20) console.log(`  ... and ${changedPages.length - 20} more`);
  }
  if (Object.keys(pdfNew).length) {
    console.log(`New PDFs awaiting extraction/QA: ${Object.entries(pdfNew).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    console.log('  (run the org\'s categorize/extract script, review GOOD- markings, then its import script)');
  }
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log('=======================================================');
  process.exit(failures.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
