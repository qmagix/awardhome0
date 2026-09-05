// Launch-day SEO: robots.txt + sitemap.xml (TODO "Launch-day SEO", 2026-09-04).
//
// The public directory is admin-only by design (it was a scrape target), so
// once BETA_MODE lifts the sitemap IS the crawl path — how a family
// googling their dancer's name finds the trophy case.
//
// SELF-ARMING. While the beta gate is active, robots.txt answers
// "Disallow: /" (never invite an index of a password wall) and the sitemap
// files 404. The moment BETA_MODE lifts, robots.txt flips to allow and the
// sitemaps go live — launch needs no extra step here.
//
// WHAT'S LISTED. Studio pages (active, real — merged rows and independents'
// synthetic studios excluded) and dancer pages (award-holding, minus
// safety-suppressed and hide_from_search dancers), plus a handful of core
// pages. Org pages are deliberately ABSENT: org data stays low-profile
// until the org partners (the homepage-card rule), and a sitemap entry is
// promotion. Listing dancer URLs is a considered trade: the unique_id URLs
// are already discoverable one-by-one through search, findability is the
// growth loop, and bulk fetching still meets the profile rate limiter —
// the sitemap hands a crawler the map, not a free ride.
//
// SHAPE. /sitemap.xml is a sitemap INDEX pointing at /sitemaps/<name>.xml
// pages of 10,000 URLs (the protocol caps a file at 50k; small pages keep
// responses ~1MB). Counts and pages are cached (stale-while-revalidate) —
// the corpus changes on the weekly import, so 6h staleness is free.
const express = require('express');
const router = express.Router();
const { openDb } = require('../database');
const { cached } = require('../utils/cache');
const { BASE_URL, BETA_MODE, BETA_KEY } = require('../config');
const { notSuppressedSql } = require('../utils/suppression');

const PAGE = 10000;
const TTL = 6 * 60 * 60 * 1000;

const betaGateActive = () => !!(BETA_MODE && BETA_KEY);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const STUDIO_WHERE = `(status IS NULL OR status != 'merged') AND COALESCE(is_independent, 0) = 0`;
const DANCER_WHERE = `${notSuppressedSql('d')} AND COALESCE(d.hide_from_search, 0) = 0
      AND EXISTS (SELECT 1 FROM award_dancers ad WHERE ad.dancer_id = d.id)`;

async function counts() {
  return cached('sitemap:counts', TTL, async () => {
    const db = await openDb();
    const s = await db.get(`SELECT COUNT(*) AS n FROM studios WHERE ${STUDIO_WHERE}`);
    const d = await db.get(`SELECT COUNT(*) AS n FROM dancers d WHERE ${DANCER_WHERE}`);
    return { studios: s.n, dancers: d.n };
  });
}

const urlset = (paths) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  paths.map(p => `  <url><loc>${esc(BASE_URL + p)}</loc></url>`).join('\n') +
  '\n</urlset>\n';

function sendXml(res, body) {
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(body);
}

router.get('/robots.txt', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  if (betaGateActive()) return res.send('User-agent: *\nDisallow: /\n');
  res.send('User-agent: *\nAllow: /\n\nSitemap: ' + BASE_URL + '/sitemap.xml\n');
});

// The crawl surface does not exist while the beta gate stands. SCOPED to
// the sitemap paths explicitly: this router is mounted at the app root, so
// a bare router.use() here would 404 every request in the app the moment
// BETA_MODE is armed — which is exactly what took prod down on the first
// deploy of this file (2026-09-05; smoke runs with BETA_MODE=false and
// never sees the armed state).
router.use(['/sitemap.xml', '/sitemaps'], (req, res, next) => {
  if (betaGateActive()) return res.status(404).send('Not found');
  next();
});

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const { studios, dancers } = await counts();
    const files = ['/sitemaps/core.xml'];
    for (let i = 1; i <= Math.max(1, Math.ceil(studios / PAGE)); i++) files.push(`/sitemaps/studios-${i}.xml`);
    for (let i = 1; i <= Math.max(1, Math.ceil(dancers / PAGE)); i++) files.push(`/sitemaps/dancers-${i}.xml`);
    sendXml(res,
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      files.map(f => `  <sitemap><loc>${esc(BASE_URL + f)}</loc></sitemap>`).join('\n') +
      '\n</sitemapindex>\n');
  } catch (e) { next(e); }
});

router.get('/sitemaps/core.xml', (req, res) => {
  sendXml(res, urlset(['/', '/dance', '/dance/events', '/partners',
    '/faq/dancer', '/faq/admin', '/faq/organizer']));
});

router.get('/sitemaps/studios-:n.xml', async (req, res, next) => {
  try {
    const n = parseInt(req.params.n, 10);
    if (!(n >= 1 && n <= 1000)) return res.status(404).send('Not found');
    const rows = await cached(`sitemap:studios:${n}`, TTL, async () => {
      const db = await openDb();
      return db.all(
        `SELECT unique_id FROM studios WHERE ${STUDIO_WHERE}
         ORDER BY id LIMIT ${PAGE} OFFSET ${(n - 1) * PAGE}`);
    });
    if (!rows.length) return res.status(404).send('Not found');
    sendXml(res, urlset(rows.map(r => `/dance/studio/${r.unique_id}`)));
  } catch (e) { next(e); }
});

router.get('/sitemaps/dancers-:n.xml', async (req, res, next) => {
  try {
    const n = parseInt(req.params.n, 10);
    if (!(n >= 1 && n <= 1000)) return res.status(404).send('Not found');
    const rows = await cached(`sitemap:dancers:${n}`, TTL, async () => {
      const db = await openDb();
      return db.all(
        `SELECT d.unique_id FROM dancers d WHERE ${DANCER_WHERE}
         ORDER BY d.id LIMIT ${PAGE} OFFSET ${(n - 1) * PAGE}`);
    });
    if (!rows.length) return res.status(404).send('Not found');
    sendXml(res, urlset(rows.map(r => `/dancer/${r.unique_id}`)));
  } catch (e) { next(e); }
});

module.exports = router;
