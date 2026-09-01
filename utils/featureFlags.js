// Feature flags: deploy ≠ release. Code merges and deploys continuously;
// features go public when their flag flips. States: 'off' (nobody),
// 'beta' (admins/superadmins + users.early_access = 1), 'on' (everyone).
// A flag with flip_at <= now is promoted to 'on' lazily on read, so
// scheduled releases need no cron. Managed at /admin/features.
const { openDb } = require('../database');
const { cached, refresh } = require('./cache');

// Registry of known flags: ensures rows exist so /admin/features always
// lists them. Add new features here (and gate their surfaces on flagOn).
const FLAG_DEFS = [
  { key: 'thank_you_notes', label: 'Thank-You Notes', description: 'Flipbook acknowledgements page + note editing on award cards.' },
  { key: 'award_photos', label: 'Award Photos', description: 'Flipbook photo page: per-award performance shots + default card photo.' },
  { key: 'auto_moderation', label: 'Auto-Moderation', description: 'Machine moderation of thank-you notes (mode set in /admin/settings).' },
  { key: 'reactions', label: 'Reactions', description: 'Cheer/love reaction chips on trophy-case award cards (stored in reactions.sqlite).' },
  { key: 'family_submissions', label: 'Family Submissions', description: 'Families add a missing award for a dancer they own; entries stage in submissions.sqlite and stay private until a reviewer promotes them.' },
];

const VALID_STATES = ['off', 'beta', 'on'];
const CACHE_KEY = 'feature-flags';
const CACHE_TTL = 15 * 1000; // admin flips propagate within seconds

async function loadFlags() {
  const db = await openDb();
  try {
    for (const def of FLAG_DEFS) {
      await db.run("INSERT OR IGNORE INTO feature_flags (key, state) VALUES (?, 'off')", [def.key]);
    }
    // Lazy scheduled flips: promote anything whose time has come
    await db.run(
      "UPDATE feature_flags SET state = 'on', flip_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE state != 'on' AND flip_at IS NOT NULL AND flip_at <= datetime('now')");
    const rows = await db.all('SELECT key, state, flip_at, notes FROM feature_flags');
    const map = {};
    rows.forEach(r => { map[r.key] = r; });
    return map;
  } catch (e) {
    // Table missing until `node database.js` runs — everything stays dark
    return {};
  }
}

async function getFlags() {
  return cached(CACHE_KEY, CACHE_TTL, loadFlags);
}

// Is `key` enabled for this request's user? Pass req (or null for the
// anonymous/public view). Unknown flags are OFF — a typo can't leak a
// feature.
async function flagOn(key, req) {
  const flags = await getFlags();
  const flag = flags[key];
  if (!flag) return false;
  if (flag.state === 'on') return true;
  if (flag.state !== 'beta') return false;
  const user = req && req.session && req.session.user;
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'superadmin') return true;
  try {
    const db = await openDb();
    const row = await db.get('SELECT early_access FROM users WHERE id = ?', [user.id]);
    return !!(row && row.early_access);
  } catch (e) {
    return false;
  }
}

// Force the cache to pick up an admin change now-ish
function refreshFlags() {
  refresh(CACHE_KEY);
}

module.exports = { FLAG_DEFS, VALID_STATES, getFlags, flagOn, refreshFlags };
