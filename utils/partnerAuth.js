// Partner API credentials + audit (routes/api/partner.js).
//
// Partners are SERVERS, not phones, so this is deliberately simpler than
// utils/mobileAuth.js: no refresh rotation (that machinery exists to limit
// theft damage on a device), just one long-lived key per partner, shown
// once at issuance, stored only as a SHA-256 hash — the same "a database
// leak must not hand anyone a working credential" rule as password resets
// and mobile sessions. SHA-256 without a work factor is right for a
// 32-byte random value nobody can dictionary-attack.
//
// THE AUDIT LOG IS THE PRODUCT'S CONSCIENCE. Every lookup — who asked,
// what name, which children came back — is written append-only to
// partner_query_log. It is the abuse-detection signal, the quota ledger
// (quota is counted FROM the log, so the ledger cannot drift from the
// truth), and the answer to "who has looked up my child?" — which also
// makes suppression actionable after the fact: if a dancer is suppressed
// later, the log says exactly which partners already fetched the record.
const crypto = require('crypto');
const { openDb } = require('../database');

const DEFAULT_DAILY_QUOTA = parseInt(process.env.PARTNER_DAILY_QUOTA, 10) || 200;

const hashKey = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

// Issue a new key. Returns the RAW key exactly once — it is never stored
// and cannot be recovered; a lost key is revoked and reissued.
async function issueKey({ partnerName, contactEmail, dailyQuota, agreementNote, adminUserId }) {
  const name = String(partnerName || '').trim();
  if (!name) return { ok: false, reason: 'name_required' };
  const raw = 'apk_' + crypto.randomBytes(32).toString('hex');
  const db = await openDb();
  const res = await db.run(
    `INSERT INTO partner_keys (partner_name, contact_email, key_hash, daily_quota, agreement_note, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, String(contactEmail || '').trim() || null, hashKey(raw),
     parseInt(dailyQuota, 10) > 0 ? parseInt(dailyQuota, 10) : DEFAULT_DAILY_QUOTA,
     String(agreementNote || '').trim() || null, adminUserId || null]);
  return { ok: true, keyId: res.lastID, rawKey: raw };
}

async function revokeKey(keyId, reason) {
  const db = await openDb();
  const res = await db.run(
    'UPDATE partner_keys SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
    [String(reason || '').trim() || null, keyId]);
  return { ok: res.changes > 0 };
}

async function listKeys() {
  const db = await openDb();
  return db.all(`
    SELECT k.*, u.email AS created_by_email,
      (SELECT COUNT(*) FROM partner_query_log l WHERE l.key_id = k.id) AS queries_total,
      (SELECT COUNT(*) FROM partner_query_log l WHERE l.key_id = k.id
        AND l.status = 'ok' AND date(l.created_at) = date('now')) AS queries_today,
      -- Billable per the data agreement §9: unique dancer records retrieved
      -- this calendar month (detail endpoint only; searches are free).
      (SELECT COUNT(DISTINCT l.dancer_unique_ids) FROM partner_query_log l
        WHERE l.key_id = k.id AND l.status = 'ok'
          AND l.endpoint = '/dancers/:uniqueId/awards'
          AND strftime('%Y-%m', l.created_at) = strftime('%Y-%m', 'now')) AS billable_month
    FROM partner_keys k LEFT JOIN users u ON u.id = k.created_by
    ORDER BY k.created_at DESC`);
}

async function recentLog(limit = 50) {
  const db = await openDb();
  return db.all(`
    SELECT l.*, k.partner_name FROM partner_query_log l
    JOIN partner_keys k ON k.id = l.key_id
    ORDER BY l.id DESC LIMIT ?`, [limit]);
}

// Append-only, never awaited by response-critical code paths beyond the
// insert itself: a failed write is an error, not a silent skip — an
// unlogged lookup would be worse than a failed one.
async function logQuery(keyId, { endpoint, queryName, queryStudio, dancerUniqueIds, resultCount, status }) {
  const db = await openDb();
  await db.run(
    `INSERT INTO partner_query_log (key_id, endpoint, query_name, query_studio, dancer_unique_ids, result_count, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [keyId, endpoint, queryName || null, queryStudio || null,
     (dancerUniqueIds && dancerUniqueIds.length) ? dancerUniqueIds.join(',') : null,
     resultCount != null ? resultCount : null, status || 'ok']);
}

// How many successful lookups this key has burned today, counted from the
// audit log itself so the quota can never disagree with the record.
async function usedToday(keyId) {
  const db = await openDb();
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM partner_query_log
     WHERE key_id = ? AND status = 'ok' AND date(created_at) = date('now')`, [keyId]);
  return row.n;
}

// Express middleware: Authorization: Bearer <key>. Invalid, unknown and
// revoked all answer the same 401 — a probing caller learns nothing about
// which keys exist or existed.
async function requirePartnerKey(req, res, next) {
  try {
    const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!m) {
      return res.status(401).json({ error: 'unauthorized', message: 'A partner API key is required.' });
    }
    const db = await openDb();
    const key = await db.get(
      'SELECT id, partner_name, daily_quota FROM partner_keys WHERE key_hash = ? AND revoked_at IS NULL',
      [hashKey(m[1])]);
    if (!key) {
      return res.status(401).json({ error: 'unauthorized', message: 'A partner API key is required.' });
    }
    await db.run('UPDATE partner_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [key.id]);
    req.partnerKey = key;
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = {
  DEFAULT_DAILY_QUOTA, hashKey,
  issueKey, revokeKey, listKeys, recentLog, logQuery, usedToday,
  requirePartnerKey,
};
