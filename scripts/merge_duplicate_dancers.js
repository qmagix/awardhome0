// Merge duplicate dancer profiles that a human has adjudicated.
//
// WHY THIS EXISTS RATHER THAN THE ADMIN BUTTON.
// POST /api/merge/dancers moves three tables — awards.dancer_id,
// award_dancers, dancer_studios — and runs outside a transaction. Ten tables
// carry a dancer_id today, so the button would orphan rows in the other seven
// (claims, acknowledgements, card photos, consents, tombstones, hidden cards,
// corrections) and a mid-flight failure would leave a half-merged dancer.
// It also deletes the source with no check that the two records are even the
// same person, so one mistyped id destroys an unrelated child's profile.
//
// This script fixes all three: every table moves, each merge is one
// transaction, and a merge is REFUSED unless both records carry the same
// normalised name.
//
// WHERE THE DECISIONS COME FROM.
// The independent-studio migration (scripts/migrate_independent_studios.js)
// deliberately refuses to migrate same-name dancers sharing a roster: each
// pair is either one child entered twice or two different children, and only
// a person can tell. It writes them to reports/independent_migration.json for
// a human. MERGES below is that human's answer, with the evidence recorded.
//
// Idempotent: a merge whose source is already gone is reported and skipped, so
// the identical run on local and prod is how parity is reached (never a DB
// copy). Re-run scripts/migrate_independent_studios.js --apply afterwards to
// move each survivor onto its own synthetic studio.
//
// Usage (repo root):
//   node scripts/merge_duplicate_dancers.js            # dry run, prints the plan
//   node scripts/merge_duplicate_dancers.js --apply
const { openDb } = require('../database');

// source is DELETED, target survives. Decided 2026-09-02.
//
// All four are YAGP, which publishes one result at several tiers — a podium
// placement plus the Top 6/12/24 lists — as separate rows. Where two records
// hold nested tiers of the SAME event and category, they are one dancer whose
// tiers the importer name-matched to different profiles.
const MERGES = [
  {
    source: 12491, target: 12484, name: 'Relinda Kozol',
    why: 'YAGP 2022 US & Canada Virtual, Pre-Competitive Contemporary: target holds ' +
         '1ST PLACE, source holds TOP 6. A 1st place is inside the top 6 — one result.',
  },
  {
    source: 37142, target: 37138, name: 'Diane Doberstein',
    why: 'YAGP 2023 Los Angeles February 2, Junior Classical: target holds 2ND PLACE (TIE), ' +
         'source holds TOP 12 and TOP 24. Perfectly nested — one result.',
  },
  {
    source: 14003, target: 61683, name: 'Takdanai McLeod-Smith',
    why: 'No shared event, so judgment not proof: the name is effectively unique worldwide, ' +
         'both records are Australia and Senior, and 2022 -> 2024/25 is a valid progression ' +
         'inside Senior (15-19). The Mcleod/McLeod spelling split is the duplicate signature.',
  },
];

// Every table carrying a dancer_id. UPDATE OR IGNORE then DELETE handles the
// ones with a UNIQUE constraint (award_dancers, dancer_studios): rows that
// would collide with one the target already has are left behind by the update
// and removed by the delete, so the target keeps its own copy.
const DANCER_TABLES = [
  'awards', 'award_dancers', 'dancer_studios', 'dancer_claims',
  'award_acknowledgements', 'award_card_photos', 'card_photo_consents',
  'award_dancer_removals', 'dancer_card_hidden', 'award_corrections',
];

// Profile fields worth rescuing from the record being deleted: only ever
// filled in where the survivor has nothing, never overwritten.
const CARRY_FIELDS = ['birthday', 'headshot_url', 'graduation_year', 'instagram_handle',
  'tiktok_handle', 'vanity_tag', 'card_photo_url'];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function tableExists(db, name) {
  const r = await db.get("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?", [name]);
  return !!r;
}

async function awardCount(db, dancerId) {
  const r = await db.get(
    `SELECT (SELECT COUNT(*) FROM award_dancers WHERE dancer_id = ?) +
            (SELECT COUNT(*) FROM awards WHERE dancer_id = ?) AS n`, [dancerId, dancerId]);
  return r ? r.n : 0;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();
  let merged = 0, skipped = 0, refused = 0;

  for (const m of MERGES) {
    const src = await db.get('SELECT * FROM dancers WHERE id = ?', [m.source]);
    const tgt = await db.get('SELECT * FROM dancers WHERE id = ?', [m.target]);

    if (!src && tgt) {
      console.log(`SKIP    ${m.name}: source ${m.source} is already gone — merged on a previous run.`);
      skipped++;
      continue;
    }
    if (!src || !tgt) {
      console.log(`REFUSE  ${m.name}: source=${src ? 'ok' : 'MISSING'} target=${tgt ? 'ok' : 'MISSING'} — nothing done.`);
      refused++;
      continue;
    }
    // The guard that the admin button lacks: never delete a record that is not
    // demonstrably the same person as the one absorbing it.
    if (norm(src.name) !== norm(tgt.name)) {
      console.log(`REFUSE  ${m.name}: names differ — "${src.name}" vs "${tgt.name}". Nothing done.`);
      refused++;
      continue;
    }

    const before = { src: await awardCount(db, m.source), tgt: await awardCount(db, m.target) };
    console.log(`\n${apply ? 'MERGE' : 'PLAN '}   ${m.name}: ${m.source} -> ${m.target}`);
    console.log(`        ${m.why}`);
    console.log(`        award links: source ${before.src}, target ${before.tgt}`);

    if (!apply) { merged++; continue; }

    await db.run('BEGIN IMMEDIATE');
    try {
      for (const t of DANCER_TABLES) {
        if (!await tableExists(db, t)) continue;
        await db.run(`UPDATE OR IGNORE ${t} SET dancer_id = ? WHERE dancer_id = ?`, [m.target, m.source]);
        await db.run(`DELETE FROM ${t} WHERE dancer_id = ?`, [m.source]);
      }
      for (const f of CARRY_FIELDS) {
        if (src[f] != null && src[f] !== '' && (tgt[f] == null || tgt[f] === '')) {
          await db.run(`UPDATE dancers SET ${f} = ? WHERE id = ?`, [src[f], m.target]);
        }
      }
      await db.run('DELETE FROM dancers WHERE id = ?', [m.source]);
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK').catch(() => {});
      console.error(`        FAILED — rolled back: ${err.message}`);
      throw err;
    }

    const after = await awardCount(db, m.target);
    console.log(`        done: target now holds ${after} award link(s) ` +
                `(expected <= ${before.src + before.tgt}; duplicates fold)`);
    merged++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  merged  : ${merged}`);
  console.log(`  skipped : ${skipped} (already merged)`);
  console.log(`  refused : ${refused}`);
  console.log(apply
    ? '\nAPPLIED. Re-run scripts/migrate_independent_studios.js --apply to move each\nsurvivor onto its own synthetic studio.'
    : '\nDry run — re-run with --apply to write.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
