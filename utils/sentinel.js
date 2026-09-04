// Hourly public-page sentinel — Layer 2 of the render-bug defense.
//
// Probes THIS instance's public pages for one REAL entity per interesting
// data stratum (approved-coin org, acks, photos, collab studio, ...) and
// alerts when any page 5xxes. Because strata are QUERIES over live data,
// coverage tracks reality automatically: the day the first org coin is
// approved, the coin stratum starts returning a dancer and that render
// path becomes guarded — no mock tenant, no test rows, no cron pollution.
//
// Complements (not replaces):
//   - scripts/sweep_public_pages.js  — pre-deploy, adversarial DB, broad
//   - scripts/audit_get_routes.js    — pre-deploy, every route, authed
//   - Sentry                         — reactive catch-all
//
// Wiring: cron in server.js, gated by ENABLE_SENTINEL=true (prod only).
// Manual run: node utils/sentinel.js  (prints per-URL status, sends no
// email unless something actually fails).
const { openDb } = require('../database');
const { PORT, BETA_MODE, BETA_KEY } = require('../config');

const BASE = `http://localhost:${PORT}`;

// One cheap query per stratum; each returns a path or null (stratum empty).
// Keep these indexed/LIMIT 1 — they run hourly on the live DB.
const STRATA = [
  { name: 'dancer:coin-org', sql: `
      SELECT d.unique_id FROM organizations o
      JOIN events e ON e.org_id = o.id
      JOIN awards a ON a.event_id = e.id
      JOIN award_dancers ad ON ad.award_id = a.id
      JOIN dancers d ON d.id = ad.dancer_id
      WHERE d.suppressed_at IS NULL
        AND o.custom_icons LIKE '%logo_approved":true%' LIMIT 1`,
    path: v => `/dancer/${v}` },
  { name: 'dancer:approved-ack', sql: `
      SELECT d.unique_id FROM award_acknowledgements aa
      JOIN dancers d ON d.id = aa.dancer_id
      WHERE d.suppressed_at IS NULL AND aa.status = 'approved' LIMIT 1`,
    path: v => `/dancer/${v}` },
  { name: 'dancer:approved-photo', sql: `
      SELECT d.unique_id FROM award_card_photos p
      JOIN dancers d ON d.id = p.dancer_id
      WHERE d.suppressed_at IS NULL AND p.status = 'approved' LIMIT 1`,
    path: v => `/dancer/${v}` },
  { name: 'dancer:hidden-card', sql: `
      SELECT d.unique_id FROM dancer_card_hidden h
      JOIN dancers d ON d.id = h.dancer_id
      WHERE d.suppressed_at IS NULL LIMIT 1`,
    path: v => `/dancer/${v}` },
  { name: 'dancer:default-photo', sql: `
      SELECT unique_id FROM dancers
      WHERE suppressed_at IS NULL
        AND card_photo_url IS NOT NULL AND card_photo_status = 'approved' LIMIT 1`,
    path: v => `/dancer/${v}` },
  { name: 'dancer:sampled', sql: `
      SELECT d.unique_id FROM dancers d
      JOIN award_dancers ad ON ad.dancer_id = d.id
      WHERE d.suppressed_at IS NULL
        AND d.id = (SELECT dancer_id FROM award_dancers
                    LIMIT 1 OFFSET ABS(RANDOM()) % 10000)
      LIMIT 1`,
    path: v => `/dancer/${v}` },
  { name: 'studio:with-awards', sql: `
      SELECT s.unique_id FROM studios s
      WHERE s.id = (SELECT studio_id FROM awards
                    WHERE studio_id IS NOT NULL
                    LIMIT 1 OFFSET ABS(RANDOM()) % 10000)
      LIMIT 1`,
    path: v => `/dance/studio/${v}` },
  { name: 'studio:collab', sql: `
      SELECT unique_id FROM studios WHERE name LIKE '% & %' LIMIT 1`,
    path: v => `/dance/studio/${v}` },
  // Orgs rotate by hour so every org page gets probed across the day.
  { name: 'org:rotating', sql: `
      SELECT slug FROM organizations WHERE slug IS NOT NULL ORDER BY id`,
    pick: rows => rows.length ? rows[new Date().getHours() % rows.length] : null,
    path: v => `/dance/org/${v}` },
];

const FIXED = ['/dance', '/healthz'];

// Failure memory: alert only when the failing set CHANGES, so a persistent
// breakage emails once (plus once on recovery), not 24 times a day.
let lastFailKey = '';

async function runSentinel() {
  const db = await openDb();
  const targets = [];
  for (const s of STRATA) {
    try {
      const rows = await db.all(s.sql);
      const v = s.pick ? s.pick(rows.map(r => Object.values(r)[0]))
                       : (rows[0] && Object.values(rows[0])[0]);
      if (v) targets.push({ name: s.name, url: s.path(v) });
    } catch (e) {
      console.error(`[sentinel] stratum ${s.name} query failed:`, e.message);
    }
  }
  FIXED.forEach(u => targets.push({ name: 'surface', url: u }));

  const failures = [];
  let skipped = 0;
  for (const t of targets) {
    const sep = t.url.includes('?') ? '&' : '?';
    const url = BASE + t.url + (BETA_MODE && BETA_KEY ? `${sep}beta=${encodeURIComponent(BETA_KEY)}` : '');
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status === 429) { skipped++; continue; }     // rate limiter, not a render bug
      if (r.status >= 500) failures.push(`${r.status} ${t.name} ${t.url}`);
    } catch (e) {
      failures.push(`FETCH-ERR ${t.name} ${t.url} (${e.message})`);
    }
  }

  // Abuse watch: mass roster/award attachment by a single studio account
  // (a rogue owner could scrape public dancer IDs and bulk-attach). Pure
  // queries over existing provenance — alert-first, humans decide freezes
  // (legit bulk flows like group-dancers paste-a-list make auto-suspend
  // too trigger-happy).
  try {
    const linkBursts = await db.all(`
      SELECT s.name, s.id, COUNT(*) AS n FROM award_dancers ad
      JOIN awards a ON a.id = ad.award_id
      JOIN studios s ON s.id = a.studio_id
      WHERE ad.source = 'studio_owner' AND ad.created_at >= datetime('now', '-1 day')
      GROUP BY s.id HAVING n > 200`);
    const rosterBursts = await db.all(`
      SELECT s.name, s.id, COUNT(*) AS n FROM dancer_studios ds
      JOIN studios s ON s.id = ds.studio_id
      WHERE ds.created_at >= datetime('now', '-1 day') AND s.is_claimed = 1
      GROUP BY s.id HAVING n > 100`);
    for (const b of linkBursts) failures.push(`ABUSE-WATCH award-links ${b.n}/24h by studio #${b.id} "${b.name}"`);
    for (const b of rosterBursts) failures.push(`ABUSE-WATCH roster-adds ${b.n}/24h at studio #${b.id} "${b.name}"`);
  } catch (e) { console.error('[sentinel] abuse-watch query failed:', e.message); }

  const failKey = failures.slice().sort().join('|');
  const changed = failKey !== lastFailKey;
  console.log(`[sentinel] ${targets.length} probed, ${failures.length} failing, ${skipped} rate-limited${failures.length ? ':\n  ' + failures.join('\n  ') : ''}`);

  if (changed) {
    const wasFailing = !!lastFailKey;
    lastFailKey = failKey;
    if (failures.length || wasFailing) {
      const subject = failures.length
        ? `[AwardHome sentinel] ${failures.length} page(s) failing`
        : '[AwardHome sentinel] recovered — all pages healthy';
      const body = failures.length
        ? `<p>The hourly page sentinel found failing renders:</p><pre>${failures.join('\n')}</pre><p>Each line is a real entity sampled from live data. Check Sentry for stack traces.</p>`
        : '<p>All sentinel pages are rendering again.</p>';
      try {
        const { getReviewerEmails } = require('./reviewers');
        const { sendEmail } = require('./mailer');
        for (const to of await getReviewerEmails()) {
          await sendEmail({ to, subject, html: body });
        }
      } catch (e) {
        console.error('[sentinel] alert email failed:', e.message);
      }
      if (failures.length && process.env.SENTRY_DSN) {
        try { require('@sentry/node').captureMessage(`Sentinel failures:\n${failures.join('\n')}`, 'error'); } catch (e) { /* noop */ }
      }
    }
  }
  return { probed: targets.length, failures };
}

module.exports = { runSentinel };

if (require.main === module) {
  runSentinel().then(r => process.exit(r.failures.length ? 1 : 0))
    .catch(e => { console.error(e); process.exit(1); });
}
