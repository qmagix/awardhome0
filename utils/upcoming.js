// Upcoming Events Directory ("Plan Your Season", ideas.md §7, phase 1).
// One table holds every organizer's future tour stops. Rows are entered by
// owners/superadmins (source 'owner'), seeded from official sites
// (source 'seed'), or — phase 2 — scraped weekly (source 'scraped').
// Owner-entered rows are authoritative: scrapers must never overwrite them.
const { openDb } = require('../database');

// Defensive twin of the initDb DDL (same pattern as utils/invites.js):
// routes work even before `node database.js` re-runs on a deploy.
const UPCOMING_DDL = `
  CREATE TABLE IF NOT EXISTS org_upcoming_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    city TEXT,
    state TEXT,
    venue TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    registration_url TEXT,
    source TEXT NOT NULL DEFAULT 'owner',
    source_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_seen_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_org_upcoming_events_org_date
    ON org_upcoming_events(org_id, start_date);
  CREATE TABLE IF NOT EXISTS event_shortlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    upcoming_event_id INTEGER NOT NULL REFERENCES org_upcoming_events(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, upcoming_event_id)
  );
`;

async function ensureUpcomingTable(db) {
  await db.exec(UPCOMING_DDL);
  try { await db.exec('ALTER TABLE org_upcoming_events ADD COLUMN lat REAL'); } catch (e) { }
  try { await db.exec('ALTER TABLE org_upcoming_events ADD COLUMN lng REAL'); } catch (e) { }
  try { await db.exec("ALTER TABLE org_upcoming_events ADD COLUMN gold TEXT"); } catch (e) { }
}

// Great-circle distance in miles (haversine) — near-me sorting.
function distanceMiles(lat1, lng1, lat2, lng2) {
  const rad = (d) => d * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Normalize + validate a submitted event. Returns { ok, error, values }.
function cleanUpcomingInput(body) {
  const trim = (v, max) => String(v || '').trim().slice(0, max);
  const name = trim(body.name, 120);
  const city = trim(body.city, 80);
  const state = trim(body.state, 2).toUpperCase();
  const venue = trim(body.venue, 120);
  const start_date = trim(body.start_date, 10);
  const end_date = trim(body.end_date, 10);
  let registration_url = trim(body.registration_url, 300);

  if (!name) return { ok: false, error: 'Event name is required.' };
  if (!ISO_DATE.test(start_date)) return { ok: false, error: 'A start date is required (YYYY-MM-DD).' };
  if (end_date && !ISO_DATE.test(end_date)) return { ok: false, error: 'End date must be YYYY-MM-DD.' };
  if (end_date && end_date < start_date) return { ok: false, error: 'End date is before the start date.' };
  if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: 'State should be a 2-letter code.' };
  if (registration_url && !/^https?:\/\//i.test(registration_url)) registration_url = 'https://' + registration_url;

  return { ok: true, values: { name, city, state, venue, start_date, end_date: end_date || null, registration_url: registration_url || null } };
}

// Future (or in-progress) active events for one org, soonest first.
async function upcomingForOrg(db, orgId) {
  return db.all(`
    SELECT * FROM org_upcoming_events
    WHERE org_id = ? AND status = 'active'
      AND COALESCE(end_date, start_date) >= date('now')
    ORDER BY start_date ASC
  `, [orgId]);
}

module.exports = { ensureUpcomingTable, cleanUpcomingInput, upcomingForOrg, distanceMiles };
