// Judges a staged import before it is promoted to the live DB.
//
//   node scripts/validate_import.js --staging <staging.sqlite> [--live <db>] [--report <md>] [--json <json>]
//
// Compares the staging DB (live copy + this week's imports) against live and
// scores every new/changed event against the org's own history:
//   - award count vs the org's per-event distribution
//   - place strings vs the org's known place vocabulary
//   - category novelty vs the org's category vocabulary
//   - share of brand-new studios (junk imports create ~100% new "studios")
//   - junk name shapes (clock times, weekday/month names, tabs, <=2 chars)
//   - insert ratio on PRE-EXISTING events (idempotency-break detector)
// Verdict per event: green / amber / red. Exit 0 = all green (or no delta),
// 3 = amber somewhere, 4 = red somewhere. weekly_update.js promotes only on 0.
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const ROOT = path.join(__dirname, '..');

function argValue(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
}

const JUNK_NAME_RES = [
  /^\d{1,2}:\d{2}\s*([AP]M\.?)?$/i,                                   // clock time
  /^(mon|tues|wednes|thurs|fri|satur|sun)day\b/i,                     // weekday
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i,
  /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/,                           // date
  /\t/,                                                               // tab damage
  /^.{0,2}$/,                                                         // <=2 chars
  /^\d+$/                                                             // pure number
];
const isJunkName = (s) => JUNK_NAME_RES.some(re => re.test((s || '').trim()));

function pct(n, d) { return d ? n / d : 0; }
function fmtPct(x) { return (x * 100).toFixed(0) + '%'; }

async function main() {
  const stagingPath = argValue('--staging');
  const livePath = argValue('--live', path.join(ROOT, 'database.sqlite'));
  const reportPath = argValue('--report', path.join(ROOT, 'reports', `import_review_${new Date().toISOString().slice(0, 10)}.md`));
  const jsonPath = argValue('--json', reportPath.replace(/\.md$/, '.json'));
  if (!stagingPath || !fs.existsSync(stagingPath)) { console.error('Usage: --staging <path> required'); process.exit(1); }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const db = await open({ filename: stagingPath, driver: sqlite3.Database });
  await db.exec(`ATTACH DATABASE '${livePath.replace(/'/g, "''")}' AS live`);

  const maxLive = await db.get(`SELECT
    (SELECT COALESCE(MAX(id),0) FROM live.awards)  AS award,
    (SELECT COALESCE(MAX(id),0) FROM live.studios) AS studio,
    (SELECT COALESCE(MAX(id),0) FROM live.dancers) AS dancer`);

  // Affected events: brand-new, or pre-existing but gained award rows.
  const affected = await db.all(`
    SELECT e.id, e.name, e.year, e.org_id, o.slug AS org_slug,
           (le.id IS NOT NULL) AS pre_existing,
           (SELECT COUNT(*) FROM live.awards la WHERE la.event_id = e.id) AS prior_rows,
           (SELECT COUNT(*) FROM awards a WHERE a.event_id = e.id AND a.id > ?) AS new_rows
    FROM events e
    LEFT JOIN organizations o ON o.id = e.org_id
    LEFT JOIN live.events le ON le.id = e.id
    WHERE EXISTS (SELECT 1 FROM awards a WHERE a.event_id = e.id AND a.id > ?)
       OR le.id IS NULL`, [maxLive.award, maxLive.award]);

  const out = { overall: 'green', generated: new Date().toISOString(), events: [] };
  const md = [`# Import review — ${new Date().toISOString()}`, ''];

  if (!affected.length) {
    out.overall = 'green';
    md.push('No new or changed events. Nothing to review.');
  }

  // Per-org baselines from live, cached
  const baselines = new Map();
  async function baseline(orgId) {
    if (baselines.has(orgId)) return baselines.get(orgId);
    const counts = (await db.all(`
      SELECT COUNT(*) c FROM live.awards a JOIN live.events e ON e.id = a.event_id
      WHERE e.org_id = ? GROUP BY e.id ORDER BY c`, [orgId])).map(r => r.c);
    const places = new Set((await db.all(`
      SELECT DISTINCT LOWER(TRIM(a.place)) p FROM live.awards a JOIN live.events e ON e.id = a.event_id
      WHERE e.org_id = ? AND a.place IS NOT NULL`, [orgId])).map(r => r.p));
    const cats = new Set((await db.all(`
      SELECT DISTINCT a.category c FROM live.awards a JOIN live.events e ON e.id = a.event_id
      WHERE e.org_id = ? AND a.category IS NOT NULL`, [orgId])).map(r => r.c));
    const q = (arr, f) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0;
    const b = { nEvents: counts.length, p10: q(counts, 0.1), p90: q(counts, 0.9), places, cats };
    baselines.set(orgId, b);
    return b;
  }

  for (const ev of affected) {
    const b = await baseline(ev.org_id);
    const rows = await db.all(`
      SELECT a.id, a.place, a.category, a.award_type, a.performance_name, a.studio_id, s.name AS studio_name
      FROM awards a LEFT JOIN studios s ON s.id = a.studio_id
      WHERE a.event_id = ? AND a.id > ?`, [ev.id, maxLive.award]);

    const flags = [];  // {level, msg}
    const flag = (level, msg) => flags.push({ level, msg });

    // Volume vs org history (only with enough history, only for new events)
    if (!ev.pre_existing && b.nEvents >= 10) {
      if (rows.length < 3) flag('red', `only ${rows.length} awards`);
      else if (rows.length > b.p90 * 5) flag('red', `${rows.length} awards — >5x the org's p90 (${b.p90})`);
      else if (rows.length > b.p90 * 2 || rows.length < Math.max(3, Math.floor(b.p10 / 2)))
        flag('amber', `${rows.length} awards vs org p10-p90 range ${b.p10}-${b.p90}`);
    }

    // Idempotency break: existing event suddenly re-gains a large share
    if (ev.pre_existing && ev.prior_rows > 20) {
      const ratio = ev.new_rows / ev.prior_rows;
      if (ratio > 0.5) flag('red', `existing event re-gained ${ev.new_rows} rows (${fmtPct(ratio)} of its ${ev.prior_rows}) — likely idempotency break`);
      else if (ratio > 0.2) flag('amber', `existing event gained ${ev.new_rows} rows (${fmtPct(ratio)})`);
    }

    // Place vocabulary
    if (b.places.size >= 5) {
      const withPlace = rows.filter(r => r.place != null);
      const known = withPlace.filter(r => b.places.has(String(r.place).trim().toLowerCase())).length;
      const frac = pct(known, withPlace.length || 1);
      if (withPlace.length >= 5 && frac < 0.4) flag('red', `only ${fmtPct(frac)} of place values match the org's known vocabulary`);
      else if (withPlace.length >= 5 && frac < 0.75) flag('amber', `${fmtPct(frac)} of place values match known vocabulary`);
    }

    // Category novelty
    if (b.cats.size >= 10) {
      const withCat = rows.filter(r => r.category);
      const novel = withCat.filter(r => !b.cats.has(r.category)).length;
      const frac = pct(novel, withCat.length || 1);
      if (withCat.length >= 5 && frac > 0.8) flag('red', `${fmtPct(frac)} of categories are new to this org`);
      else if (withCat.length >= 5 && frac > 0.4) flag('amber', `${fmtPct(frac)} of categories are new to this org`);
    }

    // Studio novelty + junk shapes
    const studios = new Map();
    for (const r of rows) if (r.studio_id) studios.set(r.studio_id, r.studio_name);
    const newStudios = [...studios.keys()].filter(id => id > maxLive.studio);
    const nsFrac = pct(newStudios.length, studios.size || 1);
    if (studios.size >= 5 && nsFrac > 0.8) flag('red', `${fmtPct(nsFrac)} of studios (${newStudios.length}/${studios.size}) are brand-new records`);
    else if (studios.size >= 5 && nsFrac > 0.5) flag('amber', `${fmtPct(nsFrac)} of studios are brand-new records`);

    const junkStudios = [...studios.values()].filter(isJunkName);
    const jFrac = pct(junkStudios.length, studios.size || 1);
    if (jFrac > 0.05) flag('red', `junk-shaped studio names (${junkStudios.length}/${studios.size}), e.g. ${JSON.stringify(junkStudios.slice(0, 3))}`);
    else if (junkStudios.length > 0) flag('amber', `${junkStudios.length} junk-shaped studio name(s), e.g. ${JSON.stringify(junkStudios.slice(0, 3))}`);

    // New dancers with junk names (where linked)
    const junkDancers = await db.all(`
      SELECT DISTINCT d.name FROM award_dancers ad
      JOIN awards a ON a.id = ad.award_id JOIN dancers d ON d.id = ad.dancer_id
      WHERE a.event_id = ? AND a.id > ? AND d.id > ?`, [ev.id, maxLive.award, maxLive.dancer]);
    const badDancers = junkDancers.map(r => r.name).filter(isJunkName);
    if (badDancers.length && pct(badDancers.length, junkDancers.length) > 0.1)
      flag('red', `junk-shaped dancer names (${badDancers.length}/${junkDancers.length}), e.g. ${JSON.stringify(badDancers.slice(0, 3))}`);

    const verdict = flags.some(f => f.level === 'red') ? 'red' : flags.some(f => f.level === 'amber') ? 'amber' : 'green';
    if (verdict === 'red') out.overall = 'red';
    else if (verdict === 'amber' && out.overall !== 'red') out.overall = 'amber';

    out.events.push({
      id: ev.id, name: ev.name, year: ev.year, org: ev.org_slug,
      pre_existing: !!ev.pre_existing, new_rows: rows.length, verdict,
      flags: flags.map(f => `${f.level}: ${f.msg}`)
    });

    const icon = { green: '🟢', amber: '🟡', red: '🔴' }[verdict];
    md.push(`## ${icon} [${ev.org_slug || '?'}] ${ev.name} (${ev.year}) — ${rows.length} new rows${ev.pre_existing ? ` on existing event (${ev.prior_rows} prior)` : ''}`);
    for (const f of flags) md.push(`- **${f.level}**: ${f.msg}`);
    const sampleN = verdict === 'green' ? 3 : 8;
    md.push('', '| place | category | award_type | routine | studio |', '|---|---|---|---|---|');
    for (const r of rows.slice(0, sampleN)) {
      const c = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\t/g, '⇥').slice(0, 40);
      md.push(`| ${c(r.place)} | ${c(r.category)} | ${c(r.award_type)} | ${c(r.performance_name)} | ${c(r.studio_name)} |`);
    }
    md.push('');
  }

  const counts = { green: 0, amber: 0, red: 0 };
  out.events.forEach(e => counts[e.verdict]++);
  md.splice(1, 0, `**Overall: ${out.overall.toUpperCase()}** — ${out.events.length} affected events (${counts.green} green / ${counts.amber} amber / ${counts.red} red)`, '');

  fs.writeFileSync(reportPath, md.join('\n'));
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 1));
  console.log(`Verdict: ${out.overall.toUpperCase()} (${counts.green}g/${counts.amber}a/${counts.red}r across ${out.events.length} events)`);
  console.log(`Report: ${reportPath}`);
  process.exit(out.overall === 'green' ? 0 : out.overall === 'amber' ? 3 : 4);
}

main().catch(e => { console.error(e); process.exit(1); });
