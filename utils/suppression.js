// Safety suppression for dancer profiles.
//
// WHY THIS EXISTS. Competition results are effectively a child's location
// trail — which city, which weekend, which studio they train at. The corpus
// is public source-by-source, but this site's value-add is precisely that it
// assembled the searchable timeline, and a family with a protective order or
// fleeing an abuser may need that timeline gone. No consent framework covers
// this: it is not an opt-out preference (hide_from_search/hide_from_rankings
// are, and families set those themselves), it is a protective action a
// superadmin takes on request.
//
// SEMANTICS. A suppressed dancer is indistinguishable from one that never
// existed on every public surface: profile page (404), search, typeahead,
// rankings, top-dancer lists, guest mobile reads, and the partner API. The
// award ROWS stay — group awards still list their other dancers, studio
// totals don't shift — only the dancer's name/profile stops resolving.
// Admin tools deliberately still see them (a reviewer must be able to find
// the row to unsuppress it), and the owning household keeps its
// authenticated manage/mobile views: suppression protects the family, so it
// must not lock the family out of their own record.
//
// Enforcement is the `notSuppressedSql()` fragment, written inline in each
// public query next to the existing hide_from_* conditions — a fragment
// rather than a query rewriter so surfaces stay readable and greppable
// (same convention as utils/independents.js).
const { openDb } = require('../database');
const { refresh } = require('./cache');

function notSuppressedSql(alias = 'd') {
  return `${alias}.suppressed_at IS NULL`;
}

// The homepage leaderboards serve from the 'dance-home' cache
// stale-while-revalidate; without this nudge a fresh suppression could stay
// on the public leaderboard for the full TTL. refresh (background swap)
// rather than invalidate, per utils/cache.js.
function refreshPublicCaches() {
  refresh('dance-home');
}

async function suppressDancer(dancerId, { reason, adminUserId }) {
  const db = await openDb();
  const dancer = await db.get('SELECT id, suppressed_at FROM dancers WHERE id = ?', [dancerId]);
  if (!dancer) return { ok: false, reason: 'not_found' };
  if (dancer.suppressed_at) return { ok: true, already: true };
  await db.run(
    'UPDATE dancers SET suppressed_at = CURRENT_TIMESTAMP, suppressed_reason = ?, suppressed_by = ? WHERE id = ?',
    [String(reason || '').trim() || null, adminUserId || null, dancerId]);
  refreshPublicCaches();
  return { ok: true };
}

async function unsuppressDancer(dancerId) {
  const db = await openDb();
  const result = await db.run(
    'UPDATE dancers SET suppressed_at = NULL, suppressed_reason = NULL, suppressed_by = NULL WHERE id = ?',
    [dancerId]);
  refreshPublicCaches();
  return { ok: result.changes > 0 };
}

async function listSuppressed() {
  const db = await openDb();
  return db.all(`
    SELECT d.id, d.unique_id, d.name, d.suppressed_at, d.suppressed_reason,
           u.email AS suppressed_by_email,
           (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS award_count
    FROM dancers d LEFT JOIN users u ON u.id = d.suppressed_by
    WHERE d.suppressed_at IS NOT NULL
    ORDER BY d.suppressed_at DESC`);
}

// Merges DELETE the source row. If the source was suppressed and the
// survivor is not, the suppression must ride along — the awards just moved
// onto the survivor, and letting them republish would silently undo a
// protective action nobody decided to undo. Call before the source row is
// deleted; takes the caller's db handle so it joins the merge transaction.
async function carrySuppressionOnMerge(db, sourceId, targetId) {
  await db.run(`
    UPDATE dancers SET
      suppressed_at = (SELECT s.suppressed_at FROM dancers s WHERE s.id = ?1),
      suppressed_reason = (SELECT s.suppressed_reason FROM dancers s WHERE s.id = ?1),
      suppressed_by = (SELECT s.suppressed_by FROM dancers s WHERE s.id = ?1)
    WHERE id = ?2 AND suppressed_at IS NULL
      AND (SELECT s.suppressed_at FROM dancers s WHERE s.id = ?1) IS NOT NULL`,
    [sourceId, targetId]);
}

module.exports = {
  notSuppressedSql, suppressDancer, unsuppressDancer, listSuppressed,
  carrySuppressionOnMerge,
};
