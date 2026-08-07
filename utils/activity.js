const { openDb } = require('../database');

// Fire-and-forget studio activity logging. Never throws — a logging failure
// must not break the user-facing action that triggered it.
//
// dedupMinutes: skip the insert if the same (studio, action) was already
// logged within the window. Used for high-volume signals (widget renders)
// and once-a-day-is-enough signals (profile edits) so activity volume,
// not raw request volume, is what gets scored.
async function logStudioActivity(studioId, action, { dedupMinutes = 0 } = {}) {
  try {
    if (!studioId) return;
    const db = await openDb();
    if (dedupMinutes > 0) {
      const recent = await db.get(
        `SELECT id FROM studio_activity
         WHERE studio_id = ? AND action = ?
           AND created_at > datetime('now', ?)
         LIMIT 1`,
        [studioId, action, `-${dedupMinutes} minutes`]
      );
      if (recent) return;
    }
    await db.run(
      'INSERT INTO studio_activity (studio_id, action) VALUES (?, ?)',
      [studioId, action]
    );
  } catch (err) {
    console.error('logStudioActivity failed:', err.message);
  }
}

module.exports = { logStudioActivity };
