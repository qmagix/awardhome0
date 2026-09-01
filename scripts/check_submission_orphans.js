// Orphan check for the family-submission staging file.
//
// Foreign keys are off platform-wide, and these rows point ACROSS databases
// (submissions.sqlite -> database.sqlite), so nothing could enforce them even
// in principle. This is the promised orphan story: report, never delete.
//
// A family's submission is their record of their own child's award. Silent
// erasure is the one outcome worse than a dangling row, so this script only
// ever prints — a human decides what to do with what it finds.
//
// Read paths already tolerate orphans (utils/submissions.js drops rows whose
// canonical event has vanished), and promotion re-resolves every id at
// decision time. This exists so a growing orphan count is VISIBLE rather than
// discovered later as a mystery.
//
// Usage (repo root):
//   node scripts/check_submission_orphans.js
//   node scripts/check_submission_orphans.js --json
const { openDb } = require('../database');
const { openSubmissionsDb } = require('../utils/submissionsDb');

// Which of these canonical ids no longer exist? One query per table rather
// than per row: the staging file is small, but this runs weekly forever.
async function missingIds(db, table, ids) {
  const wanted = [...new Set(ids.filter(v => v != null))];
  if (!wanted.length) return new Set();
  const found = new Set();
  const CHUNK = 500;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const slice = wanted.slice(i, i + CHUNK);
    const rows = await db.all(
      `SELECT id FROM ${table} WHERE id IN (${slice.map(() => '?').join(',')})`, slice);
    rows.forEach(r => found.add(r.id));
  }
  return new Set(wanted.filter(id => !found.has(id)));
}

async function main() {
  const asJson = process.argv.includes('--json');
  const db = await openDb();
  const sdb = await openSubmissionsDb();

  const subs = await sdb.all(
    'SELECT id, user_id, dancer_id, studio_id, event_id, award_id, status FROM award_submissions');

  const gone = {
    users: await missingIds(db, 'users', subs.map(s => s.user_id)),
    dancers: await missingIds(db, 'dancers', subs.map(s => s.dancer_id)),
    studios: await missingIds(db, 'studios', subs.map(s => s.studio_id)),
    events: await missingIds(db, 'events', subs.map(s => s.event_id)),
    awards: await missingIds(db, 'awards', subs.map(s => s.award_id)),
  };

  const orphans = [];
  for (const s of subs) {
    const reasons = [];
    if (gone.users.has(s.user_id)) reasons.push('submitting user deleted');
    if (gone.dancers.has(s.dancer_id)) reasons.push('dancer deleted');
    if (s.studio_id && gone.studios.has(s.studio_id)) reasons.push('studio deleted');
    if (s.event_id && gone.events.has(s.event_id)) reasons.push('event deleted');
    if (s.award_id && gone.awards.has(s.award_id)) reasons.push('promoted award deleted');
    if (reasons.length) orphans.push({ submission_id: s.id, status: s.status, reasons });
  }

  // Child rows whose parent submission is gone. Nothing deletes submissions
  // today, so a hit here means something wrote outside the service layer.
  const childOrphans = {
    cast: (await sdb.all(`SELECT COUNT(*) AS n FROM award_submission_dancers
      WHERE submission_id NOT IN (SELECT id FROM award_submissions)`))[0].n,
    evidence: (await sdb.all(`SELECT COUNT(*) AS n FROM award_submission_evidence
      WHERE submission_id NOT IN (SELECT id FROM award_submissions)`))[0].n,
  };

  // Provenance lives in the canonical DB and points at awards; a dangling row
  // is never selected, but a rising count means awards are being deleted.
  const provOrphans = (await db.get(
    'SELECT COUNT(*) AS n FROM award_provenance WHERE award_id NOT IN (SELECT id FROM awards)')).n;

  if (asJson) {
    console.log(JSON.stringify({ submissions: subs.length, orphans, childOrphans, provOrphans }, null, 2));
  } else {
    console.log(`submissions scanned : ${subs.length}`);
    console.log(`orphaned submissions: ${orphans.length}`);
    for (const o of orphans) console.log(`  #${o.submission_id} (${o.status}) — ${o.reasons.join(', ')}`);
    console.log(`orphaned cast rows  : ${childOrphans.cast}`);
    console.log(`orphaned evidence   : ${childOrphans.evidence}`);
    console.log(`orphaned provenance : ${provOrphans}`);
    console.log(orphans.length || childOrphans.cast || childOrphans.evidence || provOrphans
      ? '\nNothing was deleted. Review each above and decide.'
      : '\nClean.');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
