// Strip the level & age suffix that Ultra's scholarship tables publish inside
// the dancer cell, so the platform stops calling people things like
// "Ava Pracanica - Competitive Plus 8".
//
// NOT a scraper misread. Ultra's own column header reads "Dancer - Level &
// Age" and the cell genuinely contains "Isabel Jones - Competitive Plus 8" --
// the source documents the format. The bug was on our side: the header
// detection in scrape_ultra_to_txt.js matched on a SUBSTRING, so that variant
// was treated as a plain "Dancer" column and the level+age was stored as part
// of the person's name. The scraper now splits on the header's own contract
// (and keeps the level/age as the category); this repairs the 90 profiles
// already created.
//
// SAFETY: only a suffix that actually looks like an Ultra level is stripped.
// "Ariel Lantz - Loza" is left alone -- that is a name, not a division, and
// there is no way to tell the two apart except by the level vocabulary.
//
// Usage (repo root; identical run on local and prod for data parity):
//   node scripts/repair_ultra_dancer_levels.js           # dry run
//   node scripts/repair_ultra_dancer_levels.js --apply
const { openDb } = require('../database');

// Ultra's published division vocabulary.
const LEVEL_WORDS = ['competitive', 'ultra', 'recreational', 'novice', 'intermediate', 'advanced', 'elite', 'petite', 'junior', 'teen', 'senior', 'mini'];
const looksLikeLevel = (s) => {
  const t = String(s || '').toLowerCase();
  return LEVEL_WORDS.some(w => t.includes(w));
};

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await openDb();

  const rows = await db.all(`
    SELECT DISTINCT d.id, d.name
    FROM dancers d
    JOIN award_dancers ad ON ad.dancer_id = d.id
    JOIN awards a ON a.id = ad.award_id
    JOIN events e ON e.id = a.event_id
    JOIN organizations o ON o.id = e.org_id
    WHERE o.slug = 'ultra' AND d.name LIKE '% - %'`);

  const merges = [], renames = [], skipped = [];
  for (const r of rows) {
    const m = r.name.match(/^(.*?)\s+[-–]\s+(.+)$/);
    if (!m) { skipped.push({ ...r, why: 'no separator' }); continue; }
    const clean = m[1].trim(), suffix = m[2].trim();
    if (!looksLikeLevel(suffix)) { skipped.push({ ...r, why: `suffix "${suffix}" is not a level` }); continue; }
    const target = await db.get(
      'SELECT id, name FROM dancers WHERE LOWER(name) = LOWER(?) AND id <> ? ORDER BY id LIMIT 1', [clean, r.id]);
    if (target) merges.push({ ...r, clean, target });
    else renames.push({ ...r, clean });
  }

  console.log(`Ultra dancers carrying a "- Level & Age" suffix: ${rows.length}`);
  console.log(`  MERGE into the existing clean-named profile: ${merges.length}`);
  console.log(`  RENAME in place (no existing profile):       ${renames.length}`);
  console.log(`  SKIPPED (suffix is not a level):             ${skipped.length}`);
  merges.slice(0, 5).forEach(x => console.log(`    #${x.id} "${x.name}" -> merge into #${x.target.id} "${x.target.name}"`));
  renames.slice(0, 5).forEach(x => console.log(`    #${x.id} "${x.name}" -> rename "${x.clean}"`));
  skipped.forEach(x => console.log(`    KEPT #${x.id} "${x.name}" (${x.why})`));

  if (!apply) { console.log('\nDry run — re-run with --apply to write.'); return; }
  if (!merges.length && !renames.length) { console.log('\nNothing to do.'); return; }

  await db.run('BEGIN IMMEDIATE');
  try {
    for (const x of merges) {
      // move links, honouring tombstones and the UNIQUE(award_id, dancer_id)
      const links = await db.all('SELECT award_id FROM award_dancers WHERE dancer_id = ?', [x.id]);
      for (const l of links) {
        const denied = await db.get(
          'SELECT 1 AS x FROM award_dancer_removals WHERE award_id = ? AND dancer_id = ?', [l.award_id, x.target.id]);
        if (!denied) {
          await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id, source) VALUES (?, ?, ?)',
            [l.award_id, x.target.id, 'backfill']);
        }
      }
      await db.run('DELETE FROM award_dancers WHERE dancer_id = ?', [x.id]);
      const studios = await db.all('SELECT studio_id FROM dancer_studios WHERE dancer_id = ?', [x.id]);
      for (const s of studios) {
        await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id, status) VALUES (?, ?, ?)',
          [x.target.id, s.studio_id, 'active']);
      }
      await db.run('DELETE FROM dancer_studios WHERE dancer_id = ?', [x.id]);
      await db.run('UPDATE awards SET dancer_id = ? WHERE dancer_id = ?', [x.target.id, x.id]);
      await db.run('DELETE FROM dancers WHERE id = ?', [x.id]);
    }
    for (const x of renames) {
      await db.run('UPDATE dancers SET name = ? WHERE id = ?', [x.clean, x.id]);
    }
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
  console.log(`\n✓ APPLIED: ${merges.length} merged, ${renames.length} renamed, ${skipped.length} left alone.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
