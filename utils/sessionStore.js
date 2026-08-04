const path = require('path');
const session = require('express-session');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Persistent session store backed by its own SQLite file (kept separate from
// database.sqlite so session writes never contend with app data writes).
class SqliteSessionStore extends session.Store {
  constructor(filename = path.join(__dirname, '..', 'sessions.sqlite')) {
    super();
    this.ready = (async () => {
      const db = await open({ filename, driver: sqlite3.Database });
      await db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, expires INTEGER, sess TEXT)');
      return db;
    })();

    this.pruneTimer = setInterval(() => {
      this.ready.then(db => db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()])).catch(() => {});
    }, 60 * 60 * 1000);
    this.pruneTimer.unref();
  }

  get(sid, cb) {
    this.ready
      .then(db => db.get('SELECT sess, expires FROM sessions WHERE sid = ?', [sid]))
      .then(row => {
        if (!row || row.expires < Date.now()) return cb(null, null);
        cb(null, JSON.parse(row.sess));
      })
      .catch(err => cb(err));
  }

  set(sid, sess, cb) {
    const maxAge = (sess.cookie && sess.cookie.maxAge) || ONE_WEEK_MS;
    this.ready
      .then(db => db.run(
        `INSERT INTO sessions (sid, expires, sess) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, sess = excluded.sess`,
        [sid, Date.now() + maxAge, JSON.stringify(sess)]
      ))
      .then(() => cb && cb(null))
      .catch(err => cb && cb(err));
  }

  destroy(sid, cb) {
    this.ready
      .then(db => db.run('DELETE FROM sessions WHERE sid = ?', [sid]))
      .then(() => cb && cb(null))
      .catch(err => cb && cb(err));
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = SqliteSessionStore;
