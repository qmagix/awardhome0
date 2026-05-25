const { openDb, initDb } = require('./database');

async function main() {
  const db = await initDb();
  console.log('Backfilling data_since for organizations...');

  const orgs = await db.all('SELECT id, name FROM organizations');

  for (const org of orgs) {
    const minYearRow = await db.get('SELECT MIN(year) as minYear FROM events WHERE org_id = ?', [org.id]);
    const minYear = minYearRow ? minYearRow.minYear : null;

    if (minYear) {
      await db.run('UPDATE organizations SET data_since = ? WHERE id = ?', [minYear, org.id]);
      console.log(`Updated ${org.name} with data_since = ${minYear}`);
    } else {
      console.log(`No events found for ${org.name}`);
    }
  }

  console.log('Backfill complete!');
  process.exit(0);
}

main().catch(console.error);
