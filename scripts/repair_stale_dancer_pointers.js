// awards.dancer_id pointing at a DELETED dancer makes an award look credited
// while showing no name — worse than an obviously-uncredited award, because
// it never surfaces in Check Routine Dancers. (Cause: historic delete paths
// that didn't repoint the legacy column; today's merge tools all do.)
// Nulling the pointer restores the honest "missing dancer" state, so the
// routine re-enters the check queue and an owner (or a re-import from the
// org's source files) can supply the name.
//
// Usage: node scripts/repair_stale_dancer_pointers.js [--apply]
const { openDb } = require('../database');
(async () => {
  const apply = process.argv.includes('--apply');
  const db = await openDb();
  const rows = await db.all(`
    SELECT a.id, a.dancer_id, a.performance_name, o.slug
    FROM awards a JOIN events e ON e.id = a.event_id
    LEFT JOIN organizations o ON o.id = e.org_id
    WHERE a.dancer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dancers d WHERE d.id = a.dancer_id)`);
  console.log(`Awards pointing at deleted dancers: ${rows.length}`);
  const byOrg = {};
  for (const r of rows) byOrg[r.slug] = (byOrg[r.slug] || 0) + 1;
  for (const [k, v] of Object.entries(byOrg)) console.log(`   ${String(v).padStart(4)}  ${k}`);
  if (!apply) { console.log('\nDry run — re-run with --apply to clear them.'); return; }
  const r = await db.run(`
    UPDATE awards SET dancer_id = NULL
    WHERE dancer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dancers d WHERE d.id = awards.dancer_id)`);
  console.log(`\nCleared ${r.changes} stale pointers — those routines now show as missing dancers.`);
})().catch(e => { console.error(e); process.exit(1); });
