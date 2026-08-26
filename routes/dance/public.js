const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { logStudioActivity } = require('../../utils/activity');
const { cached } = require('../../utils/cache');
const { formatEventTitle } = require('../../utils/format');
const { unsubscribeToken } = require('../../utils/invites');
const { resolveCardDesign } = require('../../utils/cardDesign');
const { flagOn } = require('../../utils/featureFlags');
const { ensureUpcomingTable, upcomingForOrg, distanceMiles } = require('../../utils/upcoming');
const { REACTION_TYPES, readReactorKey, ensureReactorKey, toggleReaction, countsForAwards, myReactions } = require('../../utils/reactions');
const rateLimit = require('express-rate-limit');
const { BASE_URL } = require('../../config');
const { requireAdmin } = require('../../middleware/auth');
const path = require('path');

// Per-IP limit on the enumerable public data surfaces (studio/dancer
// profiles, year partials, widget). IDs are sequential, so with the
// directory admin-gated these pages are the remaining bulk-scrape path.
// 100 per 5 min is far above human browsing (incl. year-tab clicks)
// but caps a single IP at ~29k pages/day. Admins are exempt.
const profileLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: parseInt(process.env.PROFILE_RATE_LIMIT, 10) || 100,
  message: 'Too many requests from this address — please slow down and try again in a few minutes.',
  skip: (req) => {
    const role = req.session && req.session.user && req.session.user.role;
    return role === 'admin' || role === 'superadmin';
  }
});


// Public Widget Iframe Route
router.get('/widget/studio/:id', profileLimiter, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.removeHeader('X-Frame-Options');

  const db = await openDb();
  const studio = await db.get('SELECT id, name, logo_url FROM studios WHERE unique_id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  req.params.id = studio.id;
  logStudioActivity(studio.id, 'widget_embed', { dedupMinutes: 1440 });

  const baseQuery = `
    SELECT a.id, a.place, a.performance_name, a.award_type, a.category, e.name as event_name, e.year, GROUP_CONCAT(d.name, ', ') as dancer_name
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN award_dancers ad ON a.id = ad.award_id
    LEFT JOIN dancers d ON ad.dancer_id = d.id
    WHERE a.studio_id = ?
    GROUP BY a.id
    ORDER BY e.year DESC, e.date_string DESC
  `;

  const awardsRaw = await db.all(baseQuery, [req.params.id]);

  const theme = req.query.theme || 'dark';
  const primaryColor = req.query.primary || 'd4af37';
  const bg = req.query.bg || (theme === 'dark' ? '000000' : 'ffffff');
  const layout = req.query.layout || 'list';
  const premiumOnly = req.query.premiumOnly === 'true';
  const topPlacementsOnly = req.query.topPlacementsOnly === 'true';

  const showTotalAwards = req.query.showTotalAwards !== 'false'; // default true for stats
  const showTopPlacements = req.query.showTopPlacements !== 'false';
  const showPastYear = req.query.showPastYear !== 'false';
  const widgetType = req.query.widgetType || 'both'; // 'stats', 'awards', or 'both'

  const currentYear = new Date().getFullYear();
  const widgetStats = {
    totalAwards: awardsRaw.length,
    pastYearAwards: awardsRaw.filter(a => parseInt(a.year, 10) === currentYear).length,
    topPlacements: awardsRaw.filter(a => {
      if (!a.place) return false;
      const p = String(a.place).toLowerCase();
      return p === '1' || p.includes('1st') || p === '2' || p.includes('2nd') || p === '3' || p.includes('3rd') || p === 'winner';
    }).length
  };

  let awards = awardsRaw;

  if (premiumOnly || topPlacementsOnly) {
    awards = awards.filter(award => {
      let isTopPlace = false;
      if (award.place) {
        const pLower = String(award.place).toLowerCase();
        if (pLower === '1' || pLower.includes('1st') || pLower === '2' || pLower.includes('2nd') || pLower === '3' || pLower.includes('3rd') || pLower === 'winner') {
          isTopPlace = true;
        }
      }

      const isPremium = req.app.locals.isPremiumAward(award);

      if (premiumOnly && topPlacementsOnly) {
        return isPremium && isTopPlace;
      } else if (premiumOnly) {
        return isPremium;
      } else if (topPlacementsOnly) {
        return isTopPlace;
      }
      return true;
    });
  }

  // Final limit after filtering
  awards = awards.slice(0, 20);

  res.render('widget', {
    studio,
    awards,
    theme,
    primaryColor,
    bg,
    layout,
    widgetStats,
    showTotalAwards,
    showTopPlacements,
    showPastYear,
    widgetType,
    baseUrl: BASE_URL
  });
});


router.get('/faq/admin', (req, res) => {
  res.render('faq_admin');
});


router.get('/faq/dancer', (req, res) => {
  res.render('faq_dancer');
});


router.get('/faq/organizer', (req, res) => {
  res.render('faq_organizer', { user: req.session.user });
});


// One-click unsubscribe from invite emails (HMAC-signed, no login needed).
// GET serves humans clicking the footer link; POST serves RFC 8058
// one-click unsubscribe from mail clients (params stay in the query string).
router.all('/unsubscribe', async (req, res) => {
  const { e, t } = req.query;
  if (!e || !t) return res.status(400).send('Invalid unsubscribe link.');
  let email;
  try {
    email = Buffer.from(String(e), 'base64url').toString('utf8');
  } catch {
    return res.status(400).send('Invalid unsubscribe link.');
  }
  if (!email || unsubscribeToken(email) !== t) return res.status(400).send('Invalid unsubscribe link.');

  const db = await openDb();
  await db.run('INSERT OR IGNORE INTO email_suppressions (email) VALUES (?)', [email.toLowerCase()]);
  res.send(`<!DOCTYPE html><html><head><title>Unsubscribed — AwardHome</title></head>
    <body style="background:#0a0a0a;color:#fff;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
      <div style="text-align:center;max-width:420px;padding:2rem;">
        <h1 style="color:#d4af37;">You're unsubscribed</h1>
        <p style="color:#a0a0a0;">We won't send any more emails to this address. Your studio's public results page is unaffected.</p>
      </div>
    </body></html>`);
});

// AwardHome umbrella landing for anonymous visitors; logged-in users go
// straight to the dance vertical home.
router.get('/', (req, res) => {
  // Landing designs (cutover 2026-08-24): the "hybrid" Front Door
  // (public3) is the default. ?design=rafters serves the full Front Door
  // variant (public2), ?design=v0 the original landing (escape hatch).
  // Flags bypass the logged-in redirect so designs can be previewed.
  if (req.query.design === 'rafters') {
    return res.sendFile(path.join(__dirname, '..', '..', 'public2', 'index.html'));
  }
  if (req.query.design === 'v0') {
    return res.sendFile(path.join(__dirname, '..', '..', 'landing', 'index.html'));
  }
  if (req.session.user) return res.redirect('/dance');
  res.sendFile(path.join(__dirname, '..', '..', 'public3', 'index.html'));
});


// Legacy public URLs → /dance namespace (301 so bookmarks and crawlers
// follow). Studio paths deliberately dropped: public studio URLs now use
// the non-guessable unique_id, and a numeric-id redirect would be an
// enumeration oracle for the whole dataset.
router.get(['/studios', '/org/:slug', '/event/:id'],
  (req, res) => res.redirect(301, '/dance' + req.originalUrl));

// Homepage data is identical for every visitor and expensive to compute
// (7 aggregations over ~900k awards) — cache it for 5 minutes. Featured
// changes invalidate the key (see utils/featured.js).
async function loadHomepageData() {
  const db = await openDb();

  const featuredStudios = await db.all(`
    SELECT s.id, s.unique_id, s.name, COUNT(DISTINCT a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    WHERE s.is_featured = 1 OR s.auto_featured_rank IS NOT NULL
    GROUP BY s.id
    ORDER BY s.is_featured DESC, s.auto_featured_rank ASC, s.name
    LIMIT 12
  `);

  let excludeIds = featuredStudios.map(s => s.id);
  if (excludeIds.length === 0) excludeIds = [-1];

  const topStudios = await db.all(`
    SELECT s.id, s.unique_id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    WHERE s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 100
  `);

  const topStudiosThisYear = await db.all(`
    SELECT s.id, s.unique_id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    LEFT JOIN events e ON a.event_id = e.id
    WHERE e.year = (SELECT MAX(year) FROM events) AND s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 100
  `);

  const topStudiosFirstPlaceThisYear = await db.all(`
    SELECT s.id, s.unique_id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    LEFT JOIN events e ON a.event_id = e.id
    WHERE a.is_first_place = 1 
      AND e.year = (SELECT MAX(year) FROM events)
      AND s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 100
  `);

  const topDancers = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.is_claimed, d.headshot_url, COUNT(ad.id) as total_awards
    FROM dancers d
    JOIN award_dancers ad ON d.id = ad.dancer_id
    JOIN awards a ON ad.award_id = a.id
    GROUP BY d.id
    ORDER BY total_awards DESC
    LIMIT 500
  `);

  const topDancersThisYear = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.is_claimed, d.headshot_url, COUNT(ad.id) as total_awards
    FROM dancers d
    JOIN award_dancers ad ON d.id = ad.dancer_id
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE e.year = (SELECT MAX(year) FROM events)
    GROUP BY d.id
    ORDER BY total_awards DESC
    LIMIT 500
  `);

  const topDancersFirstPlaceThisYear = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.is_claimed, d.headshot_url, COUNT(ad.id) as total_awards
    FROM dancers d
    JOIN award_dancers ad ON d.id = ad.dancer_id
    JOIN awards a ON ad.award_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE a.is_first_place = 1 AND e.year = (SELECT MAX(year) FROM events)
    GROUP BY d.id
    ORDER BY total_awards DESC
    LIMIT 500
  `);

  const orgs = await db.all(`
    SELECT o.id, o.name, o.slug,
           COALESCE(o.data_since, MIN(CAST(e.year AS INTEGER))) AS data_since,
           COUNT(e.id) as event_count
    FROM organizations o
    LEFT JOIN events e ON o.id = e.org_id
    WHERE COALESCE(o.visibility, 'public') = 'public'
    GROUP BY o.id
    ORDER BY o.name
  `);

  // Platform-wide headline numbers (v2 homepage hero). Full-table counts,
  // but computed at most once per cache window like everything else here.
  const totals = await db.get(`
    SELECT (SELECT COUNT(*) FROM awards) AS awards,
           (SELECT COUNT(*) FROM dancers) AS dancers,
           (SELECT COUNT(*) FROM studios WHERE status IS NULL OR status != 'merged') AS studios
  `);

  return { featuredStudios, topStudios, topStudiosThisYear, topStudiosFirstPlaceThisYear, topDancers, topDancersThisYear, topDancersFirstPlaceThisYear, orgs, totals };
}

const HOME_TTL = 5 * 60 * 1000;

// Warm the cache at boot — without this the first visitor after every
// restart pays the full compute. After that, expired hits serve the stale
// value while cached() refreshes in the background, so no request ever
// waits on these queries again.
cached('dance-home', HOME_TTL, loadHomepageData).catch(err =>
  console.error('[dance-home] startup cache warm failed:', err.message));

// Leaderboards render only the top rows inline; the rest load on demand
// (see /dance/leaderboard/:board). Cuts the homepage payload ~85%.
const LEADERBOARD_PREVIEW = 25;

router.get('/dance', async (req, res) => {
  const data = await cached('dance-home', HOME_TTL, loadHomepageData);
  const isAdmin = req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin');
  if (!isAdmin) {
    // Impression denominator for org-card click-through: counted only for
    // the public homepage, the population that sees the unlinked org cards
    // (the admin homepage links its cards). Never blocks the render.
    try {
      const db = await openDb();
      await db.run(`INSERT INTO daily_counters (day, key, count) VALUES (date('now'), 'dance_home_views', 1)
                    ON CONFLICT(day, key) DO UPDATE SET count = count + 1`);
    } catch (e) { /* table lands with the next migrate */ }
  }
  // Homepage designs (cutover 2026-08-24): "The Hall" (index_v2) is the
  // public default; admins keep index_admin (their working tool — linked
  // org cards, admin shortcuts) unless they ask for the Hall explicitly.
  // ?design=v0 is the classic escape hatch, ?design=rafters an alias.
  if (req.query.design === 'v0') {
    return res.render('index', { ...data, previewCount: LEADERBOARD_PREVIEW });
  }
  if (req.query.design === 'rafters') {
    return res.render('index_v2', { ...data, previewCount: LEADERBOARD_PREVIEW });
  }
  res.render(isAdmin ? 'index_admin' : 'index_v2', { ...data, previewCount: LEADERBOARD_PREVIEW });
});

// Click telemetry for the deliberately-unlinked homepage org cards (see
// views/index.ejs): org cards don't navigate anywhere — org pages stay
// low-profile until the org partners — but genuine visitor demand is
// recorded per org so outreach can quote it. CSRF-covered like all POSTs.
const orgClickLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many requests.',
});
router.post('/api/org-card-click', orgClickLimiter, express.json(), async (req, res) => {
  const orgId = parseInt(req.body && req.body.org_id, 10);
  if (!orgId) return res.status(400).json({ error: 'org_id required' });
  const role = req.session && req.session.user && req.session.user.role;
  if (role === 'admin' || role === 'superadmin') return res.json({ ok: true, skipped: 'admin' });
  const db = await openDb();
  const org = await db.get('SELECT id FROM organizations WHERE id = ?', [orgId]);
  if (!org) return res.status(404).json({ error: 'Unknown organization' });
  // Defensive create so the endpoint works before the next migrate runs.
  await db.run(`CREATE TABLE IF NOT EXISTS org_card_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run('INSERT INTO org_card_clicks (org_id) VALUES (?)', [orgId]);
  res.json({ ok: true });
});


// Remainder of a homepage leaderboard as a server-rendered HTML fragment.
// Slices the same cached data the homepage used — no extra DB work.
const BOARDS = {
  'studios-alltime': ['topStudios', 'studio'],
  'studios-thisyear': ['topStudiosThisYear', 'studio'],
  'studios-firstplaces': ['topStudiosFirstPlaceThisYear', 'studio'],
  'dancers-alltime': ['topDancers', 'dancer'],
  'dancers-thisyear': ['topDancersThisYear', 'dancer'],
  'dancers-firstplaces': ['topDancersFirstPlaceThisYear', 'dancer'],
};

router.get('/dance/leaderboard/:board', async (req, res) => {
  const spec = BOARDS[req.params.board];
  if (!spec) return res.status(404).send('Unknown leaderboard');
  const data = await cached('dance-home', HOME_TTL, loadHomepageData);
  const rows = data[spec[0]].slice(LEADERBOARD_PREVIEW);
  res.render('partials/leaderboard_rows', { rows, type: spec[1], offset: LEADERBOARD_PREVIEW });
});


// Public organization showcase: branding + stats + event history. Per-event
// award detail stays admin-only (the event pages keep their gate).
// Upcoming Events Directory ("Plan Your Season"): every organizer's future
// tour stops, filterable by state / month / competition. Studios use this
// to plan their season — the forward-looking counterpart to the archive.
// DELIBERATE: rows show org names as text, not /dance/org links, matching
// the homepage-card rule (org pages stay low-profile until orgs partner).
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Parse + load the directory's filtered event set. Shared by the HTML
// page and the .ics export so a saved calendar always matches the view.
// "near" is browser-geolocation lat,lng passed as a query param — used
// for this one request to compute distances, never stored anywhere.
async function loadUpcomingFiltered(db, req) {
  const state = /^[A-Za-z]{2}$/.test(req.query.state || '') ? req.query.state.toUpperCase() : '';
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '';
  const orgId = /^\d+$/.test(req.query.org || '') ? Number(req.query.org) : 0;
  const saved = req.query.saved === '1';
  const userId = req.session && req.session.user ? req.session.user.id : null;
  let near = null;
  const nearMatch = String(req.query.near || '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (nearMatch) {
    const lat = Number(nearMatch[1]), lng = Number(nearMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) near = { lat, lng };
  }
  const RADII = [100, 250, 500];
  const radius = near && RADII.includes(Number(req.query.radius)) ? Number(req.query.radius) : (near ? 250 : 0);

  const where = [`ue.status = 'active'`,
    `COALESCE(ue.end_date, ue.start_date) >= date('now')`,
    `COALESCE(o.visibility, 'public') = 'public'`];
  const params = [];
  if (state) { where.push('ue.state = ?'); params.push(state); }
  if (month) { where.push('substr(ue.start_date, 1, 7) = ?'); params.push(month); }
  if (orgId) { where.push('ue.org_id = ?'); params.push(orgId); }
  if (saved && userId) {
    where.push('ue.id IN (SELECT upcoming_event_id FROM event_shortlists WHERE user_id = ?)');
    params.push(userId);
  }

  let rows = await db.all(`
    SELECT ue.*, o.name AS org_name, o.website AS org_website
    FROM org_upcoming_events ue
    JOIN organizations o ON o.id = ue.org_id
    WHERE ${where.join(' AND ')}
    ORDER BY ue.start_date ASC, o.name ASC
  `, params);

  if (near) {
    for (const r of rows) {
      r.distance = (r.lat != null && r.lng != null)
        ? Math.round(distanceMiles(near.lat, near.lng, r.lat, r.lng)) : null;
    }
    // radius keeps un-geocoded rows visible (distance simply unknown)
    rows = rows.filter(r => r.distance === null || r.distance <= radius);
    // month grouping stays; within a month, closest first
    rows.sort((a, b) => a.start_date.slice(0, 7).localeCompare(b.start_date.slice(0, 7))
      || (a.distance ?? 1e9) - (b.distance ?? 1e9));
  }

  if (userId) {
    const savedRows = await db.all('SELECT upcoming_event_id FROM event_shortlists WHERE user_id = ?', [userId]);
    const savedSet = new Set(savedRows.map(r => r.upcoming_event_id));
    for (const r of rows) r.saved = savedSet.has(r.id);
  }

  return { rows, filters: { state, month, org: orgId, saved, near, radius } };
}

router.get('/dance/events', async (req, res) => {
  const db = await openDb();
  await ensureUpcomingTable(db);

  // the shortlist filter is per-account — send signed-out visitors to login
  if (req.query.saved === '1' && !(req.session && req.session.user)) {
    return res.redirect('/login?redirect=' + encodeURIComponent('/dance/events?saved=1'));
  }

  const { rows, filters } = await loadUpcomingFiltered(db, req);
  const { state, month, org: orgId } = filters;

  // Filter options always come from the full future set, so narrowing one
  // filter never empties the other dropdowns.
  const optionRows = await db.all(`
    SELECT ue.state, substr(ue.start_date, 1, 7) AS month, ue.org_id, o.name AS org_name
    FROM org_upcoming_events ue
    JOIN organizations o ON o.id = ue.org_id
    WHERE ue.status = 'active'
      AND COALESCE(ue.end_date, ue.start_date) >= date('now')
      AND COALESCE(o.visibility, 'public') = 'public'
  `);
  const monthLabel = (m) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const states = [...new Set(optionRows.map(r => r.state).filter(Boolean))].sort();
  const months = [...new Set(optionRows.map(r => r.month))].sort()
    .map(m => ({ value: m, label: monthLabel(m) }));
  const orgOptions = [...new Map(optionRows.map(r => [r.org_id, r.org_name])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  // Group the result rows by month for display.
  const groups = [];
  for (const row of rows) {
    const m = row.start_date.slice(0, 7);
    if (!groups.length || groups[groups.length - 1].month !== m) {
      groups.push({ month: m, label: monthLabel(m), events: [] });
    }
    groups[groups.length - 1].events.push(row);
  }

  const userId = req.session && req.session.user ? req.session.user.id : null;
  const shortlistCount = userId
    ? (await db.get('SELECT COUNT(*) AS n FROM event_shortlists WHERE user_id = ?', [userId])).n
    : 0;

  const lastCheckedRow = await db.get('SELECT MAX(last_seen_at) AS t FROM org_upcoming_events');
  res.render('upcoming_events', {
    groups, states, months, orgOptions,
    filters,
    isLoggedIn: !!userId,
    shortlistCount,
    totalCount: rows.length,
    lastChecked: (lastCheckedRow && lastCheckedRow.t) ? String(lastCheckedRow.t).slice(0, 10) : null,
    pageTitle: 'Upcoming Dance Competitions',
    pageDesc: 'Plan your competition season: upcoming dance competition tour dates by city, state, and organizer.'
  });
});

// Shortlist toggle — any signed-in account (studio owner, parent, dancer).
router.post('/api/upcoming/:id/save', async (req, res) => {
  if (!(req.session && req.session.user)) return res.status(401).json({ error: 'Sign in to save events' });
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
  const db = await openDb();
  await ensureUpcomingTable(db);
  const ev = await db.get(`SELECT id FROM org_upcoming_events WHERE id = ? AND status = 'active'`, [req.params.id]);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const userId = req.session.user.id;
  const existing = await db.get('SELECT id FROM event_shortlists WHERE user_id = ? AND upcoming_event_id = ?', [userId, ev.id]);
  if (existing) await db.run('DELETE FROM event_shortlists WHERE id = ?', [existing.id]);
  else await db.run('INSERT INTO event_shortlists (user_id, upcoming_event_id) VALUES (?, ?)', [userId, ev.id]);
  const count = (await db.get('SELECT COUNT(*) AS n FROM event_shortlists WHERE user_id = ?', [userId])).n;
  res.json({ saved: !existing, count });
});

// Calendar export: the current filtered view (or the shortlist with
// ?saved=1) as an iCalendar file — imports into Google/Apple/Outlook.
router.get('/dance/events.ics', async (req, res) => {
  if (req.query.saved === '1' && !(req.session && req.session.user)) {
    return res.status(401).send('Sign in to export your shortlist');
  }
  const db = await openDb();
  await ensureUpcomingTable(db);
  const { rows } = await loadUpcomingFiltered(db, req);

  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const dateNum = (d) => d.replace(/-/g, '');
  // DTEND is exclusive in iCalendar: all-day events end the day after
  const nextDay = (d) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10).replace(/-/g, '');
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AwardHome//Upcoming Events//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Dance Competitions — AwardHome',
  ];
  for (const ev of rows) {
    const place = [[ev.city, ev.state].filter(Boolean).join(', '), ev.venue].filter(Boolean).join(' — ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:upcoming-${ev.id}@awardhome.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateNum(ev.start_date)}`,
      `DTEND;VALUE=DATE:${nextDay(ev.end_date || ev.start_date)}`,
      `SUMMARY:${esc(`${ev.org_name}: ${ev.name}`)}`,
      place ? `LOCATION:${esc(place)}` : null,
      `DESCRIPTION:${esc('Dates from the organizer\'s published schedule — confirm with the organizer before booking travel.' + (ev.registration_url ? ` Register: ${ev.registration_url}` : ''))}`,
      ev.registration_url ? `URL:${esc(ev.registration_url)}` : null,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="awardhome-events.ics"');
  res.send(lines.filter(Boolean).join('\r\n') + '\r\n');
});

router.get('/dance/org/:slug', async (req, res) => {
  const db = await openDb();
  const org = await db.get(`SELECT * FROM organizations WHERE slug = ?`, [req.params.slug]);
  if (!org) return res.status(404).send('Organization not found');

  // Organizer-objection accommodation: an unlisted/hidden org's page 404s
  // for the public (indistinguishable from not existing — no oracle), but
  // the owner and superadmins still see it, with a banner.
  const orgVisibility = org.visibility || 'public';
  if (orgVisibility !== 'public') {
    const u = req.session && req.session.user;
    const allowed = u && (u.role === 'superadmin' || (org.owner_id && u.id === org.owner_id));
    if (!allowed) return res.status(404).send('Organization not found');
  }

  const stats = await db.get(`
    SELECT COUNT(DISTINCT a.id) AS totalAwards,
           COUNT(DISTINCT a.studio_id) AS totalStudios,
           MIN(e.year) AS firstYear
    FROM events e LEFT JOIN awards a ON a.event_id = e.id
    WHERE e.org_id = ?
  `, [org.id]);

  const events = await db.all(`
    SELECT e.*, COUNT(a.id) AS award_count
    FROM events e LEFT JOIN awards a ON a.event_id = e.id
    WHERE e.org_id = ?
    GROUP BY e.id
    ORDER BY e.year DESC, e.date_string DESC
  `, [org.id]);

  const eventsByYearMap = new Map();
  for (const event of events) {
    const year = event.year || 'Unknown Year';
    if (!eventsByYearMap.has(year)) {
      eventsByYearMap.set(year, []);
    }
    eventsByYearMap.get(year).push(event);
  }

  const groupedData = Array.from(eventsByYearMap, ([year, events]) => ({
    year,
    events
  }));

  const isAdmin = req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin');

  // Org page designs (cutover 2026-08-24): the "Rafters" organizer
  // edition (org_v2) is the default — it doubles as the demo link in
  // invitation letters. ?design=v0 is the classic escape hatch. The
  // extra reach queries below feed only the Rafters template.
  const useClassicDesign = req.query.design === 'v0';
  let raftersExtras = {};
  if (!useClassicDesign) {
    const dancersRow = await db.get(`
      SELECT COUNT(DISTINCT ad.dancer_id) AS count
      FROM award_dancers ad
      JOIN awards a ON ad.award_id = a.id
      JOIN events e ON a.event_id = e.id
      WHERE e.org_id = ?
    `, [org.id]);
    const titlesRow = await db.get(`
      SELECT COUNT(*) AS count
      FROM awards a JOIN events e ON a.event_id = e.id
      WHERE e.org_id = ?
        AND (a.award_type LIKE '%National Grand Champion%' OR a.category LIKE '%National Grand Champion%')
        AND a.is_first_place = 1
    `, [org.id]);
    const yearlySeries = await db.all(`
      SELECT e.year AS year, COUNT(DISTINCT e.id) AS events, COUNT(a.id) AS total,
             SUM(CASE WHEN a.is_first_place = 1 THEN 1 ELSE 0 END) AS firsts
      FROM events e LEFT JOIN awards a ON a.event_id = e.id
      WHERE e.org_id = ? AND e.year IS NOT NULL
      GROUP BY e.year
      ORDER BY CAST(e.year AS INTEGER) ASC
    `, [org.id]);
    const topStudios = await db.all(`
      SELECT s.name, s.unique_id, COUNT(a.id) AS award_count
      FROM awards a
      JOIN studios s ON a.studio_id = s.id
      JOIN events e ON a.event_id = e.id
      WHERE e.org_id = ? AND s.unique_id IS NOT NULL
      GROUP BY s.id
      ORDER BY award_count DESC
      LIMIT 6
    `, [org.id]);
    await ensureUpcomingTable(db);
    const upcomingEvents = await upcomingForOrg(db, org.id);
    raftersExtras = {
      reach: { dancers: (dancersRow && dancersRow.count) || 0, titles: (titlesRow && titlesRow.count) || 0 },
      yearlySeries,
      topStudios,
      upcomingEvents
    };
  }

  res.render(useClassicDesign ? 'org' : 'org_v2', {
    org, orgVisibility, groupedData, stats, isAdmin,
    eventsCount: events.length,
    pageTitle: org.name,
    pageDesc: `${org.name} on AwardHome: ${stats.totalAwards} awards across ${events.length} events since ${stats.firstYear || ''}.`,
    ...raftersExtras
  });
});


// Typeahead search across studios and dancers (hero search box).
// Lives under /dance so the private-beta gate covers it. Rate-limited
// hard: real users type a handful of queries; bulk enumeration of the
// dataset through a 6-result window at 30 req/min is uneconomical.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.SEARCH_RATE_LIMIT, 10) || 30,
  message: { studios: [], dancers: [], error: 'Slow down a little.' }
});

router.get('/dance/api/search', searchLimiter, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ studios: [], dancers: [] });
  const db = await openDb();
  const like = `%${q}%`;

  const studios = await db.all(`
    SELECT s.id, s.unique_id, s.name, COUNT(a.id) AS awards
    FROM studios s LEFT JOIN awards a ON a.studio_id = s.id
    WHERE s.name LIKE ? AND s.status = 'active'
    GROUP BY s.id ORDER BY awards DESC LIMIT 6
  `, [like]);

  const dancers = await db.all(`
    SELECT d.id, d.unique_id, d.name,
      (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS awards,
      (SELECT GROUP_CONCAT(s2.name, ', ') FROM dancer_studios ds
        JOIN studios s2 ON s2.id = ds.studio_id WHERE ds.dancer_id = d.id) AS studios
    FROM dancers d
    WHERE d.name LIKE ?
    ORDER BY awards DESC LIMIT 6
  `, [like]);

  res.json({ studios, dancers });
});

// Admin-only: the full paginated directory is a scrape target (17k studios
// with award counts). Public users find studios via search, leaderboards,
// and the featured section.
router.get('/dance/studios', requireAdmin, async (req, res) => {
  const db = await openDb();

  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const q = req.query.q || '';

  let whereClause = '';
  let queryParams = [];

  if (q) {
    whereClause = 'WHERE s.name LIKE ?';
    queryParams.push(`%${q}%`);
  }

  const countRow = await db.get(`SELECT COUNT(*) as count FROM studios s ${whereClause}`, queryParams);
  const totalStudios = countRow.count;
  const totalPages = Math.ceil(totalStudios / limit);

  const studios = await db.all(`
    SELECT s.*, 
           COUNT(DISTINCT a.id) as total_awards,
           COUNT(DISTINCT a.event_id) as total_events
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    ${whereClause}
    GROUP BY s.id
    ORDER BY s.name ASC
    LIMIT ? OFFSET ?
  `, [...queryParams, limit, offset]);

  res.render('studios', { studios, currentPage: page, totalPages, q, pageTitle: 'Studio Directory' });
});


// GET studio first places
router.get('/dance/studio/:id/first-places', profileLimiter, async (req, res) => {
  const db = await openDb();

  const studio = await db.get('SELECT * FROM studios WHERE unique_id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  req.params.id = studio.id;

  const awards = await db.all(`
    SELECT a.*, e.name as event_name, e.year as event_year, o.name as org_name
    FROM awards a
    JOIN events e ON a.event_id = e.id
    JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ? AND a.is_first_place = 1
    ORDER BY e.year DESC, e.name ASC
  `, [req.params.id]);

  res.render('studio_first_places', {
    studio,
    awards,
    user: req.session ? req.session.user : null
  });
});


router.get('/dance/studio/:id', profileLimiter, async (req, res) => {
  const db = await openDb();

  // Public studio URLs use the non-guessable unique_id (STU-<hex>-slug),
  // never the sequential numeric id — numeric URLs would make the whole
  // dataset enumerable. Resolve once; downstream queries reuse the
  // numeric id via req.params.id.
  const studio = await db.get('SELECT * FROM studios WHERE unique_id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');
  req.params.id = studio.id;

  await db.run('UPDATE studios SET view_count = view_count + 1 WHERE id = ?', [studio.id]);

  let mergedIntoStudio = null;
  if (studio.status === 'merged' && studio.merged_into_id) {
    mergedIntoStudio = await db.get('SELECT id, unique_id, name FROM studios WHERE id = ?', [studio.merged_into_id]);
  }

  const currentYear = new Date().getFullYear();
  
  // 1. Fetch Quick Stats via SQL aggregation
  const statsQuery = `
    SELECT 
      COUNT(*) as totalAwards,
      COUNT(DISTINCT a.event_id) as totalEvents,
      COUNT(CASE WHEN CAST(e.year AS INTEGER) = ? THEN 1 END) as awardsThisYear,
      COUNT(DISTINCT CASE WHEN CAST(e.year AS INTEGER) = ? THEN a.event_id END) as eventsThisYear,
      COUNT(CASE WHEN CAST(e.year AS INTEGER) >= ? THEN 1 END) as awardsPast5Years,
      COUNT(DISTINCT CASE WHEN CAST(e.year AS INTEGER) >= ? THEN a.event_id END) as eventsPast5Years,
      SUM(CASE WHEN a.is_first_place = 1 THEN 1 ELSE 0 END) as firstPlaceCount,
      SUM(CASE WHEN a.is_first_place = 1 AND CAST(e.year AS INTEGER) = ? THEN 1 ELSE 0 END) as firstPlaceCountThisYear,
      SUM(CASE WHEN LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%scholarship%' OR LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%invite%' OR LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%invitation%' THEN 1 ELSE 0 END) as scholarshipCount
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    WHERE a.studio_id = ?
  `;
  const quickStatsRow = await db.get(statsQuery, [currentYear, currentYear, currentYear - 4, currentYear - 4, currentYear, req.params.id]);
  
  const uniqueDancersRow = await db.get(`
    SELECT COUNT(DISTINCT final_dancer) as count FROM (
      SELECT COALESCE(d.unique_id, LOWER(TRIM(d.name))) as final_dancer
      FROM award_dancers ad
      JOIN awards a ON ad.award_id = a.id
      JOIN dancers d ON ad.dancer_id = d.id
      WHERE a.studio_id = ?
      UNION
      SELECT COALESCE(d.unique_id, LOWER(TRIM(d.name))) as final_dancer
      FROM awards a
      JOIN dancers d ON a.dancer_id = d.id
      WHERE a.studio_id = ? AND a.dancer_id IS NOT NULL
    )
  `, [req.params.id, req.params.id]);

  // 2. Fetch Active Years
  const yearsResult = await db.all(`
    SELECT DISTINCT e.year 
    FROM awards a JOIN events e ON a.event_id = e.id 
    WHERE a.studio_id = ? 
    ORDER BY e.year DESC
  `, [req.params.id]);
  
  const yearsActive = yearsResult.map(r => String(r.year));
  const activeYearsStr = yearsActive.length > 0 ?
    (yearsActive.length === 1 ? `${yearsActive[0]}` : `${yearsActive[0]} - ${yearsActive[yearsActive.length - 1]}`)
    : 'None';

  const quickStats = {
    totalAwards: quickStatsRow.totalAwards || 0,
    totalEvents: quickStatsRow.totalEvents || 0,
    activeYearsStr,
    sinceYear: yearsActive.length > 0 ? yearsActive[yearsActive.length - 1] : null,
    awardsThisYear: quickStatsRow.awardsThisYear || 0,
    eventsThisYear: quickStatsRow.eventsThisYear || 0,
    awardsPast5Years: quickStatsRow.awardsPast5Years || 0,
    eventsPast5Years: quickStatsRow.eventsPast5Years || 0,
    firstPlaceCount: quickStatsRow.firstPlaceCount || 0,
    firstPlaceCountThisYear: quickStatsRow.firstPlaceCountThisYear || 0,
    scholarshipCount: quickStatsRow.scholarshipCount || 0,
    uniqueDancersCount: uniqueDancersRow.count || 0
  };

  // 3. Hall Of Fame
  const topHallOfFame = await db.all(`
    SELECT a.*, d.name as dancer_name, d.unique_id, e.name as event_name, e.year as event_year, e.date_string, o.name as org_name, o.logo_url, o.custom_icons
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ? 
    AND (
      a.is_hall_of_fame = 1 OR (
        (a.is_hall_of_fame IS NULL OR a.is_hall_of_fame = 0)
        AND a.is_first_place = 1
        AND (
          LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%scholarship%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%invite%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%title%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%photogenic%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%doy%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%dancer of the year%'
        )
        AND (
          LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%national%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%final%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%grand%' OR
          LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%title%' OR
          LOWER(e.name) LIKE '%national%' OR
          LOWER(e.name) LIKE '%final%'
        )
      )
    )
    ORDER BY a.is_hall_of_fame DESC, e.year DESC, e.date_string DESC
    LIMIT 20
  `, [req.params.id]);
  
  if (topHallOfFame.length > 0) {
    const hofIds = topHallOfFame.map(a => a.id);
    const hofDancers = await db.all(`SELECT ad.award_id, d.name, d.unique_id FROM award_dancers ad JOIN dancers d ON ad.dancer_id = d.id WHERE ad.award_id IN (${hofIds.map(()=>'?').join(',')})`, hofIds);
    const hofMap = {};
    hofDancers.forEach(ad => {
      if(!hofMap[ad.award_id]) hofMap[ad.award_id] = [];
      hofMap[ad.award_id].push({ name: ad.name, unique_id: ad.unique_id });
    });
    topHallOfFame.forEach(a => {
      a.dancers = hofMap[a.id] || (a.dancer_name ? [{ name: a.dancer_name, unique_id: a.unique_id }] : []);
      if (a.custom_icons) { try { a.customIconsObj = JSON.parse(a.custom_icons); } catch(e){} }
    });
  }

  // 4. Orgs History Aggregation
  const orgsRaw = await db.all(`
    SELECT o.id as org_id, o.name as org_name, o.logo_url, e.year, e.id as event_id, e.name as event_name, 
           COUNT(*) as total_awards, 
           SUM(CASE WHEN a.is_first_place = 1 THEN 1 ELSE 0 END) as first_places,
           SUM(CASE WHEN a.is_first_place = 1 AND 
             (
              LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%scholarship%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%invite%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%title%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%photogenic%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%doy%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '') || ' ' || COALESCE(a.performance_name, '')) LIKE '%dancer of the year%'
             ) AND 
             (
              LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%national%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%final%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%grand%' OR
              LOWER(a.category || ' ' || COALESCE(a.award_type, '')) LIKE '%title%' OR
              LOWER(e.name) LIKE '%national%' OR
              LOWER(e.name) LIKE '%final%'
             )
           THEN 1 ELSE 0 END) as major_awards
    FROM awards a
    JOIN events e ON a.event_id = e.id
    JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ?
    GROUP BY o.id, o.name, o.logo_url, e.year, e.id, e.name
  `, [req.params.id]);

  const orgsMap = {};
  for (const row of orgsRaw) {
    if (!orgsMap[row.org_id]) {
      orgsMap[row.org_id] = { id: row.org_id, name: row.org_name, logo_url: row.logo_url, years: {}, total_awards_all_time: 0, first_places_all_time: 0, major_awards_all_time: 0 };
    }
    const org = orgsMap[row.org_id];
    org.total_awards_all_time += row.total_awards;
    org.first_places_all_time += row.first_places;
    org.major_awards_all_time += row.major_awards;

    if (!org.years[row.year]) org.years[row.year] = { total_awards: 0, first_places: 0, major_awards: 0, eventsMap: {} };
    const yr = org.years[row.year];
    yr.total_awards += row.total_awards;
    yr.first_places += row.first_places;
    yr.major_awards += row.major_awards;

    yr.eventsMap[row.event_id] = { name: row.event_name, total_awards: row.total_awards, first_places: row.first_places, major_awards: row.major_awards };
  }

  // 5. Load ONLY the first year's awards for GroupedData initial render
  let groupedData = yearsActive.map((year, idx) => ({
    year,
    events: [],
    isLoaded: idx === 0
  }));

  if (yearsActive.length > 0) {
    const firstYear = yearsActive[0];
    const firstYearAwards = await db.all(`
      SELECT a.*, d.name as dancer_name, d.unique_id, e.name as event_name, e.year as event_year, e.date_string, o.id as org_id, o.name as org_name, o.logo_url, o.custom_icons
      FROM awards a
      LEFT JOIN dancers d ON a.dancer_id = d.id
      LEFT JOIN events e ON a.event_id = e.id
      LEFT JOIN organizations o ON e.org_id = o.id
      WHERE a.studio_id = ? AND e.year = ?
      ORDER BY e.date_string DESC, a.award_type, a.place
    `, [req.params.id, firstYear]);
    
    firstYearAwards.forEach(a => {
      if (a.custom_icons) { try { a.customIconsObj = JSON.parse(a.custom_icons); } catch(e){} }
    });

    const fyIds = firstYearAwards.map(a => a.id);
    if (fyIds.length > 0) {
      const fyDancers = await db.all(`SELECT ad.award_id, d.name, d.unique_id, ad.status FROM award_dancers ad JOIN dancers d ON ad.dancer_id = d.id WHERE ad.award_id IN (${fyIds.map(()=>'?').join(',')})`, fyIds);
      const fyDancerMap = {};
      fyDancers.forEach(ad => {
        if(!fyDancerMap[ad.award_id]) fyDancerMap[ad.award_id] = [];
        fyDancerMap[ad.award_id].push({ name: ad.name, unique_id: ad.unique_id, status: ad.status });
      });
      
      const eventsMap = new Map();
      firstYearAwards.forEach(award => {
        award.dancers = fyDancerMap[award.id] || (award.dancer_name ? [{ name: award.dancer_name, unique_id: award.unique_id }] : []);
        const eventKey = award.event_id;
        if (!eventsMap.has(eventKey)) eventsMap.set(eventKey, { title: formatEventTitle(award.event_name, award.org_name, award.event_year), eventId: award.event_id, awards: [] });
        eventsMap.get(eventKey).awards.push(award);
      });
      groupedData[0].events = Array.from(eventsMap.values());
    }
  }

  let prefs = {};
  if (studio.public_preferences) {
    try { prefs = JSON.parse(studio.public_preferences); } catch (e) { }
  }
  if (Object.keys(prefs).length === 0) {
    prefs = { show_total_awards: true, show_events_attended: true, show_1st_place_finishes: true, show_1st_place_this_year: true, show_past_5_years: true, show_this_year: true };
  }
  studio.prefs = prefs;

  // Fetch Alumni (graduated this year or earlier)
  const alumni = await db.all(`
    SELECT d.id, d.name, d.unique_id, ds.graduation_year, ds.headshot_url, ds.notes
    FROM dancer_studios ds
    JOIN dancers d ON ds.dancer_id = d.id
    WHERE ds.studio_id = ? AND ds.graduation_year <= ?
    ORDER BY ds.graduation_year DESC, d.name ASC
  `, [req.params.id, currentYear]);



  // Format orgsMap into array
  const orgsHistory = Object.values(orgsMap).map(org => {
    Object.keys(org.years).forEach(year => {
      org.years[year].events = Object.values(org.years[year].eventsMap).sort((a, b) => a.name.localeCompare(b.name));
      delete org.years[year].eventsMap;
    });
    return org;
  });
  orgsHistory.sort((a, b) => a.name.localeCompare(b.name));

  // The viewer's own claim on this studio, if any — drives the
  // "verification pending" banner in place of the Claim button.
  let viewerClaimStatus = null;
  if (req.session && req.session.user && !studio.is_claimed) {
    try {
      const claimRow = await db.get(
        'SELECT status FROM studio_claims WHERE studio_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
        [studio.id, req.session.user.id]);
      viewerClaimStatus = claimRow ? claimRow.status : null;
    } catch (e) { /* table missing before first migrate */ }
  }

  // Studio page designs (cutover 2026-08-24): "Rafters" (studio_v2) is
  // the default; ?design=v0 is the classic escape hatch. The extra
  // queries below feed only the Rafters template.
  const useClassicDesign = req.query.design === 'v0';
  let raftersExtras = {};
  if (!useClassicDesign) {
    const titleRows = await db.all(`
      SELECT a.performance_name, a.award_type, a.category, e.year, o.name as org_name
      FROM awards a
      JOIN events e ON a.event_id = e.id
      JOIN organizations o ON e.org_id = o.id
      WHERE a.studio_id = ?
        AND (a.award_type LIKE '%National Grand Champion%' OR a.category LIKE '%National Grand Champion%')
        AND a.is_first_place = 1
      ORDER BY CAST(e.year AS INTEGER) ASC, a.performance_name ASC
    `, [req.params.id]);
    const banners = titleRows.map(r => ({
      year: r.year,
      org: r.org_name,
      piece: r.performance_name,
      division: (r.award_type || r.category || '').replace(/national grand champion/i, '').replace(/\s{2,}/g, ' ').trim()
    }));

    const yearlySeries = await db.all(`
      SELECT e.year as year, COUNT(*) as total,
             SUM(CASE WHEN a.is_first_place = 1 THEN 1 ELSE 0 END) as firsts
      FROM awards a
      JOIN events e ON a.event_id = e.id
      WHERE a.studio_id = ?
      GROUP BY e.year
      ORDER BY CAST(e.year AS INTEGER) ASC
    `, [req.params.id]);

    const topDancers = await db.all(`
      SELECT d.name
      FROM award_dancers ad
      JOIN awards a ON ad.award_id = a.id
      JOIN dancers d ON ad.dancer_id = d.id
      WHERE a.studio_id = ?
      GROUP BY d.id
      ORDER BY COUNT(*) DESC
      LIMIT 8
    `, [req.params.id]);
    const dancerInitials = topDancers.map(d =>
      d.name.trim().split(/\s+/).map(w => w[0]).join('').replace(/[^A-Za-z]/g, '').substring(0, 2).toUpperCase()
    ).filter(Boolean);

    raftersExtras = { banners, yearlySeries, dancerInitials };
  }

  res.render(useClassicDesign ? 'studio' : 'studio_v2', {
    studio, mergedIntoStudio, groupedData, quickStats, hallOfFame: topHallOfFame, alumni, viewerClaimStatus,
    hasAwards: quickStats.totalAwards > 0, orgsHistory,
    pageTitle: studio.name,
    pageDesc: `${studio.name} on AwardHome: ${quickStats.totalAwards} dance awards across ${quickStats.totalEvents} competition events${quickStats.sinceYear ? ' since ' + quickStats.sinceYear : ''}.`,
    ...raftersExtras
  });
});


router.get('/api/studio/:id/year/:year', profileLimiter, async (req, res) => {
  const db = await openDb();

  const studioRow = await db.get('SELECT id FROM studios WHERE unique_id = ?', [req.params.id]);
  if (!studioRow) return res.status(404).send('Studio not found');
  req.params.id = studioRow.id;

  const awards = await db.all(`
    SELECT a.*, d.name as dancer_name, d.unique_id, e.name as event_name, e.year as event_year, e.date_string, o.name as org_name, o.logo_url, o.custom_icons
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    WHERE a.studio_id = ? AND e.year = ?
    ORDER BY e.date_string DESC, a.award_type, a.place
  `, [req.params.id, req.params.year]);

  awards.forEach(a => {
    if (a.custom_icons) {
      try { a.customIconsObj = JSON.parse(a.custom_icons); } catch (e) { }
    }
  });

  const awardDancers = await db.all(`
    SELECT ad.award_id, d.name, d.unique_id, ad.status
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    WHERE ad.award_id IN (SELECT id FROM awards WHERE studio_id = ? AND event_id IN (SELECT id FROM events WHERE year = ?))
  `, [req.params.id, req.params.year]);

  const awardDancersMap = {};
  for (const ad of awardDancers) {
    if (!awardDancersMap[ad.award_id]) awardDancersMap[ad.award_id] = [];
    awardDancersMap[ad.award_id].push({ name: ad.name, unique_id: ad.unique_id, status: ad.status });
  }

  const eventsMap = new Map();
  for (const award of awards) {
    if (awardDancersMap[award.id]) {
      award.dancers = awardDancersMap[award.id];
    } else if (award.dancer_name) {
      award.dancers = [{ name: award.dancer_name, unique_id: award.unique_id }];
    } else {
      award.dancers = [];
    }

    const eventKey = award.event_id;
    if (!eventsMap.has(eventKey)) {
      eventsMap.set(eventKey, {
        title: formatEventTitle(award.event_name, award.org_name, award.event_year),
        eventId: award.event_id,
        awards: []
      });
    }
    eventsMap.get(eventKey).awards.push(award);
  }

  const events = Array.from(eventsMap.values());
  res.render('partials/studio_year_events', { events });
});


router.get('/dancer/:unique_id', profileLimiter, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get(`
    SELECT * FROM dancers WHERE unique_id = ?
  `, [req.params.unique_id]);

  if (!dancer) return res.status(404).send('Dancer not found');

  // Fetch all affiliated studios
  const studios = await db.all(`
    SELECT s.id, s.unique_id, s.name, ds.status 
    FROM dancer_studios ds
    JOIN studios s ON ds.studio_id = s.id
    WHERE ds.dancer_id = ?
  `, [dancer.id]);

  // Attach studios to the dancer object for the view
  dancer.studios = studios;

  const awards = await db.all(`
    SELECT DISTINCT a.*, e.name as event_name, e.year as event_year, o.name as org_name, o.logo_url, o.custom_icons,
      (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) as dancer_count
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    LEFT JOIN award_dancers ad ON a.id = ad.award_id
    WHERE a.dancer_id = ? OR ad.dancer_id = ?
    ORDER BY e.year DESC, a.award_type, a.place
  `, [dancer.id, dancer.id]);

  awards.forEach(a => {
    if (a.custom_icons) {
      try { a.customIconsObj = JSON.parse(a.custom_icons); } catch (e) { }
    }
  });

  const specialClassTypes = ['scholarship', 'special', 'studio', 'invitation'];
  const isSpecialKeyword = (str) => {
    if (!str) return false;
    const lower = str.toLowerCase();
    return lower.includes('scholarship') || lower.includes('invite') || lower.includes('invitation');
  };

  const conventionAwards = awards.filter(a =>
    specialClassTypes.includes(a.award_class) ||
    isSpecialKeyword(a.award_type) ||
    isSpecialKeyword(a.category) ||
    isSpecialKeyword(a.performance_name) ||
    (!a.performance_name && a.dancer_count > 1)
  );
  const performanceAwards = awards.filter(a => !conventionAwards.includes(a));

  const soloAwards = performanceAwards.filter(a => a.dancer_count <= 1 && (!a.category || !a.category.toLowerCase().includes('group')));
  const groupAwards = performanceAwards.filter(a => a.dancer_count > 1 || (a.category && a.category.toLowerCase().includes('group')));

  // Year-first timeline: newest season on top (query is already year DESC,
  // so Map insertion order is correct; undated awards land last), with the
  // original category order (Group, Solo, Special) inside each year.
  const yearOf = (a) => a.event_year || 'Undated';
  const yearsMap = new Map();
  for (const a of awards) {
    const y = yearOf(a);
    if (!yearsMap.has(y)) yearsMap.set(y, { year: y, group: [], solo: [], convention: [] });
  }
  groupAwards.forEach(a => yearsMap.get(yearOf(a)).group.push(a));
  soloAwards.forEach(a => yearsMap.get(yearOf(a)).solo.push(a));
  conventionAwards.forEach(a => yearsMap.get(yearOf(a)).convention.push(a));
  const yearSections = [...yearsMap.values()];

  const cardDesign = await resolveCardDesign(req, db);
  // Feature flags: dark features fetch nothing and render nothing
  let [featureNotes, featurePhotos, featureReactions] = await Promise.all([
    flagOn('thank_you_notes', req), flagOn('award_photos', req), flagOn('reactions', req)]);

  if (featureReactions && awards.length > 0) {
    // Reaction counts + the viewer's own taps, from the separate
    // reactions DB (utils/reactions.js) — merged here, no JOIN.
    try {
      const ids = awards.map(a => a.id);
      const [counts, mine] = await Promise.all([
        countsForAwards(ids), myReactions(ids, readReactorKey(req))]);
      awards.forEach(a => {
        a.reactions = { cheer: 0, love: 0, ...(counts[a.id] || {}), mine: mine[a.id] || [] };
      });
    } catch (e) {
      featureReactions = false; // reactions DB unavailable — cards render without the bar
    }
  }
  if (featureNotes && cardDesign === 'flipbook' && awards.length > 0) {
    // Approved thank-you lines for the flipbook's acknowledgements page.
    // Group cards show every teammate's line, the viewing dancer's first.
    try {
      const ids = awards.map(a => a.id);
      const acks = await db.all(`
        SELECT aa.award_id, aa.dancer_id, aa.message, d.name as dancer_name
        FROM award_acknowledgements aa
        JOIN dancers d ON aa.dancer_id = d.id
        WHERE aa.status = 'approved' AND aa.award_id IN (${ids.map(() => '?').join(',')})
        ORDER BY d.name
      `, ids);
      const ackMap = {};
      for (const row of acks) {
        (ackMap[row.award_id] = ackMap[row.award_id] || []).push(row);
      }
      awards.forEach(a => {
        a.acks = (ackMap[a.id] || []).slice()
          .sort((x, y) => (y.dancer_id === dancer.id) - (x.dancer_id === dancer.id));
      });
    } catch (e) { /* table missing before first migrate — cards render without acks */ }
  }

  if (featurePhotos && cardDesign === 'flipbook' && awards.length > 0) {
    // Approved per-award photos (usually the routine's performance shot).
    // The photo page prefers these over the dancer-level default card photo.
    try {
      const ids = awards.map(a => a.id);
      const photos = await db.all(`
        SELECT award_id, photo_url FROM award_card_photos
        WHERE dancer_id = ? AND status = 'approved' AND award_id IN (${ids.map(() => '?').join(',')})
      `, [dancer.id, ...ids]);
      const photoMap = {};
      photos.forEach(p => { photoMap[p.award_id] = p.photo_url; });
      awards.forEach(a => { a.award_photo_url = photoMap[a.id] || null; });
    } catch (e) { /* table missing before first migrate — fallback photo still shows */ }
  }

  const totalAwardCount = soloAwards.length + groupAwards.length + conventionAwards.length;
  // Dancer page designs (cutover 2026-08-24): Rafters chrome (dancer_v2)
  // is the default; ?design=v0 is the classic escape hatch. Independent
  // of ?card_design= (the award-card variant registry) — the two compose.
  res.render(req.query.design === 'v0' ? 'dancer' : 'dancer_v2', {
    dancer, soloAwards, groupAwards, conventionAwards, yearSections, cardDesign,
    featureNotes, featurePhotos, featureReactions,
    pageTitle: dancer.name,
    pageDesc: `${dancer.name}'s digital trophy case on AwardHome: ${totalAwardCount} dance awards.`
  });
});


// Reaction toggle (cheer/love) on an award card. Flag-gated (404 while
// dark), CSRF-covered by the global middleware, and rate-limited: a
// family tapping through a trophy case is dozens of taps, not hundreds.
const reactLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: parseInt(process.env.REACT_RATE_LIMIT, 10) || 60,
  message: { error: 'Slow down a little.' }
});

router.post('/api/award/:id/react', reactLimiter, async (req, res) => {
  if (!(await flagOn('reactions', req))) return res.status(404).json({ error: 'Not found' });
  const type = req.body && req.body.type;
  if (!REACTION_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown reaction type' });
  const awardId = parseInt(req.params.id, 10);
  if (!Number.isInteger(awardId)) return res.status(400).json({ error: 'Bad award id' });
  const db = await openDb();
  const award = await db.get('SELECT id FROM awards WHERE id = ?', [awardId]);
  if (!award) return res.status(404).json({ error: 'Not found' });
  const result = await toggleReaction(awardId, ensureReactorKey(req, res), type);
  res.json(result);
});

router.get('/dance/event/:id', async (req, res) => {
  if (!req.session || !req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')) {
    return res.status(403).send('Detailed event data is only available to platform administrators.');
  }

  const db = await openDb();
  const event = await db.get(`
    SELECT e.*, o.name as org_name 
    FROM events e
    JOIN organizations o ON e.org_id = o.id
    WHERE e.id = ?
  `, [req.params.id]);

  if (!event) return res.status(404).send('Event not found');

  const awards = await db.all(`
    SELECT a.*, d.name as dancer_name, d.unique_id, s.name as studio_name, s.unique_id as studio_uid
    FROM awards a
    LEFT JOIN dancers d ON a.dancer_id = d.id
    LEFT JOIN studios s ON a.studio_id = s.id
    WHERE a.event_id = ?
    ORDER BY s.name, a.award_type, a.place
  `, [req.params.id]);

  const awardDancers = await db.all(`
    SELECT ad.award_id, d.name, d.unique_id
    FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id
    WHERE ad.award_id IN (SELECT id FROM awards WHERE event_id = ?)
  `, [req.params.id]);

  const awardDancersMap = {};
  for (const ad of awardDancers) {
    if (!awardDancersMap[ad.award_id]) awardDancersMap[ad.award_id] = [];
    awardDancersMap[ad.award_id].push({ name: ad.name, unique_id: ad.unique_id });
  }

  for (const award of awards) {
    if (awardDancersMap[award.id]) {
      award.dancers = awardDancersMap[award.id];
    } else if (award.dancer_name) {
      award.dancers = [{ name: award.dancer_name, unique_id: award.unique_id }];
    } else {
      award.dancers = [];
    }
  }

  // Group by studio
  const studiosMap = new Map();
  for (const award of awards) {
    const studioKey = award.studio_name || 'Unknown Studio';
    if (!studiosMap.has(studioKey)) {
      studiosMap.set(studioKey, { studioId: award.studio_uid, awards: [] });
    }
    studiosMap.get(studioKey).awards.push(award);
  }

  const groupedAwards = Array.from(studiosMap, ([studioName, data]) => ({
    studioName,
    studioId: data.studioId,
    eventAwards: data.awards
  }));

  res.render('event', { event, groupedAwards });
});

module.exports = router;
