// Scoped delegated cast-entry ("class-mom flow", maybe_patentable.md §A9).
// A director emails a capability link that authorizes ONE routine-year's
// cast entry — no account, nothing else visible, nothing written directly:
// submissions stage for the director's review, and the helper is credited.

const crypto = require('crypto');
const { sendEmail } = require('./mailer');
const { BASE_URL } = require('../config');

const INVITE_DAYS = 14;

async function ensureCastInviteTables(db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS routine_cast_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      routine_key TEXT NOT NULL,
      routine_display TEXT NOT NULL,
      year TEXT NOT NULL,
      email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME
    )`);
  await db.run(`
    CREATE TABLE IF NOT EXISTS routine_cast_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id INTEGER NOT NULL REFERENCES routine_cast_invites(id),
      helper_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      note TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      decided_by INTEGER REFERENCES users(id)
    )`);
}

function newInviteToken() {
  return crypto.randomBytes(24).toString('hex');
}

function inviteExpiry() {
  return new Date(Date.now() + INVITE_DAYS * 86400 * 1000).toISOString();
}

// Fire-and-forget helper email; the director also gets the link back in the
// UI, so a failed send never strands the flow.
async function sendCastInviteEmail({ email, studioName, routine, year, note, link }) {
  const html = `
    <p>Hi!</p>
    <p><strong>${escapeHtml(studioName)}</strong> is completing its award records on AwardHome and
    thinks you know the dancers of <strong>&ldquo;${escapeHtml(routine)}&rdquo;</strong> (${escapeHtml(String(year))}) better than anyone.</p>
    ${note ? `<p style="border-left: 3px solid #d4af37; padding-left: 10px; color: #555;">&ldquo;${escapeHtml(note)}&rdquo;</p>` : ''}
    <p>If you can spare two minutes, list the dancers here — no account needed, and the studio
    reviews everything before it goes anywhere:</p>
    <p><a href="${link}">${link}</a></p>
    <p>The link works for ${INVITE_DAYS} days and only opens this one routine. Thank you for helping
    these dancers get their credit!</p>`;
  const result = await sendEmail({ to: email, subject: `Can you name the dancers of "${routine}"? ${studioName} asked for your help`, html });
  if (!result.success) console.error('cast invite email failed:', result.error);
  return result;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { ensureCastInviteTables, newInviteToken, inviteExpiry, sendCastInviteEmail, INVITE_DAYS };
