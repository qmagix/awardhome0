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
  // Zixi Yu, decided by Q 2026-09-02: one girl, "registration varies for
  // various reasons". The YAGP half is provable — 37743 (TOP 12 + TOP 24) and
  // 37738 (2ND PLACE TIE) are the same event, division and category, nested.
  // The ADC IBC half is Q's call, not the data's: those two rows name two
  // different schools in two different states, which no evidence here settles.
  // 37738 survives as the widest record (four awards, 2023 Boston + 2024 NY).
  { source: 14553, target: 37738, name: 'Zixi Yu', why: 'YAGP 2022 Boston, Senior Classical. Same girl per Q.' },
  { source: 37743, target: 37738, name: 'Zixi Yu', why: 'YAGP 2023 Boston, Senior Classical TOP 12 + TOP 24 — nested with the survivor\'s 2ND PLACE (TIE) at the same event and category.' },
  // NOT addressed by id. The ADC IBC import ran separately on each machine, so
  // these two rows carry DIFFERENT ids AND DIFFERENT unique_ids on local and
  // prod (prod 321833/321895, local 325181/325243) — id 321833 on local is an
  // unrelated dancer entirely. A natural key is the only safe address here;
  // the same-name guard below caught the id version before it did damage.
  { source: { name: 'Zixi Yu', studio: 'Cary Ballet Conservatory' }, target: 37738, name: 'Zixi Yu',
    why: 'ADC IBC 2022 World Finals, Cary Ballet Conservatory (NC). Q\'s call — the school differs from the NJ records.' },
  { source: { name: 'Zixi Yu', studio: 'Princeton Ballet School' }, target: 37738, name: 'Zixi Yu',
    why: 'ADC IBC 2023 World Finals, Princeton Ballet School (NJ). Q\'s call.' },
];

// A "studio" that is only a dancer's own name is a scraper artifact: the
// results list put her name where a school would go, because she entered
// unaffiliated. That is the independent case, so the awards belong on the
// org's independent roster, where migrate_independent_studios.js can sweep
// them onto her own synthetic studio. Retiring the shell instead of leaving
// it live keeps it out of the directory, search and rankings.
//
// Listed one by one on purpose. There are more of these in the data
// (`Deeta Saravanan, NJ` and others) and a name-shaped rule would eventually
// hit a real studio named after its founder — the same trap utils/independents.js
// avoids by never regexing on "independ".
// Addressed by name, not id, for the reason spelled out above the ADC IBC
// entries: ids are not guaranteed to agree across databases. Studio names are
// globally unique here (merge_studio_aliases enforces it), so a name resolves
// to one row or the run refuses.
const PSEUDO_STUDIOS = [
  {
    name: 'Zixi Yu, NJ', rosterName: 'Independent, NJ',
    why: 'One dancer (Zixi Yu), four of her own YAGP awards, unclaimed, no owner.',
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
  'tiktok_handle', 'vanity_tag', 'card_photo_url',
  // Safety suppression must survive a merge: the awards move to the target,
  // and republishing them would undo a protective action (utils/suppression.js).
  'suppressed_at', 'suppressed_reason', 'suppressed_by'];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function tableExists(db, name) {
  const r = await db.get("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?", [name]);
  return !!r;
}

// A merge endpoint is addressed either by numeric id — safe only where the row
// predates the local/prod split and both sides agree — or by a natural key
// {name, studio}, which is the only address that survives an import that ran
// independently on each machine. A selector that matches anything other than
// exactly one dancer resolves to null and the merge is refused, never guessed.
async function resolveDancer(db, sel) {
  if (typeof sel === 'number') {
    return { row: await db.get('SELECT * FROM dancers WHERE id = ?', [sel]), how: `id ${sel}`, ambiguous: false };
  }
  const rows = await db.all(
    `SELECT d.* FROM dancers d
     JOIN dancer_studios ds ON ds.dancer_id = d.id
     JOIN studios s ON s.id = ds.studio_id
     WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(?)) AND s.name = ?`, [sel.name, sel.studio]);
  const how = `"${sel.name}" @ "${sel.studio}"`;
  if (rows.length !== 1) return { row: null, how, ambiguous: rows.length > 1, count: rows.length };
  return { row: rows[0], how: `${how} -> id ${rows[0].id}`, ambiguous: false };
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
    const s = await resolveDancer(db, m.source);
    const t = await resolveDancer(db, m.target);
    const src = s.row, tgt = t.row;

    if (s.ambiguous) {
      console.log(`REFUSE  ${m.name}: source ${s.how} matches ${s.count} dancers — ambiguous, nothing done.`);
      refused++;
      continue;
    }
    if (!src && tgt) {
      console.log(`SKIP    ${m.name}: source ${s.how} is already gone — merged on a previous run.`);
      skipped++;
      continue;
    }
    if (!src || !tgt) {
      console.log(`REFUSE  ${m.name}: source ${s.how}=${src ? 'ok' : 'MISSING'} target ${t.how}=${tgt ? 'ok' : 'MISSING'} — nothing done.`);
      refused++;
      continue;
    }
    const [srcId, tgtId] = [src.id, tgt.id];
    if (srcId === tgtId) {
      console.log(`SKIP    ${m.name}: source and target both resolve to ${srcId} — already merged.`);
      skipped++;
      continue;
    }
    // The guard that the admin button lacks: never delete a record that is not
    // demonstrably the same person as the one absorbing it.
    if (norm(src.name) !== norm(tgt.name)) {
      console.log(`REFUSE  ${m.name}: names differ — "${src.name}" vs "${tgt.name}". Nothing done.`);
      refused++;
      continue;
    }

    const before = { src: await awardCount(db, srcId), tgt: await awardCount(db, tgtId) };
    console.log(`\n${apply ? 'MERGE' : 'PLAN '}   ${m.name}: ${s.how} -> ${t.how}`);
    console.log(`        ${m.why}`);
    console.log(`        award links: source ${before.src}, target ${before.tgt}`);

    if (!apply) { merged++; continue; }

    await db.run('BEGIN IMMEDIATE');
    try {
      for (const tbl of DANCER_TABLES) {
        if (!await tableExists(db, tbl)) continue;
        await db.run(`UPDATE OR IGNORE ${tbl} SET dancer_id = ? WHERE dancer_id = ?`, [tgtId, srcId]);
        await db.run(`DELETE FROM ${tbl} WHERE dancer_id = ?`, [srcId]);
      }
      for (const f of CARRY_FIELDS) {
        if (src[f] != null && src[f] !== '' && (tgt[f] == null || tgt[f] === '')) {
          await db.run(`UPDATE dancers SET ${f} = ? WHERE id = ?`, [src[f], tgtId]);
        }
      }
      await db.run('DELETE FROM dancers WHERE id = ?', [srcId]);
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK').catch(() => {});
      console.error(`        FAILED — rolled back: ${err.message}`);
      throw err;
    }

    const after = await awardCount(db, tgtId);
    console.log(`        done: target now holds ${after} award link(s) ` +
                `(expected <= ${before.src + before.tgt}; duplicates fold)`);
    merged++;
  }

  let consolidated = 0, studiosSkipped = 0;
  for (const p of PSEUDO_STUDIOS) {
    const stRows = await db.all('SELECT id, name, status FROM studios WHERE name = ?', [p.name]);
    const rosterRows = await db.all('SELECT id, name FROM studios WHERE name = ?', [p.rosterName]);
    if (stRows.length !== 1 || rosterRows.length !== 1) {
      console.log(`\nREFUSE  pseudo-studio "${p.name}": matched ${stRows.length} studio(s) and ` +
                  `${rosterRows.length} roster(s) named "${p.rosterName}" — need exactly one of each.`);
      refused++;
      continue;
    }
    const st = stRows[0], roster = rosterRows[0];
    // Guard against retiring anything that is actually a studio: the whole
    // premise is that this row belongs to exactly one dancer.
    const dancers = await db.all('SELECT DISTINCT dancer_id FROM dancer_studios WHERE studio_id = ?', [st.id]);
    if (dancers.length > 1) {
      console.log(`\nREFUSE  pseudo-studio ${st.id} "${st.name}": ${dancers.length} dancers on it — that is a real roster.`);
      refused++;
      continue;
    }
    const aw = await db.get('SELECT COUNT(*) AS n FROM awards WHERE studio_id = ?', [st.id]);
    if (st.status === 'merged' && aw.n === 0) {
      console.log(`\nSKIP    pseudo-studio ${st.id} "${st.name}": already retired.`);
      studiosSkipped++;
      continue;
    }

    console.log(`\n${apply ? 'RETIRE' : 'PLAN  '}  pseudo-studio ${st.id} "${st.name}" -> roster ${roster.id} "${roster.name}"`);
    console.log(`        ${p.why}`);
    console.log(`        moving ${aw.n} award(s) and ${dancers.length} roster link(s)`);
    if (!apply) { consolidated++; continue; }

    await db.run('BEGIN IMMEDIATE');
    try {
      await db.run('UPDATE awards SET studio_id = ? WHERE studio_id = ?', [roster.id, st.id]);
      await db.run('UPDATE OR IGNORE dancer_studios SET studio_id = ? WHERE studio_id = ?', [roster.id, st.id]);
      await db.run('DELETE FROM dancer_studios WHERE studio_id = ?', [st.id]);
      // Retired, not deleted: awards elsewhere may still carry it in
      // merged_from_studio_id, and 'merged' is the status every studio-facing
      // query already excludes.
      await db.run("UPDATE studios SET status = 'merged', is_independent = 1 WHERE id = ?", [st.id]);
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK').catch(() => {});
      console.error(`        FAILED — rolled back: ${err.message}`);
      throw err;
    }
    console.log('        done');
    consolidated++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  merged  : ${merged}`);
  console.log(`  skipped : ${skipped} (already merged)`);
  console.log(`  pseudo-studios retired : ${consolidated} (${studiosSkipped} already done)`);
  console.log(`  refused : ${refused}`);
  console.log(apply
    ? '\nAPPLIED. Re-run scripts/migrate_independent_studios.js --apply to move each\nsurvivor onto its own synthetic studio.'
    : '\nDry run — re-run with --apply to write.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
