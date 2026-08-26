// Seed/refresh the Upcoming Events Directory from a reviewable pipe file.
// Usage: node scripts/import_upcoming_txt.js [file] [--apply]
//   file defaults to scripts/seed/upcoming_events_2026.txt (committed, so
//   the same run works identically on local and prod — the parity rule).
//
// Line format (matches the research handoff format; # comments allowed):
//   OrgName | Event/Stop Name | City | ST | Venue | YYYY-MM-DD | YYYY-MM-DD | RegistrationURL | SourceURL
//
// Idempotency key: org_id + start_date + city (case-insensitive). Existing
// 'seed'/'scraped' rows are updated in place; rows entered by owners
// (source 'owner') are NEVER touched — the dashboard is authoritative.
const path = require('path');
const fs = require('fs');
const { openDb } = require(path.join(__dirname, '..', 'database'));
const { ensureUpcomingTable } = require(path.join(__dirname, '..', 'utils', 'upcoming'));

const APPLY = process.argv.includes('--apply');
const fileArg = process.argv.slice(2).find(a => !a.startsWith('--'));
const FILE = fileArg
  ? path.resolve(fileArg)
  : path.join(__dirname, 'seed', 'upcoming_events_2026.txt');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const db = await openDb();
  await ensureUpcomingTable(db);

  const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);
  const orgs = await db.all('SELECT id, name FROM organizations');
  const orgByName = new Map(orgs.map(o => [o.name.toLowerCase(), o.id]));

  let inserted = 0, updated = 0, unchanged = 0, skippedOwner = 0;
  const problems = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 6) { problems.push(`line ${i + 1}: expected ≥6 fields, got ${parts.length}`); continue; }
    const [orgName, name, city, state, venue, start, end = '', regUrl = '', sourceUrl = ''] = parts;

    const orgId = orgByName.get(orgName.toLowerCase());
    if (!orgId) { problems.push(`line ${i + 1}: unknown org "${orgName}"`); continue; }
    if (!name) { problems.push(`line ${i + 1}: missing event name`); continue; }
    if (!ISO.test(start)) { problems.push(`line ${i + 1}: bad start date "${start}"`); continue; }
    if (end && !ISO.test(end)) { problems.push(`line ${i + 1}: bad end date "${end}"`); continue; }
    if (state && !/^[A-Z]{2}$/i.test(state)) { problems.push(`line ${i + 1}: bad state "${state}"`); continue; }

    const existing = await db.get(`
      SELECT * FROM org_upcoming_events
      WHERE org_id = ? AND start_date = ? AND LOWER(COALESCE(city, '')) = LOWER(?)
    `, [orgId, start, city]);

    if (existing && existing.source === 'owner') { skippedOwner++; continue; }

    if (!existing) {
      inserted++;
      if (APPLY) {
        await db.run(`
          INSERT INTO org_upcoming_events (org_id, name, city, state, venue, start_date, end_date, registration_url, source, source_url, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?, CURRENT_TIMESTAMP)
        `, [orgId, name, city || null, state.toUpperCase() || null, venue || null, start, end || null, regUrl || null, sourceUrl || null]);
      }
    } else {
      const same = existing.name === name && (existing.venue || '') === venue &&
        (existing.end_date || '') === end && (existing.registration_url || '') === regUrl &&
        (existing.state || '') === state.toUpperCase();
      if (same) {
        unchanged++;
        if (APPLY) await db.run('UPDATE org_upcoming_events SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);
      } else {
        updated++;
        if (APPLY) {
          await db.run(`
            UPDATE org_upcoming_events
            SET name = ?, state = ?, venue = ?, end_date = ?, registration_url = ?, source_url = ?,
                updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [name, state.toUpperCase() || null, venue || null, end || null, regUrl || null, sourceUrl || null, existing.id]);
        }
      }
    }
  }

  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — ${path.basename(FILE)}`);
  console.log(`  insert: ${inserted}  update: ${updated}  unchanged: ${unchanged}  owner-protected: ${skippedOwner}`);
  if (problems.length) {
    console.log(`  problems (${problems.length}):`);
    problems.forEach(p => console.log(`    - ${p}`));
    process.exitCode = 1;
  }
  if (!APPLY) console.log('  re-run with --apply to write.');
}

main().catch(err => { console.error(err); process.exit(1); });
