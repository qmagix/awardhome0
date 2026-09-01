// Convert shared "independent" rosters into per-dancer synthetic studios
// (mobile design v2 §6.2.1, development plan M1).
//
// WHY THIS RUNS BEFORE FAMILY ENTRY OPENS, NOT AFTER.
// YAGP publishes every unaffiliated entrant in a region on ONE roster —
// `Independent, CA` and 92 siblings, carrying 459 dancers between them. But
// scripts/auto_merge_dancer_profiles.js groups candidates by
// (studio_id, cleaned name). Four same-name pairs already sit on those
// rosters. They have survived only because that script's third condition —
// a shared canonical routine in the same year — is unmet.
//
// Family entry is precisely what supplies routines. So the shared roster is a
// latent conflation of two real children, armed and waiting for the feature
// this migration precedes. Splitting the rosters first defuses it.
//
// WHAT IT DOES, per roster studio R selected by a REVIEWED per-organization
// rule (utils/independents.js — never a regex on "independ": `IndepenDANCE
// Studio` is a real studio):
//
//   * Same-name dancers on R are NOT migrated. Each pair is either one person
//     entered twice or two different children, and only a person can tell.
//     They stay on R and are written to the report for a human.
//   * Every other dancer D gets a synthetic studio named
//     `Independent — <name> (<DNC-unique_id>)` — globally unique, so
//     merge_studio_aliases can never fuse two same-named independents back
//     into one roster — flagged is_independent = 1.
//   * D's roster link moves to it, and so does every award on R that belongs
//     to D alone (junction link or legacy awards.dancer_id).
//   * Awards on R with NO resolved dancer stay on R: a published result is a
//     real fact even when the person cannot be identified (design §6.2.2 —
//     2,294 awards already carry no studio). Awards with SEVERAL linked
//     dancers also stay: that is a genuine cross-independent collaboration,
//     the platform's existing pseudo-studio case, and reassigning it to one
//     dancer would be a lie.
//   * R itself is then flagged is_independent = 1 so the residue never
//     appears in the directory, search, rankings, or featured rotation.
//
// Idempotent: synthetic names are deterministic, so a second run finds the
// studios it made and moves nothing. Transactional per roster.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/migrate_independent_studios.js            # dry run, prints the plan
//   node scripts/migrate_independent_studios.js --apply
const fs = require('fs');
const path = require('path');
const { openDb } = require('../database');
const { generateStudioId } = require('../utils.js');
const { ORG_INDEPENDENT_RULES, classifyRoster, syntheticStudioName } = require('../utils/independents');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'independent_migration.json');

// Roster candidates: every live studio, with the organizations its awards
// come from, so an org rule can only fire on that org's own studios.
async function loadCandidates(db) {
  const rows = await db.all(`
    SELECT s.id, s.name, COALESCE(s.is_independent, 0) AS is_independent,
           (SELECT GROUP_CONCAT(DISTINCT o.name)
              FROM awards a JOIN events e ON e.id = a.event_id
              JOIN organizations o ON o.id = e.org_id
             WHERE a.studio_id = s.id) AS org_names,
           (SELECT COUNT(*) FROM awards a2 WHERE a2.studio_id = s.id) AS award_count,
           (SELECT COUNT(*) FROM dancer_studios ds WHERE ds.studio_id = s.id) AS dancer_count
    FROM studios s
    WHERE COALESCE(s.status, 'active') != 'merged'
  `);
  const out = [];
  for (const r of rows) {
    const orgs = (r.org_names || '').split(',').map(s => s.trim()).filter(Boolean);
    // The org gate exists so one organization's naming convention can never
    // reclassify another's studio. An INERT SHELL — no awards, no dancers —
    // belongs to no organization, so there is nothing to misclassify, and
    // leaving a shared-roster-shaped row live is exactly how the model
    // degenerates back into the thing this migration removes. Judge those on
    // shape alone; everything else still needs its org's own rule to fire.
    const inert = r.award_count === 0 && r.dancer_count === 0;
    const rule = inert
      ? ORG_INDEPENDENT_RULES.find(x => classifyRoster(r.name, [x.org]))
      : classifyRoster(r.name, orgs);
    if (rule) out.push({ ...r, orgs, rule: rule.org });
  }
  return out;
}

// Dancers on a roster, split into migratable and same-name collisions.
async function rosterDancers(db, studioId) {
  const dancers = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.claimed_by_user_id,
           LOWER(TRIM(d.name)) AS cname
    FROM dancer_studios ds JOIN dancers d ON d.id = ds.dancer_id
    WHERE ds.studio_id = ?
    ORDER BY d.id
  `, [studioId]);

  const byName = new Map();
  for (const d of dancers) {
    if (!byName.has(d.cname)) byName.set(d.cname, []);
    byName.get(d.cname).push(d);
  }
  const migratable = [], collisions = [];
  for (const [cname, group] of byName) {
    if (group.length > 1) collisions.push({ cname, dancers: group });
    else migratable.push(group[0]);
  }
  return { migratable, collisions };
}

// Awards on R that belong to exactly this dancer and no one else.
async function soleOwnedAwards(db, studioId, dancerId) {
  return db.all(`
    SELECT a.id
    FROM awards a
    WHERE a.studio_id = ?
      AND (a.dancer_id = ? OR EXISTS (
            SELECT 1 FROM award_dancers ad WHERE ad.award_id = a.id AND ad.dancer_id = ?))
      AND (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) <= 1
      AND NOT EXISTS (
            SELECT 1 FROM award_dancers ad3 WHERE ad3.award_id = a.id AND ad3.dancer_id != ?)
      AND (a.dancer_id IS NULL OR a.dancer_id = ?)
  `, [studioId, dancerId, dancerId, dancerId, dancerId]);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  const candidates = await loadCandidates(db);
  console.log(`Reviewed rules matched ${candidates.length} roster studio(s).`);
  if (!candidates.length) return;

  const report = {
    generated_at: new Date().toISOString(),
    applied: apply,
    rosters: [],
    collisions: [],
    totals: { dancers_migrated: 0, studios_created: 0, awards_moved: 0, collisions: 0, awards_left: 0 },
  };

  for (const roster of candidates) {
    const { migratable, collisions } = await rosterDancers(db, roster.id);
    const entry = {
      roster_id: roster.id, roster_name: roster.name, rule_org: roster.rule,
      dancers: migratable.length, collisions: collisions.length,
      awards_moved: 0, awards_left: 0,
    };

    for (const c of collisions) {
      report.collisions.push({
        roster_id: roster.id,
        roster_name: roster.name,
        name: c.dancers[0].name,
        dancer_ids: c.dancers.map(d => d.id),
        dancer_unique_ids: c.dancers.map(d => d.unique_id),
        resolution: 'HUMAN REQUIRED — one person entered twice, or two different children.',
      });
    }
    report.totals.collisions += collisions.length;

    if (apply) await db.run('BEGIN IMMEDIATE');
    try {
      for (const d of migratable) {
        const name = syntheticStudioName(d.name, d.unique_id);
        let synth = await db.get('SELECT id FROM studios WHERE name = ?', [name]);

        if (!synth) {
          if (apply) {
            const res = await db.run(
              `INSERT INTO studios (unique_id, name, status, is_independent, needs_investigation)
               VALUES (?, ?, 'active', 1, 0)`,
              [generateStudioId(name), name]);
            synth = { id: res.lastID };
          } else {
            synth = { id: null };
          }
          report.totals.studios_created++;
        } else if (apply) {
          await db.run('UPDATE studios SET is_independent = 1 WHERE id = ?', [synth.id]);
        }

        const awards = await soleOwnedAwards(db, roster.id, d.id);
        entry.awards_moved += awards.length;
        report.totals.awards_moved += awards.length;

        if (apply) {
          // Roster link moves. INSERT-then-DELETE rather than UPDATE: the
          // UNIQUE(dancer_id, studio_id) index would reject an UPDATE onto a
          // link a previous run already made.
          await db.run(
            `INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status, headshot_url,
                                                   graduation_year, notes, created_at, source, label)
             SELECT dancer_id, ?, status, headshot_url, graduation_year, notes, created_at, source, label
             FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`,
            [synth.id, d.id, roster.id]);
          await db.run('DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?', [d.id, roster.id]);
          for (const a of awards) {
            await db.run('UPDATE awards SET studio_id = ? WHERE id = ?', [synth.id, a.id]);
          }
        }
        report.totals.dancers_migrated++;
      }

      const left = await db.get('SELECT COUNT(*) AS n FROM awards WHERE studio_id = ?', [roster.id]);
      // On a dry run nothing moved yet, so subtract what a real run would take.
      entry.awards_left = (left ? left.n : 0) - (apply ? 0 : entry.awards_moved);
      report.totals.awards_left += entry.awards_left;

      // The residue — unresolved-dancer awards, collaborations, and any
      // colliding dancers awaiting a human — stays on the roster, which must
      // itself disappear from studio-facing surfaces.
      if (apply) await db.run('UPDATE studios SET is_independent = 1 WHERE id = ?', [roster.id]);

      if (apply) await db.run('COMMIT');
    } catch (err) {
      if (apply) await db.run('ROLLBACK').catch(() => {});
      console.error(`FAILED on roster ${roster.id} (${roster.name}):`, err.message);
      throw err;
    }

    report.rosters.push(entry);
    console.log(`  ${roster.name}: ${entry.dancers} dancer(s), ${entry.awards_moved} award(s) moved, ` +
      `${entry.awards_left} left on the roster, ${entry.collisions} collision(s)`);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`  dancers migrated : ${report.totals.dancers_migrated}`);
  console.log(`  studios created  : ${report.totals.studios_created}`);
  console.log(`  awards moved     : ${report.totals.awards_moved}`);
  console.log(`  awards left      : ${report.totals.awards_left} (unresolved dancer, or a collaboration)`);
  console.log(`  SAME-NAME PAIRS  : ${report.totals.collisions} — route each to a human`);
  for (const c of report.collisions) {
    console.log(`     ${c.roster_name}: "${c.name}" -> dancers ${c.dancer_ids.join(', ')}`);
  }
  console.log(`\nReport: ${path.relative(process.cwd(), REPORT_PATH)}`);
  console.log(apply ? 'APPLIED.' : 'Dry run — re-run with --apply to write.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
