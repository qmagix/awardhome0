// Community flagging of USER-ADDED card content (photos, thank-you notes)
// — never award facts (confirmed scope 2026-08-28; official results cannot
// be mobbed off the archive). Mechanics: the first open flag on approved
// content demotes it to 'pending', which unpublishes it instantly via
// conditional materialization and routes it back through the existing
// /admin/card-content queue. Griefing guards: per-IP rate limit, one flag
// per (content, flagger), and once a human REINSTATES content, later flags
// only queue — no repeat auto-darkening.
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { openDb } = require('../database');

const flagLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many reports — please try again later.',
});

// content_type -> how to look up / demote the content
// Demotes propagate to identical same-dancer copies (same-routine
// propagation convention: one decision settles every copy — approve,
// reject, revoke, and flags all behave alike). The reinstate guard still
// holds: any prior human reinstate on the flagged item blocks auto-dark.
const TYPES = {
  ack: {
    get: (db, id) => db.get('SELECT id, status, dancer_id, message FROM award_acknowledgements WHERE id = ?', [id]),
    demote: (db, id, row) => db.run(
      "UPDATE award_acknowledgements SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE dancer_id = ? AND message = ? AND status = 'approved'",
      [row.dancer_id, row.message]),
  },
  award_photo: {
    get: (db, id) => db.get('SELECT id, status, dancer_id, photo_url FROM award_card_photos WHERE id = ?', [id]),
    demote: (db, id, row) => db.run(
      "UPDATE award_card_photos SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE dancer_id = ? AND photo_url = ? AND status = 'approved'",
      [row.dancer_id, row.photo_url]),
  },
  default_photo: {
    get: (db, id) => db.get("SELECT id, card_photo_status as status FROM dancers WHERE id = ? AND card_photo_url IS NOT NULL", [id]),
    demote: (db, id) => db.run("UPDATE dancers SET card_photo_status = 'pending' WHERE id = ? AND card_photo_status = 'approved'", [id]),
  },
};

router.post('/api/flag-card-content', flagLimiter, async (req, res) => {
  const type = String(req.body.content_type || '');
  const id = parseInt(req.body.content_id);
  if (!TYPES[type] || !id) return res.status(400).json({ error: 'Bad request' });

  const db = await openDb();
  const content = await TYPES[type].get(db, id);
  // Unknown content gets a generic success — a prober learns nothing.
  if (!content) return res.json({ success: true });

  const user = req.session && req.session.user;
  const flaggerKey = user
    ? 'u:' + user.id
    : 'ip:' + crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 16);

  await db.run(
    'INSERT OR IGNORE INTO content_flags (content_type, content_id, flagger_user_id, flagger_key) VALUES (?, ?, ?, ?)',
    [type, id, user ? user.id : null, flaggerKey]);

  // Auto-dark only if never human-reinstated before (griefing guard).
  if (content.status === 'approved') {
    const reinstated = await db.get(
      "SELECT 1 FROM content_flags WHERE content_type = ? AND content_id = ? AND status = 'resolved_reinstated' LIMIT 1",
      [type, id]);
    if (!reinstated) await TYPES[type].demote(db, id, content);
  }
  res.json({ success: true });
});

module.exports = router;
