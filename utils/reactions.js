// Social reactions ("cheers") on award cards, stored in their own SQLite
// file — the sessionStore.js precedent: reactions are the first
// tap-frequency write path in the app, and a separate DB keeps those
// writes from contending with app-data writes (SQLite serializes writers
// per file) and keeps the churn out of the main DB's Litestream WAL
// stream. Counts merge in app code, so no cross-DB JOIN is ever needed.
//
// Reactor identity: logged-in users react as `u:<id>`; anonymous
// visitors (grandma shouldn't need an account) get a long-lived signed
// cookie minted on their first reaction — sessions won't do, they're
// saveUninitialized:false and expire in 7 days.
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const REACTION_TYPES = ['cheer', 'love'];
const COOKIE_NAME = 'ah_rk';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

let dbPromise = null;
function openReactionsDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const filename = process.env.REACTIONS_DB_PATH || path.join(__dirname, '..', 'reactions.sqlite');
      const db = await open({ filename, driver: sqlite3.Database });
      await db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
      // Self-contained schema: created on first open, so the feature works
      // the moment the code deploys — no migrate-ordering dependency.
      await db.exec(`
        CREATE TABLE IF NOT EXISTS reactions (
          award_id INTEGER NOT NULL,
          reactor_key TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (award_id, reactor_key, type)
        )`);
      return db;
    })();
  }
  return dbPromise;
}

function sign(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev-secret')
    .update(value).digest('hex').slice(0, 32);
}

// Read the reactor key for this request WITHOUT minting one: `u:<id>` for
// logged-in users, `a:<id>` for a valid signed anonymous cookie, else null.
function readReactorKey(req) {
  const user = req.session && req.session.user;
  if (user) return 'u:' + user.id;
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  if (!match) return null;
  const [value, sig] = decodeURIComponent(match[1]).split('.');
  if (!value || !sig) return null;
  try {
    if (crypto.timingSafeEqual(Buffer.from(sign(value)), Buffer.from(sig))) return 'a:' + value;
  } catch (e) { /* malformed cookie */ }
  return null;
}

// Reactor key for a write: mints + sets the anonymous cookie when needed.
function ensureReactorKey(req, res) {
  const existing = readReactorKey(req);
  if (existing) return existing;
  const value = crypto.randomBytes(16).toString('hex');
  res.cookie(COOKIE_NAME, value + '.' + sign(value), {
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return 'a:' + value;
}

// Toggle: first tap adds, second tap of the same type removes.
// Returns { mine, count } for the client to render.
async function toggleReaction(awardId, reactorKey, type) {
  const db = await openReactionsDb();
  const inserted = await db.run(
    'INSERT OR IGNORE INTO reactions (award_id, reactor_key, type) VALUES (?, ?, ?)',
    [awardId, reactorKey, type]);
  if (!inserted.changes) {
    await db.run('DELETE FROM reactions WHERE award_id = ? AND reactor_key = ? AND type = ?',
      [awardId, reactorKey, type]);
  }
  const row = await db.get('SELECT COUNT(*) AS n FROM reactions WHERE award_id = ? AND type = ?',
    [awardId, type]);
  return { mine: !!inserted.changes, count: row.n };
}

// Per-award counts for a page render: { [awardId]: { cheer, love } }.
async function countsForAwards(awardIds) {
  if (!awardIds.length) return {};
  const db = await openReactionsDb();
  const rows = await db.all(
    `SELECT award_id, type, COUNT(*) AS n FROM reactions
     WHERE award_id IN (${awardIds.map(() => '?').join(',')})
     GROUP BY award_id, type`, awardIds);
  const map = {};
  for (const r of rows) {
    (map[r.award_id] = map[r.award_id] || { cheer: 0, love: 0 })[r.type] = r.n;
  }
  return map;
}

// The viewer's own reactions: { [awardId]: ['cheer', ...] }.
async function myReactions(awardIds, reactorKey) {
  if (!awardIds.length || !reactorKey) return {};
  const db = await openReactionsDb();
  const rows = await db.all(
    `SELECT award_id, type FROM reactions
     WHERE reactor_key = ? AND award_id IN (${awardIds.map(() => '?').join(',')})`,
    [reactorKey, ...awardIds]);
  const map = {};
  for (const r of rows) (map[r.award_id] = map[r.award_id] || []).push(r.type);
  return map;
}

// Eager open at require time so the DB file exists as soon as the app
// boots — Litestream watches the path and shouldn't find it missing.
openReactionsDb().catch(() => {});

module.exports = { REACTION_TYPES, openReactionsDb, readReactorKey, ensureReactorKey, toggleReaction, countsForAwards, myReactions };
