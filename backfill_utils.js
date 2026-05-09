/**
 * Reusable auto-backfill logic for the Dance Awards Platform
 */

async function runBackfillForEvent(db, eventId) {
  let backfilledCount = 0;

  // 1. Find all performance_names + studio combinations that HAVE dancers mapped in this event
  const sourceAwards = await db.all(`
    SELECT DISTINCT a.performance_name, a.studio_id 
    FROM awards a
    JOIN award_dancers ad ON a.id = ad.award_id
    WHERE a.event_id = ? 
      AND a.performance_name IS NOT NULL
      AND a.performance_name != ''
      AND a.studio_id IS NOT NULL
  `, [eventId]);

  for (const source of sourceAwards) {
    // 2. Extract the full list of unique dancer_ids for this routine + studio combo
    const dancers = await db.all(`
      SELECT DISTINCT ad.dancer_id
      FROM award_dancers ad
      JOIN awards a ON ad.award_id = a.id
      WHERE a.event_id = ? 
        AND LOWER(a.performance_name) = LOWER(?) 
        AND a.studio_id = ?
    `, [eventId, source.performance_name, source.studio_id]);

    if (dancers.length === 0) continue;

    // 3. Find ALL awards in the event matching this routine + studio
    // We strictly ignore performance_number to allow fuzzy matching
    const targetAwards = await db.all(`
      SELECT id 
      FROM awards 
      WHERE event_id = ? 
        AND LOWER(performance_name) = LOWER(?) 
        AND studio_id = ?
    `, [eventId, source.performance_name, source.studio_id]);

    // 4. Map the dancers to all matching awards using INSERT OR IGNORE
    for (const target of targetAwards) {
      for (const d of dancers) {
        const result = await db.run(`
          INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) 
          VALUES (?, ?)
        `, [target.id, d.dancer_id]);
        
        if (!result || (result && result.changes > 0)) {
          backfilledCount++;
        }
      }
    }
  }

  // Handle legacy legacy dancer_id column (if any awards still use it)
  const legacyAwards = await db.all(`
    SELECT DISTINCT performance_name, studio_id, dancer_id
    FROM awards
    WHERE event_id = ?
      AND performance_name IS NOT NULL
      AND performance_name != ''
      AND studio_id IS NOT NULL
      AND dancer_id IS NOT NULL
  `, [eventId]);

  for (const legacy of legacyAwards) {
    const targetAwards = await db.all(`
      SELECT id 
      FROM awards 
      WHERE event_id = ? 
        AND LOWER(performance_name) = LOWER(?) 
        AND studio_id = ?
        AND id NOT IN (SELECT award_id FROM award_dancers WHERE dancer_id = ?)
    `, [eventId, legacy.performance_name, legacy.studio_id, legacy.dancer_id]);

    for (const target of targetAwards) {
      const result = await db.run(`
        INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) 
        VALUES (?, ?)
      `, [target.id, legacy.dancer_id]);
      
      if (!result || (result && result.changes > 0)) {
        backfilledCount++;
      }
    }
  }

  return backfilledCount;
}

module.exports = { runBackfillForEvent };
