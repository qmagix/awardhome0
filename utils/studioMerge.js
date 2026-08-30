const { sendEmail } = require('./mailer');
const { BASE_URL } = require('../config');

// Owner-initiated merges are requests, never direct writes: absorbing another
// studio's awards is exactly the rogue-studio attack surface, so a human
// reviews every one. Admin tools call mergeStudios() directly.

// Defensive create (same pattern as other post-migration tables) so the
// feature works before `node database.js` runs.
async function ensureMergeRequestTable(db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS studio_merge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_studio_id INTEGER NOT NULL REFERENCES studios(id),
      source_studio_id INTEGER NOT NULL REFERENCES studios(id),
      requested_by INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      decided_by INTEGER REFERENCES users(id)
    )
  `);
}

// The one true merge: awards move with traceability, dancer links transfer
// (or collapse into existing ones), source survives as status='merged'.
async function mergeStudios(db, sourceId, targetId) {
  await db.run('BEGIN TRANSACTION');
  try {
    await db.run(`UPDATE awards SET studio_id = ?, merged_from_studio_id = ? WHERE studio_id = ?`, [targetId, sourceId, sourceId]);

    const links = await db.all(`SELECT dancer_id FROM dancer_studios WHERE studio_id = ?`, [sourceId]);
    for (const link of links) {
      const exists = await db.get(`SELECT id FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, targetId]);
      if (!exists) {
        await db.run(`UPDATE dancer_studios SET studio_id = ? WHERE dancer_id = ? AND studio_id = ?`, [targetId, link.dancer_id, sourceId]);
      } else {
        await db.run(`DELETE FROM dancer_studios WHERE dancer_id = ? AND studio_id = ?`, [link.dancer_id, sourceId]);
      }
    }

    await db.run(`UPDATE studios SET status = 'merged', merged_into_id = ? WHERE id = ?`, [targetId, sourceId]);
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
}

// Fire-and-forget decision email to the requesting owner.
async function notifyMergeDecision(db, requestId, approved) {
  try {
    const r = await db.get(`
      SELECT mr.id, u.email, t.name AS target_name, t.unique_id AS target_uid, s.name AS source_name
      FROM studio_merge_requests mr
      JOIN users u ON mr.requested_by = u.id
      JOIN studios t ON mr.target_studio_id = t.id
      JOIN studios s ON mr.source_studio_id = s.id
      WHERE mr.id = ?
    `, [requestId]);
    if (!r || !r.email) return;
    const subject = approved
      ? `Merge complete — ${r.source_name}'s awards now live on your page`
      : `Update on your merge request for ${r.source_name}`;
    const html = approved
      ? `<p>Good news — we reviewed your request and merged <strong>${r.source_name}</strong> into <strong>${r.target_name}</strong>. Every award from that record now lives on <a href="${BASE_URL}/dance/studio/${r.target_uid}">your studio page</a>.</p>`
      : `<p>We reviewed your request to merge <strong>${r.source_name}</strong> into <strong>${r.target_name}</strong> and couldn't confirm they're the same studio, so we've left them separate for now. If you have details that show they're one and the same (an old address, a former name), just reply — we're happy to take another look.</p>`;
    const result = await sendEmail({ to: r.email, subject, html });
    if (!result.success) console.error('notifyMergeDecision email failed:', result.error);
  } catch (err) {
    console.error('notifyMergeDecision failed:', err);
  }
}

module.exports = { ensureMergeRequestTable, mergeStudios, notifyMergeDecision };
