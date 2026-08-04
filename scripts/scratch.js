const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function test() {
  const db = await open({ filename: 'database.sqlite', driver: sqlite3.Database });
  const row = await db.get(`SELECT COUNT(*) as count FROM (SELECT studio_id FROM awards GROUP BY studio_id HAVING COUNT(*) > 15)`);
  console.log('Result:', row);
}
test();
