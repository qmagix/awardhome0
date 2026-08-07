const express = require('express');
const router = express.Router();
const { openDb } = require('../../database');
const { logStudioActivity } = require('../../utils/activity');
const { cached } = require('../../utils/cache');
const { formatEventTitle } = require('../../utils/format');
const { unsubscribeToken } = require('../../utils/invites');
const { BASE_URL } = require('../../config');
const path = require('path');


// Public Widget Iframe Route
router.get('/widget/studio/:id', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.removeHeader('X-Frame-Options');
  logStudioActivity(req.params.id, 'widget_embed', { dedupMinutes: 1440 });

  const db = await openDb();
  const studio = await db.get('SELECT name, logo_url FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

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


// One-click unsubscribe from invite emails (HMAC-signed, no login needed)
router.get('/unsubscribe', async (req, res) => {
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
  if (req.session.user) return res.redirect('/dance');
  res.sendFile(path.join(__dirname, '..', '..', 'landing', 'index.html'));
});


// Legacy public URLs → /dance namespace (301 so bookmarks and crawlers follow)
router.get(['/studios', '/studio/:id', '/studio/:id/first-places', '/org/:slug', '/event/:id'],
  (req, res) => res.redirect(301, '/dance' + req.originalUrl));

// Homepage data is identical for every visitor and expensive to compute
// (7 aggregations over ~900k awards) — cache it for 5 minutes. Featured
// changes invalidate the key (see utils/featured.js).
router.get('/dance', async (req, res) => {
  const data = await cached('dance-home', 5 * 60 * 1000, async () => {
  const db = await openDb();

  const featuredStudios = await db.all(`
    SELECT s.id, s.name, COUNT(DISTINCT a.id) as total_awards
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
    SELECT s.id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    WHERE s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 100
  `);

  const topStudiosThisYear = await db.all(`
    SELECT s.id, s.name, COUNT(a.id) as total_awards
    FROM studios s
    LEFT JOIN awards a ON s.id = a.studio_id
    LEFT JOIN events e ON a.event_id = e.id
    WHERE e.year = (SELECT MAX(year) FROM events) AND s.id NOT IN (${excludeIds.join(',')})
    GROUP BY s.id
    ORDER BY total_awards DESC
    LIMIT 100
  `);

  const topStudiosFirstPlaceThisYear = await db.all(`
    SELECT s.id, s.name, COUNT(a.id) as total_awards
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
    SELECT d.id, d.unique_id, d.name, d.is_claimed, COUNT(ad.id) as total_awards
    FROM dancers d
    JOIN award_dancers ad ON d.id = ad.dancer_id
    JOIN awards a ON ad.award_id = a.id
    GROUP BY d.id
    ORDER BY total_awards DESC
    LIMIT 500
  `);

  const topDancersThisYear = await db.all(`
    SELECT d.id, d.unique_id, d.name, d.is_claimed, COUNT(ad.id) as total_awards
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
    SELECT d.id, d.unique_id, d.name, d.is_claimed, COUNT(ad.id) as total_awards
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
    SELECT o.id, o.name, o.slug, o.data_since, COUNT(e.id) as event_count
    FROM organizations o
    LEFT JOIN events e ON o.id = e.org_id
    GROUP BY o.id
    ORDER BY o.name
  `);

  return { featuredStudios, topStudios, topStudiosThisYear, topStudiosFirstPlaceThisYear, topDancers, topDancersThisYear, topDancersFirstPlaceThisYear, orgs };
  });

  const { featuredStudios, topStudios, topStudiosThisYear, topStudiosFirstPlaceThisYear, topDancers, topDancersThisYear, topDancersFirstPlaceThisYear, orgs } = data;
  const isAdmin = req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin');

  if (isAdmin) {
    res.render('index_admin', { featuredStudios, topStudios, topStudiosThisYear, topStudiosFirstPlaceThisYear, topDancers, topDancersThisYear, topDancersFirstPlaceThisYear, orgs });
  } else {
    res.render('index', { featuredStudios, topStudios, topStudiosThisYear, topStudiosFirstPlaceThisYear, topDancers, topDancersThisYear, topDancersFirstPlaceThisYear, orgs });
  }
});


// Public organization showcase: branding + stats + event history. Per-event
// award detail stays admin-only (the event pages keep their gate).
router.get('/dance/org/:slug', async (req, res) => {
  const db = await openDb();
  const org = await db.get(`SELECT * FROM organizations WHERE slug = ?`, [req.params.slug]);
  if (!org) return res.status(404).send('Organization not found');

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
  res.render('org', {
    org, groupedData, stats, isAdmin,
    eventsCount: events.length,
    pageTitle: org.name,
    pageDesc: `${org.name} on AwardHome: ${stats.totalAwards} awards across ${events.length} events since ${stats.firstYear || ''}.`
  });
});


router.get('/dance/studios', async (req, res) => {
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
router.get('/dance/studio/:id/first-places', async (req, res) => {
  const db = await openDb();

  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

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


router.get('/dance/studio/:id', async (req, res) => {
  const db = await openDb();

  await db.run('UPDATE studios SET view_count = view_count + 1 WHERE id = ?', [req.params.id]);

  const studio = await db.get(`SELECT * FROM studios WHERE id = ?`, [req.params.id]);
  if (!studio) return res.status(404).send('Studio not found');

  let mergedIntoStudio = null;
  if (studio.status === 'merged' && studio.merged_into_id) {
    mergedIntoStudio = await db.get('SELECT id, name FROM studios WHERE id = ?', [studio.merged_into_id]);
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

  res.render('studio', {
    studio, mergedIntoStudio, groupedData, quickStats, hallOfFame: topHallOfFame, alumni,
    hasAwards: quickStats.totalAwards > 0, orgsHistory,
    pageTitle: studio.name,
    pageDesc: `${studio.name} on AwardHome: ${quickStats.totalAwards} dance awards across ${quickStats.totalEvents} competition events${quickStats.sinceYear ? ' since ' + quickStats.sinceYear : ''}.`
  });
});


router.get('/api/studio/:id/year/:year', async (req, res) => {
  const db = await openDb();

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


router.get('/dancer/:unique_id', async (req, res) => {
  const db = await openDb();
  const dancer = await db.get(`
    SELECT * FROM dancers WHERE unique_id = ?
  `, [req.params.unique_id]);

  if (!dancer) return res.status(404).send('Dancer not found');

  // Fetch all affiliated studios
  const studios = await db.all(`
    SELECT s.id, s.name, ds.status 
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

  const totalAwardCount = soloAwards.length + groupAwards.length + conventionAwards.length;
  res.render('dancer', {
    dancer, soloAwards, groupAwards, conventionAwards, yearSections,
    pageTitle: dancer.name,
    pageDesc: `${dancer.name}'s digital trophy case on AwardHome: ${totalAwardCount} dance awards.`
  });
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
    SELECT a.*, d.name as dancer_name, d.unique_id, s.name as studio_name
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
      studiosMap.set(studioKey, { studioId: award.studio_id, awards: [] });
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
