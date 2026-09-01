// Mobile API authentication (mobile design v2 §9 "Authentication",
// development plan M5).
//
// The web app authenticates with a session cookie plus a CSRF token. A native
// client has neither and should not pretend to: it carries an opaque bearer
// token. That is why /api/v1/mobile mounts BEFORE the CSRF middleware — not to
// skip a check, but because the check does not apply to a request that carries
// no ambient credential. A bearer token is not attached by the browser
// automatically, so there is nothing for a cross-site request to forge.
//
// WHAT IS STORED. Only hashes. A database leak must not hand anyone a working
// token, exactly as password reset already works here (users.reset_token_hash).
// Tokens are 32 random bytes; SHA-256 is the right hash for a high-entropy
// secret — bcrypt's work factor buys nothing against a value nobody can
// dictionary-attack, and would cost real latency on every single API call.
//
// TOKEN SHAPE.
//   access   short-lived (15 min default), sent on every request
//   refresh  long-lived (60 days), used once, ROTATED on every use
//
// Rotation gives a cheap, strong theft signal: a refresh token is valid
// exactly once, so if a previously-rotated one is presented again, either the
// client replayed (harmless but wrong) or somebody stole it. We cannot tell
// which, so we assume the worse one and revoke the whole session. The user
// signs in again; an attacker gets nothing.
//
// WHERE IT LIVES. sessions.sqlite, beside the web sessions — the same class of
// ephemeral auth state, on the same lifecycle, already its own file. Token
// refreshes are frequent and tiny; keeping them off the serving database is
// the same reasoning that put submissions in their own file.
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { openDb } = require('../database');
const { sendEmail } = require('./mailer');

const ACCESS_TTL_MIN = parseInt(process.env.MOBILE_ACCESS_TTL_MIN, 10) || 15;
const REFRESH_TTL_DAYS = parseInt(process.env.MOBILE_REFRESH_TTL_DAYS, 10) || 60;
const CODE_TTL_MIN = parseInt(process.env.MOBILE_CODE_TTL_MIN, 10) || 10;
const CODE_MAX_ATTEMPTS = 5;
// Per-email code requests per hour. Low: this endpoint sends mail, so it is
// both a spam vector and a cost.
const CODE_REQUESTS_PER_HOUR = parseInt(process.env.MOBILE_CODE_REQUESTS_PER_HOUR, 10) || 5;

let dbPromise = null;

function authDbPath() {
  return process.env.MOBILE_AUTH_DB_PATH || process.env.SESSIONS_DB_PATH ||
    path.join(__dirname, '..', 'sessions.sqlite');
}

function openAuthDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await open({ filename: authDbPath(), driver: sqlite3.Database });
      await db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      await db.exec(`
        -- One row per signed-in device. Both token hashes live here so a
        -- revoke is a single write that invalidates everything that device
        -- holds, immediately, with no cache to wait out.
        CREATE TABLE IF NOT EXISTS mobile_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          device_label TEXT,
          platform TEXT,
          access_token_hash TEXT,
          access_expires_at DATETIME,
          refresh_token_hash TEXT NOT NULL,
          refresh_expires_at DATETIME NOT NULL,
          -- The generation this row just replaced. Presenting it again means
          -- a replay or a theft; we cannot tell which, so the session dies.
          prev_refresh_hash TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_used_at DATETIME,
          rotated_at DATETIME,
          revoked_at DATETIME,
          revoked_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_user ON mobile_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_access ON mobile_sessions(access_token_hash);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_refresh ON mobile_sessions(refresh_token_hash);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_prev ON mobile_sessions(prev_refresh_hash);

        -- Emailed one-time sign-in codes. The code itself is never stored.
        CREATE TABLE IF NOT EXISTS mobile_auth_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          consumed_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_auth_codes_email ON mobile_auth_codes(email, created_at);

        -- Push registration. Notifications are for DECISIONS and QUESTIONS
        -- only (design §13) — never engagement pings — so this table stays
        -- deliberately thin.
        CREATE TABLE IF NOT EXISTS push_devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          session_id INTEGER,
          platform TEXT NOT NULL,
          token TEXT NOT NULL,
          preferences TEXT,
          last_success_at DATETIME,
          disabled_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, token)
        );
        CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);
      `);
      return db;
    })();
  }
  return dbPromise;
}

// ---- Token primitives ------------------------------------------------------

const newToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Six digits, uniformly distributed. Math.random() is not a CSPRNG and this is
// a credential.
function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

// ---- Sign-in codes ---------------------------------------------------------

// Request a code. ALWAYS reports success: telling a caller whether an address
// has an account turns this endpoint into an account-existence oracle, and
// these are children's families. Same reasoning as the password-reset flow.
async function requestCode(email, { baseUrl } = {}) {
  const adb = await openAuthDb();
  const addr = normalizeEmail(email);
  if (!addr || !addr.includes('@')) return { ok: true, sent: false };

  const recent = await adb.get(
    "SELECT COUNT(*) AS n FROM mobile_auth_codes WHERE email = ? AND created_at > datetime('now', '-1 hour')",
    [addr]);
  if (recent && recent.n >= CODE_REQUESTS_PER_HOUR) return { ok: true, sent: false, throttled: true };

  const db = await openDb();
  const user = await db.get('SELECT id, email FROM users WHERE LOWER(email) = ?', [addr]);

  const code = newCode();
  // The row is written even for an unknown address, so timing does not leak
  // account existence either.
  await adb.run(
    "INSERT INTO mobile_auth_codes (email, code_hash, expires_at) VALUES (?, ?, datetime('now', ?))",
    [addr, hashToken(code), `+${CODE_TTL_MIN} minutes`]);

  if (user) {
    if (!process.env.EMAIL_PROVIDER) {
      console.log(`[DEV MODE] Mobile sign-in code for ${addr}: ${code}`);
    } else {
      await sendEmail({
        to: user.email,
        subject: `Your AwardHome sign-in code: ${code}`,
        html: `<p>Your sign-in code is <strong style="font-size:1.4em;letter-spacing:0.1em;">${code}</strong></p>
               <p>It works once and expires in ${CODE_TTL_MIN} minutes. If you didn't ask for it, you can ignore this email.</p>`,
      });
    }
  }
  return { ok: true, sent: true, devCode: process.env.NODE_ENV === 'production' ? undefined : code };
}

// Verify a code and mint a session. Attempts are counted on the ROW, so
// brute-forcing one code is bounded regardless of how the caller spreads the
// attempts across connections.
async function verifyCode(email, code, { deviceLabel = null, platform = null } = {}) {
  const adb = await openAuthDb();
  const addr = normalizeEmail(email);
  const row = await adb.get(`
    SELECT * FROM mobile_auth_codes
    WHERE email = ? AND consumed_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1`, [addr]);
  if (!row) return { ok: false, reason: 'invalid_code' };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  if (row.code_hash !== hashToken(code)) {
    await adb.run('UPDATE mobile_auth_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    return { ok: false, reason: 'invalid_code' };
  }
  await adb.run("UPDATE mobile_auth_codes SET consumed_at = datetime('now') WHERE id = ?", [row.id]);

  const db = await openDb();
  const user = await db.get('SELECT id, email, role FROM users WHERE LOWER(email) = ?', [addr]);
  // A consumed code for an address with no account is a dead end, not an
  // error worth distinguishing.
  if (!user) return { ok: false, reason: 'invalid_code' };

  // Signing in on a device confirms the address as surely as clicking a
  // verification link does.
  await db.run('UPDATE users SET is_verified = 1 WHERE id = ? AND is_verified = 0', [user.id]);

  const tokens = await createSession(user.id, { deviceLabel, platform });
  return { ok: true, user, ...tokens };
}

// ---- Sessions --------------------------------------------------------------

async function createSession(userId, { deviceLabel = null, platform = null } = {}) {
  const adb = await openAuthDb();
  const access = newToken();
  const refresh = newToken();
  const res = await adb.run(`
    INSERT INTO mobile_sessions
      (user_id, device_label, platform, access_token_hash, access_expires_at,
       refresh_token_hash, refresh_expires_at, last_used_at)
    VALUES (?, ?, ?, ?, datetime('now', ?), ?, datetime('now', ?), datetime('now'))`,
    [userId, deviceLabel, platform, hashToken(access), `+${ACCESS_TTL_MIN} minutes`,
     hashToken(refresh), `+${REFRESH_TTL_DAYS} days`]);
  return {
    sessionId: res.lastID,
    accessToken: access,
    refreshToken: refresh,
    expiresIn: ACCESS_TTL_MIN * 60,
  };
}

// Resolve a bearer access token to a user. Returns null for anything expired,
// revoked, or unknown — the caller cannot tell which, and should not.
async function resolveAccessToken(token) {
  if (!token) return null;
  const adb = await openAuthDb();
  const row = await adb.get(`
    SELECT * FROM mobile_sessions
    WHERE access_token_hash = ? AND revoked_at IS NULL AND access_expires_at > datetime('now')`,
    [hashToken(token)]);
  if (!row) return null;

  const db = await openDb();
  const user = await db.get('SELECT id, email, role FROM users WHERE id = ?', [row.user_id]);
  if (!user) return null; // account deleted; the session is meaningless
  // Fire-and-forget: last_used_at is telemetry, and a write failure must not
  // fail an authenticated read.
  adb.run("UPDATE mobile_sessions SET last_used_at = datetime('now') WHERE id = ?", [row.id]).catch(() => {});
  return { user, session: row };
}

// Rotate. A refresh token is single-use; presenting a previous generation
// means replay or theft, and since we cannot tell them apart we assume theft
// and kill the session.
async function refreshSession(refreshToken) {
  const adb = await openAuthDb();
  const h = hashToken(refreshToken);

  const reused = await adb.get(
    'SELECT id, user_id FROM mobile_sessions WHERE prev_refresh_hash = ? AND revoked_at IS NULL', [h]);
  if (reused) {
    await adb.run(
      "UPDATE mobile_sessions SET revoked_at = datetime('now'), revoked_reason = 'refresh_token_reuse' WHERE id = ?",
      [reused.id]);
    return { ok: false, reason: 'token_reuse' };
  }

  const row = await adb.get(`
    SELECT * FROM mobile_sessions
    WHERE refresh_token_hash = ? AND revoked_at IS NULL AND refresh_expires_at > datetime('now')`, [h]);
  if (!row) return { ok: false, reason: 'invalid_token' };

  const access = newToken();
  const refresh = newToken();
  await adb.run(`
    UPDATE mobile_sessions
    SET access_token_hash = ?, access_expires_at = datetime('now', ?),
        refresh_token_hash = ?, refresh_expires_at = datetime('now', ?),
        prev_refresh_hash = ?, rotated_at = datetime('now'), last_used_at = datetime('now')
    WHERE id = ?`,
    [hashToken(access), `+${ACCESS_TTL_MIN} minutes`,
     hashToken(refresh), `+${REFRESH_TTL_DAYS} days`, h, row.id]);

  return {
    ok: true, sessionId: row.id, userId: row.user_id,
    accessToken: access, refreshToken: refresh, expiresIn: ACCESS_TTL_MIN * 60,
  };
}

// Revoke this device, or every device for the account. `all` is what a
// password change or a lost phone needs, and it takes effect on the next
// request — there is no token cache to expire.
async function revokeSession({ sessionId = null, userId = null, all = false, reason = 'user_revoked' }) {
  const adb = await openAuthDb();
  if (all && userId) {
    const res = await adb.run(
      "UPDATE mobile_sessions SET revoked_at = datetime('now'), revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL",
      [reason, userId]);
    await adb.run("UPDATE push_devices SET disabled_at = datetime('now') WHERE user_id = ? AND disabled_at IS NULL", [userId]);
    return { revoked: res.changes || 0 };
  }
  if (!sessionId) return { revoked: 0 };
  const res = await adb.run(
    "UPDATE mobile_sessions SET revoked_at = datetime('now'), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL",
    [reason, sessionId]);
  await adb.run("UPDATE push_devices SET disabled_at = datetime('now') WHERE session_id = ? AND disabled_at IS NULL", [sessionId]);
  return { revoked: res.changes || 0 };
}

async function listSessions(userId) {
  const adb = await openAuthDb();
  return adb.all(`
    SELECT id, device_label, platform, created_at, last_used_at, revoked_at
    FROM mobile_sessions WHERE user_id = ? ORDER BY created_at DESC`, [userId]);
}

// ---- Push devices ----------------------------------------------------------

async function registerDevice({ userId, sessionId, platform, token, preferences = null }) {
  const adb = await openAuthDb();
  await adb.run(`
    INSERT INTO push_devices (user_id, session_id, platform, token, preferences)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, token) DO UPDATE SET
      session_id = excluded.session_id, platform = excluded.platform,
      preferences = excluded.preferences, disabled_at = NULL`,
    [userId, sessionId, platform, token, preferences ? JSON.stringify(preferences) : null]);
  return { ok: true };
}

// ---- Express middleware ----------------------------------------------------

// Attaches req.mobileUser / req.mobileSession when a valid bearer token is
// present, and does nothing otherwise. Read endpoints that mirror a PUBLIC web
// page use this, so guest browsing needs no account (plan §5).
async function attachBearer(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const m = header.match(/^Bearer\s+(\S+)$/i);
    if (m) {
      const resolved = await resolveAccessToken(m[1]);
      if (resolved) {
        req.mobileUser = resolved.user;
        req.mobileSession = resolved.session;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireBearer(req, res, next) {
  if (!req.mobileUser) {
    return res.status(401).json({ error: 'unauthorized', message: 'Sign in to continue.' });
  }
  next();
}

module.exports = {
  ACCESS_TTL_MIN, REFRESH_TTL_DAYS, CODE_TTL_MIN, CODE_MAX_ATTEMPTS, CODE_REQUESTS_PER_HOUR,
  openAuthDb, authDbPath, hashToken, normalizeEmail,
  requestCode, verifyCode,
  createSession, resolveAccessToken, refreshSession, revokeSession, listSessions,
  registerDevice,
  attachBearer, requireBearer,
};
