const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { runBackfillForEvent } = require('./backfill_utils');

const db = new sqlite3.Database('./database.sqlite');
db.all = promisify(db.all.bind(db));
db.get = promisify(db.get.bind(db));
db.run = promisify(db.run.bind(db));

async function main() {
  const args = process.argv.slice(2);
  let eventIds = [];

  if (args.length > 0) {
    eventIds = args;
  } else {
    // If no specific event is passed, backfill ALL events
    console.log("No specific event ID passed. Running backfill on ALL events...");
    const events = await db.all('SELECT id FROM events');
    eventIds = events.map(e => e.id);
  }

  console.log(`Starting backfill on ${eventIds.length} event(s)...`);

  let totalBackfilled = 0;
  for (const eventId of eventIds) {
    try {
      const count = await runBackfillForEvent(db, eventId);
      if (count > 0) {
        console.log(`Event ID ${eventId}: Successfully backfilled ${count} dancer records.`);
      }
      totalBackfilled += count;
    } catch (err) {
      console.error(`Error running backfill for Event ID ${eventId}:`, err);
    }
  }

  console.log(`\nBackfill complete! Total dancer mappings added: ${totalBackfilled}`);
  db.close();
}

main().catch(err => {
  console.error("Fatal Error:", err);
  db.close();
});
