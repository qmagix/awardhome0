// Weekly award-data updater with a staging gate: nothing reaches the live DB
// until the imported delta passes validation against the org's own history.
//
// Default (cron) flow:
//   1. Snapshot live DB -> staging_import.sqlite (sqlite .backup, WAL-safe)
//   2. Run the full pipeline (cache refresh, scrapers, PDF downloads, scoped
//      post-steps) against the STAGING copy via DB_PATH
//   3. validate_import.js scores every new/changed event green/amber/red
//   4. All green  -> auto-promote: replay the same importers against live
//      (cache hits only — deterministic) + post-steps.   AUTO_PROMOTE=never
//      holds even green runs for manual approval.
//      Any amber/red -> HOLD: live DB untouched, report written to reports/,
//      email sent (REVIEW_EMAIL or SUPERADMIN_EMAIL), exit 5.
//
//   node scripts/weekly_update.js                # staged flow (what cron runs)
//   node scripts/weekly_update.js --promote      # approve a held run: replay to live
//   node scripts/weekly_update.js --direct       # legacy: import straight to live
//   flags: --years 2026,2027  --window <days>  --orgs kar,rainbow,...
//          --skip-pdf | --pdf-only  --replay (no cache invalidation)
//
// Freshness model (two tiers):
//   discovery pages (event_list.html / sitemap.html)  -> refetched every run
//   result pages -> refetched while first seen < --window days (scrape_log),
//   then frozen; content hashes flag late edits in the summary.
//
// Optional LLM second opinion on held runs: LLM_REVIEW=true (needs `claude`
// CLI on PATH; advisory only, appended to the report).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { YEARS_MAP } = require('./dancebug_years');

const ROOT = path.join(__dirname, '..');
const LIVE_DB = path.join(ROOT, 'database.sqlite');
const STAGING_DB = path.join(ROOT, 'staging_import.sqlite');
const REPORTS_DIR = path.join(ROOT, 'reports');
const RAW = path.join(ROOT, 'raw');
const PDF_ROOT = path.join(ROOT, 'tobeprocessed', 'pdf');
const DISCOVERY_FILES = new Set(['event_list.html', 'sitemap.html']);

// NOTE: batch_import.js resolves DanceBug year ids from dancebug_years.js —
// extend that map when a new season (2028+) starts.
const WEB_ORGS = [
  { key: 'kar',        script: 'scrape_kar_year.js',     args: (y) => [y] },
  { key: 'rainbow',    script: 'scrape_rainbow_year.js', args: (y) => [y] },
  { key: 'yagp',       script: 'scrape_all_yagp.js',     args: (y) => [y] },
  { key: 'starpower',  script: 'batch_import.js',        args: (y) => ['starpower', y] },
  { key: 'revolution', script: 'batch_import.js',        args: (y) => ['revolution', y] },
  { key: 'believe',    script: 'batch_import.js',        args: (y) => ['believe', y] },
  { key: 'imagine',    script: 'batch_import.js',        args: (y) => ['imagine', y] },
  { key: 'dreammaker', script: 'batch_import.js',        args: (y) => ['dreammaker', y] },
  // txt-flow orgs (scrape → reviewable txt → idempotent import): the
  // wrapper applies into DB_PATH, so the staged validator still gates.
  { key: 'ultra',      script: 'update_txt_org.js',      args: (y) => ['ultra', y] },
  { key: 'refresh',    script: 'update_txt_org.js',      args: (y) => ['refresh', y] },
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
  if (now.getMonth() >= 10) years.push(now.getFullYear() + 1);
  return years;
}

function md5File(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

// All cached page files for the target years, relative to raw/. DanceBug list
// pages live under the internal d_year id (raw/starpower/2054/ for 2026).
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

// ---------------------------------------------------------------- pipeline
// Runs scrape + import + scoped post-steps against whatever DB openDb resolves
// (DB_PATH env decides: staging pass sets it, promote/direct passes don't).
async function runPipeline(opts) {
  const { years, windowDays, orgFilter, replay, skipPdf, pdfOnly } = opts;
  const { openDb, initDb, applyOrgFirstPlaceRules } = require('../database');
  const { markFirstPlacesForEvents, FIRSTISH_SQL, NOT_EXCLUDED_SQL } = require('../utils/first_place');
  const pick = (list) => list.filter(o => !orgFilter || orgFilter.has(o.key));

  const db = await initDb();
  const before = await orgCounts(db);
  const failures = [];
  const changedPages = [];
  let refetched = 0, discoveryDeleted = 0;

  // ---- Cache maintenance (skip in replay: imported cache replays as-is) ----
  if (!replay && !pdfOnly) {
    const cutoff = new Date(Date.now() - windowDays * 86400 * 1000).toISOString();
    for (const rel of listRawFiles(years)) {
      const abs = path.join(RAW, rel);
      if (DISCOVERY_FILES.has(path.basename(rel))) {
        fs.unlinkSync(abs);
        await db.run('DELETE FROM scrape_log WHERE file_path = ?', [rel]);
        discoveryDeleted++;
        continue;
      }
      let row = await db.get('SELECT * FROM scrape_log WHERE file_path = ?', [rel]);
      if (!row) {
        const mtime = fs.statSync(abs).mtime.toISOString();
        await db.run(`
          INSERT INTO scrape_log (file_path, org_dir, year, first_fetched_at, last_fetched_at, content_hash)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [rel, rel.split(path.sep)[0], rel.split(path.sep)[1], mtime, mtime, md5File(abs)]);
        row = { first_fetched_at: mtime };
      }
      if (row.first_fetched_at > cutoff) {
        fs.unlinkSync(abs);
        refetched++;
      }
    }
    console.log(`[cache] ${discoveryDeleted} discovery pages invalidated, ${refetched} unsettled pages queued for refetch (window ${windowDays}d)`);
  }

  // ---- Web org scrapers ----
  if (!pdfOnly) {
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

  // ---- Upcoming Events refresh (tour dates, directory phase 2) ----
  // Runs against DB_PATH like everything else, so the staged validator
  // still gates promotion. A source failing is a warning, not a blocker —
  // owner-entered rows are never touched and stale rows only unlist after
  // a healthy scrape of that org.
  if (!pdfOnly) {
    console.log('\n[upcoming] node scrape_upcoming_events.js --apply');
    const up = spawnSync('node', [path.join(__dirname, 'scrape_upcoming_events.js'), '--apply'],
      { cwd: __dirname, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    console.log((up.stdout || '').trim().split('\n').map(l => `      ${l}`).join('\n'));
    if (up.status !== 0) failures.push(`upcoming-events refresh: exit ${up.status} — see log above`);

    // Coordinates for near-me: committed cache resolves almost everything;
    // --fetch geocodes the few genuinely new cities a season adds.
    const geo = spawnSync('node', [path.join(__dirname, 'geocode_upcoming.js'), '--fetch', '--apply'],
      { cwd: __dirname, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    console.log(`      ${(geo.stdout || '').trim().split('\n').pop()}`);
    if (geo.status !== 0) failures.push(`upcoming-events geocode: exit ${geo.status}`);
  }

  // ---- PDF downloads (report-only; extraction/import stay manual) ----
  const pdfNew = {};
  if (!skipPdf) {
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
  if (!pdfOnly) {
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

    // Promote legacy solo links (awards.dancer_id) into award_dancers first,
    // so the routine-propagation backfill below has them as sources.
    // Global + idempotent; honors DB_PATH so it hits the staging copy here.
    console.log(`[backfill] promoting legacy solo links into award_dancers...`);
    const lb = spawnSync('node', [path.join(__dirname, 'backfill_legacy_dancer_links.js'), '--apply'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (lb.status !== 0) failures.push(`backfill_legacy_dancer_links: exit ${lb.status} — ${(lb.stderr || '').trim().split('\n').pop()}`);

    // The mirror of the above: promote a SOLO's junction link into the legacy
    // primary column. Several importers write only the junction, which left
    // 79k solos with no primary dancer — they showed under "Group Dancers" in
    // the awards editor and rendered blank wherever a query joins
    // awards.dancer_id. The importers now double-write; this keeps any
    // regression (or a newly-added org) from accumulating silently.
    console.log(`[backfill] promoting solo junction links to the primary column...`);
    const sp = spawnSync('node', [path.join(__dirname, 'backfill_solo_primary_dancer.js'), '--apply'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (sp.status !== 0) failures.push(`backfill_solo_primary_dancer: exit ${sp.status} — ${(sp.stderr || '').trim().split('\n').pop()}`);

    console.log(`[backfill] linking dancers on ${newIds.length} new events...`);
    const bf = spawnSync('node', [path.join(__dirname, 'run_backfill.js'), ...newIds.map(String)],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (bf.status !== 0) failures.push(`run_backfill: exit ${bf.status} — ${(bf.stderr || '').trim().split('\n').pop()}`);

    // Canonical routine keys for freshly imported awards (global + idempotent).
    console.log(`[backfill] sweeping routine keys...`);
    const rk = spawnSync('node', [path.join(__dirname, 'sweep_routine_keys.js'), '--apply'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (rk.status !== 0) failures.push(`sweep_routine_keys: exit ${rk.status} — ${(rk.stderr || '').trim().split('\n').pop()}`);

    // Duplicate dancer profiles converge on routine evidence (same clean
    // name + studio + canonical routine + year) — needs the keys above.
    console.log(`[backfill] auto-merging duplicate dancer profiles...`);
    const am = spawnSync('node', [path.join(__dirname, 'auto_merge_dancer_profiles.js'), '--apply'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (am.status !== 0) failures.push(`auto_merge_dancer_profiles: exit ${am.status} — ${(am.stderr || '').trim().split('\n').pop()}`);

    // Results-table HEADER rows imported as awards ("Routine Name", "Studio").
    // Any extractor can start emitting these after an org changes its PDF
    // layout, and a single survivor is a fake award on a public page — the
    // NexStar case reached 5,502 before anyone noticed. Cheap and idempotent.
    console.log(`[backfill] purging header-row artifact awards...`);
    const ha = spawnSync('node', [path.join(__dirname, 'purge_header_artifact_awards.js'), '--apply'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (ha.status !== 0) failures.push(`purge_header_artifact_awards: exit ${ha.status} — ${(ha.stderr || '').trim().split('\n').pop()}`);
  }

  // ---- Summary ----
  const after = await orgCounts(db);
  console.log('\n================ WEEKLY UPDATE SUMMARY ================');
  console.log(`Years: ${years.join(', ')}  Window: ${windowDays}d${replay ? '  (replay)' : ''}  DB: ${process.env.DB_PATH || 'live'}`);
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
    console.log(`First-place suspicion on new events: ${suspicious.missing || 0} missing, ${suspicious.odd || 0} odd`);
  }
  if (changedPages.length) {
    console.log(`Changed result pages (already-imported rows are NOT auto-corrected — spot-check):`);
    for (const p of changedPages.slice(0, 20)) console.log(`  ${p}`);
    if (changedPages.length > 20) console.log(`  ... and ${changedPages.length - 20} more`);
  }
  if (Object.keys(pdfNew).length) {
    console.log(`New PDFs awaiting extraction/QA: ${Object.entries(pdfNew).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  }
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log('=======================================================');
  return { failures, anyDelta, newEventCount: newEvents.length };
}

// ------------------------------------------------------------ staged flow
async function stagedFlow(opts, forwardArgs) {
  // 1. Snapshot live -> staging (WAL-safe)
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(STAGING_DB + suffix)) fs.unlinkSync(STAGING_DB + suffix);
  }
  console.log(`[staging] snapshotting live DB -> ${path.basename(STAGING_DB)}`);
  const bk = spawnSync('sqlite3', [LIVE_DB, `.backup ${STAGING_DB}`], { encoding: 'utf8' });
  if (bk.status !== 0) { console.error(`Staging snapshot failed: ${bk.stderr}`); process.exit(1); }

  // 2. Full pipeline against staging
  process.env.DB_PATH = STAGING_DB;
  const result = await runPipeline(opts);
  delete process.env.DB_PATH;
  if (result.failures.length) {
    console.error('\nPipeline failures during staging run — holding (live DB untouched).');
    process.exit(1);
  }
  if (!result.anyDelta) {
    console.log('\nNo delta this run — nothing to promote.');
    process.exit(0);
  }

  // 3. Validate the staged delta
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `import_review_${new Date().toISOString().slice(0, 10)}.md`);
  const val = spawnSync('node', [path.join(__dirname, 'validate_import.js'),
    '--staging', STAGING_DB, '--live', LIVE_DB, '--report', reportPath],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  process.stdout.write(val.stdout || '');
  const verdict = val.status === 0 ? 'green' : val.status === 3 ? 'amber' : 'red';

  // Optional LLM second opinion on anything not green (advisory)
  if (verdict !== 'green' && process.env.LLM_REVIEW === 'true') {
    try {
      const report = fs.readFileSync(reportPath, 'utf8');
      const llm = spawnSync('claude', ['-p',
        `You are reviewing scraped dance-competition award data before it goes live. Below is a validation report with per-event metrics and sample rows. For each non-green event say in 1-2 sentences whether the rows look like plausible competition results or like mis-parsed garbage (wrong columns, schedules, non-result documents), and end with VERDICT: publish|hold per event.\n\n${report}`,
        '--output-format', 'text'], { encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
      if (llm.status === 0 && llm.stdout) {
        fs.appendFileSync(reportPath, `\n\n## LLM second opinion (advisory)\n\n${llm.stdout.trim()}\n`);
        console.log('[llm] second opinion appended to report');
      }
    } catch (e) { console.log(`[llm] skipped (${e.message})`); }
  }

  // 4. Promote or hold
  const autoPromote = (process.env.AUTO_PROMOTE || 'green').toLowerCase();
  if (verdict === 'green' && autoPromote !== 'never') {
    console.log('\n[promote] validation green — replaying import against live DB');
    const env = { ...process.env };
    delete env.DB_PATH;
    const pr = spawnSync('node', [__filename, '--promote', ...forwardArgs],
      { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
    process.stdout.write(pr.stdout || '');
    if (pr.status !== 0) { console.error(pr.stderr || 'promote failed'); process.exit(1); }
    process.exit(0);
  }

  // Held: persist pending state (drives the /admin/import-review banner +
  // page; deleted on successful --promote or admin dismiss), then notify.
  fs.writeFileSync(path.join(REPORTS_DIR, 'PENDING_REVIEW.json'), JSON.stringify({
    verdict, reportPath, heldAt: new Date().toISOString(), promoteArgs: forwardArgs, status: 'held'
  }, null, 1));
  console.log(`\n[HELD] verdict=${verdict}, AUTO_PROMOTE=${autoPromote} — live DB untouched.`);
  console.log(`Review: ${reportPath} (or /admin/import-review)`);
  console.log(`Approve with: node scripts/weekly_update.js --promote${forwardArgs.length ? ' ' + forwardArgs.join(' ') : ''}`);
  // Recipients come from the reviewers table (superadmin-managed at
  // /admin/reviewers; env fallback inside the helper). We're reading the
  // staging DB here (DB_PATH points at it), but it's a snapshot of live,
  // so the reviewer list is identical.
  try {
    const { getReviewerEmails } = require('../utils/reviewers');
    const recipients = await getReviewerEmails();
    if (recipients.length) {
      const { sendEmail } = require('../utils/mailer');
      const report = fs.readFileSync(reportPath, 'utf8');
      await sendEmail({
        to: recipients.join(', '),
        subject: `[AwardHome] Weekly import held for review (${verdict.toUpperCase()})`,
        html: `<p>The weekly award import was held — verdict <b>${verdict.toUpperCase()}</b>. Live data is untouched.</p>` +
              `<p><a href="${(process.env.BASE_URL || 'https://awardhome.com')}/admin/import-review">Review and approve in the admin dashboard</a>, ` +
              `or on the server: <code>cd /opt/awardhome && sudo -u awardhome node scripts/weekly_update.js --promote</code></p>` +
              `<pre style="font-size:12px">${report.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`
      });
      console.log(`[notify] review email sent to ${recipients.join(', ')}`);
    }
  } catch (e) { console.log(`[notify] email failed: ${e.message}`); }
  process.exit(5);
}

// ---------------------------------------------------------------- entry
// After the organizer's own data reaches LIVE, any family-created event
// candidate that unambiguously matches a freshly-imported event stops being
// provisional and merges into it — no reviewer needed, because the organizer's
// published data outranks a family's guess by definition. Runs only against
// live (never the staging copy: DB_PATH is unset on the promote/direct passes),
// and never blocks the import — a merge failure must not fail a good run.
async function autoMergeEventCandidates() {
  try {
    const { run } = require('./merge_event_candidates');
    const r = await run({ apply: true });
    console.log(`[candidates] scanned ${r.scanned}, auto-merged ${r.merged.length}, ` +
      `${r.ambiguous.length} ambiguous left for /admin/event-candidates`);
    for (const m of r.merged) {
      console.log(`  merged candidate #${m.candidate_id} "${m.candidate}" -> event ${m.event_id} (${m.submissions} submission(s))`);
    }
  } catch (e) {
    console.error('[candidates] auto-merge skipped:', e.message);
  }
}

async function main() {
  const opts = {
    replay: process.argv.includes('--replay'),
    skipPdf: process.argv.includes('--skip-pdf'),
    pdfOnly: process.argv.includes('--pdf-only'),
    windowDays: parseInt(argValue('--window', '60'), 10),
    years: argValue('--years', '') ? argValue('--years', '').split(',').map(Number) : defaultYears(),
    orgFilter: argValue('--orgs', '') ? new Set(argValue('--orgs', '').split(',')) : null,
  };
  // Args worth forwarding from the staged parent to the promote child
  const forwardArgs = [];
  for (const f of ['--years', '--orgs']) if (argValue(f, '')) forwardArgs.push(f, argValue(f, ''));
  if (opts.skipPdf) forwardArgs.push('--skip-pdf');

  if (process.argv.includes('--promote')) {
    // Replay against live: cache untouched (all hits — deterministic with the
    // staging pass), downloads skipped (already done in staging pass).
    const { failures } = await runPipeline({ ...opts, replay: true, skipPdf: true, pdfOnly: false });
    if (!failures.length) {
      const pending = path.join(REPORTS_DIR, 'PENDING_REVIEW.json');
      if (fs.existsSync(pending)) fs.unlinkSync(pending);
      await autoMergeEventCandidates();
    }
    process.exit(failures.length ? 1 : 0);
  }
  if (process.argv.includes('--direct') || opts.pdfOnly) {
    const { failures } = await runPipeline(opts);
    if (!failures.length) await autoMergeEventCandidates();
    process.exit(failures.length ? 1 : 0);
  }
  await stagedFlow(opts, forwardArgs);
}

main().catch(e => { console.error(e); process.exit(1); });
