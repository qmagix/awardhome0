// /api/v1/partner — dancer-award lookups for vetted partner organizations
// (schools verifying an applicant's competition record).
//
// MOUNT POSITION IS PART OF THE CONTRACT, same argument as /api/v1/mobile:
// after express.json(), BEFORE the session store, CSRF, and the beta gate.
// A partner key is a bearer credential — nothing ambient for a cross-site
// request to ride — so CSRF does not apply, and mounting before the session
// store means this API never issues a cookie (asserted by test/api_partner.js).
//
// TWO ENDPOINTS, AND DELIBERATELY NO MORE:
//
//   GET /dancers?name=&studio=          exact-match disambiguation
//   GET /dancers/:uniqueId/awards       the detail record
//
// The partner must already KNOW a name and a studio; this API confirms and
// details, it never browses. No prefix search, no roster listing, no
// pagination over the corpus — that single constraint is what keeps a
// lookup service for children's records from being a dataset-export tool.
// The corpus is public page-by-page; what a partner buys is structure, not
// reach the public lacks.
//
// EVERY QUERY IS AUDITED append-only (utils/partnerAuth.js): which key,
// what was asked, which dancer ids came back. Per-key daily quotas are
// counted from that same log. Data visibility is exactly the public
// dancer page: suppressed dancers read as nonexistent, hide_from_search is
// honored in search, owner-hidden cards are filtered, and every award
// carries its verification_status so a partner can weigh provenance.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { openDb } = require('../../database');
const { requirePartnerKey, usedToday, logQuery } = require('../../utils/partnerAuth');
const { notSuppressedSql } = require('../../utils/suppression');
const { studioDisplayNameSql } = require('../../utils/independents');
const { resolveStudio } = require('../../utils/resolveStudio');
const { formatPlacement } = require('../../utils/format');
const { flagOn } = require('../../utils/featureFlags');
const openapi = require('../../docs/openapi_partner.json');

const fail = (res, status, error, message) => res.status(status).json({ error, message });

router.use(express.json({ limit: '64kb' }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Deliberately NO CORS headers: partners are servers. A browser-based
// integration would put the key in client-side code, which is exactly the
// deployment shape this API refuses to encourage.

// The published contract, served from the app so it ships with the code
// that implements it. Public like the mobile one — it is documentation.
router.get('/openapi.json', (req, res) => res.json(openapi));

// Ships dark; a superadmin releases it at /admin/features.
router.use(async (req, res, next) => {
  if (!(await flagOn('partner_api', req))) return fail(res, 404, 'not_found', 'Not available.');
  next();
});

router.use(requirePartnerKey);

// Burst ceiling per key, on top of the daily quota. A partner checking
// applicants does tens of lookups a day; sixty a minute is generous.
router.use(rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => 'pk' + req.partnerKey.id,
  handler: (req, res) => fail(res, 429, 'rate_limited', 'Too many requests. Please slow down.'),
}));

// Daily quota, counted from the audit log so the ledger IS the record.
// Exceeded requests are logged too (status quota_exceeded) but do not
// consume quota — tomorrow starts clean.
router.use(async (req, res, next) => {
  const used = await usedToday(req.partnerKey.id);
  if (used >= req.partnerKey.daily_quota) {
    await logQuery(req.partnerKey.id, {
      endpoint: req.path, status: 'quota_exceeded',
      queryName: String(req.query.name || '').slice(0, 200) || null,
    });
    return fail(res, 429, 'quota_exceeded',
      `Daily quota of ${req.partnerKey.daily_quota} lookups reached. Quotas reset at midnight UTC; contact AwardHome if your volume has grown.`);
  }
  next();
});

const foldName = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Step 1: disambiguation. Exact name at a named studio; same-name dancers
// come back as a list of minimal summaries — enough to tell two children
// apart (seasons active, award count), NOT the full record. The partner
// commits to one unique_id before any detail is served, which also gives
// the audit log a clean "they specifically requested this child" row.
router.get('/dancers', async (req, res) => {
  const name = foldName(req.query.name);
  const studioName = foldName(req.query.studio);
  if (!name || !studioName) {
    return fail(res, 400, 'invalid', 'Both name and studio are required — this API confirms dancers you already know, it does not browse.');
  }

  const db = await openDb();
  // Tolerant of the spelling variance real paperwork contains, but never
  // creating: an unknown studio is an empty result, not a new row.
  const studio = await resolveStudio(db, studioName, { create: false });
  if (!studio.id) {
    await logQuery(req.partnerKey.id, {
      endpoint: '/dancers', queryName: name, queryStudio: studioName,
      resultCount: 0, status: 'studio_not_found',
    });
    return res.json({ studio_matched: false, dancers: [] });
  }

  const dancers = await db.all(`
    SELECT d.unique_id, d.name, d.is_claimed,
      (SELECT COUNT(*) FROM award_dancers ad WHERE ad.dancer_id = d.id) AS award_count,
      (SELECT MIN(CAST(e.year AS INTEGER)) FROM events e WHERE e.id IN (
        SELECT a.event_id FROM awards a JOIN award_dancers ad2 ON ad2.award_id = a.id WHERE ad2.dancer_id = d.id
        UNION SELECT a2.event_id FROM awards a2 WHERE a2.dancer_id = d.id)) AS first_year,
      (SELECT MAX(CAST(e.year AS INTEGER)) FROM events e WHERE e.id IN (
        SELECT a.event_id FROM awards a JOIN award_dancers ad3 ON ad3.award_id = a.id WHERE ad3.dancer_id = d.id
        UNION SELECT a2.event_id FROM awards a2 WHERE a2.dancer_id = d.id)) AS last_year,
      (SELECT GROUP_CONCAT(${studioDisplayNameSql('s2')}, ', ') FROM dancer_studios ds2
        JOIN studios s2 ON s2.id = ds2.studio_id WHERE ds2.dancer_id = d.id) AS studios
    FROM dancers d
    JOIN dancer_studios ds ON ds.dancer_id = d.id
    WHERE ds.studio_id = ?
      AND LOWER(TRIM(d.name)) = LOWER(?)
      AND COALESCE(d.hide_from_search, 0) = 0
      AND ${notSuppressedSql('d')}
    ORDER BY award_count DESC`, [studio.id, name]);

  await logQuery(req.partnerKey.id, {
    endpoint: '/dancers', queryName: name, queryStudio: studioName,
    dancerUniqueIds: dancers.map(d => d.unique_id),
    resultCount: dancers.length, status: 'ok',
  });
  res.json({ studio_matched: true, dancers });
});

// Step 2: the record, by unique_id ONLY. Numeric ids are refused outright —
// the platform decided sequential ids must never resolve publicly (they are
// an enumeration oracle; see the studio-URL rule in CLAUDE.md), and a
// partner credential does not reopen that door.
router.get('/dancers/:uniqueId/awards', async (req, res) => {
  const ref = String(req.params.uniqueId || '');
  if (/^\d+$/.test(ref)) {
    return fail(res, 404, 'not_found', 'Dancers are addressed by unique_id, not numeric id.');
  }
  const db = await openDb();
  const dancer = await db.get(
    `SELECT id, unique_id, name, is_claimed FROM dancers
     WHERE unique_id = ? AND ${notSuppressedSql('dancers')}`, [ref]);
  if (!dancer) {
    await logQuery(req.partnerKey.id, {
      endpoint: '/dancers/:uniqueId/awards', dancerUniqueIds: [ref],
      resultCount: 0, status: 'not_found',
    });
    return fail(res, 404, 'not_found', 'No such dancer.');
  }

  // The same visibility the public trophy case has: both link paths,
  // owner-hidden cards filtered, verification_status included so the
  // partner can weigh a family-submitted entry differently from a
  // scraped-and-corroborated one.
  const awards = await db.all(`
    SELECT DISTINCT a.id, a.place, a.award_class, a.performance_name, a.award_type,
           a.category, a.age_division, a.verification_status, a.is_self_added,
           e.name AS event_name, e.year AS event_year, o.name AS org_name,
           ${studioDisplayNameSql('s')} AS studio_name,
           (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) AS dancer_count
    FROM awards a
    LEFT JOIN events e ON e.id = a.event_id
    LEFT JOIN organizations o ON o.id = e.org_id
    LEFT JOIN studios s ON s.id = a.studio_id
    LEFT JOIN award_dancers ad ON ad.award_id = a.id
    WHERE (a.dancer_id = ? OR ad.dancer_id = ?)
      AND NOT EXISTS (SELECT 1 FROM dancer_card_hidden h WHERE h.award_id = a.id AND h.dancer_id = ?)
    ORDER BY CAST(IFNULL(e.year, 0) AS INTEGER) DESC, a.id DESC`,
    [dancer.id, dancer.id, dancer.id]);
  awards.forEach(a => { a.place_display = formatPlacement(a); });

  await logQuery(req.partnerKey.id, {
    endpoint: '/dancers/:uniqueId/awards', dancerUniqueIds: [dancer.unique_id],
    resultCount: awards.length, status: 'ok',
  });
  res.json({
    dancer: { unique_id: dancer.unique_id, name: dancer.name, is_claimed: !!dancer.is_claimed },
    awards,
  });
});

// JSON to the last byte, like the mobile API: a partner's integration
// cannot parse an HTML error page.
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[api/v1/partner]', err);
  fail(res, 500, 'server_error', 'Something went wrong.');
});

module.exports = router;
