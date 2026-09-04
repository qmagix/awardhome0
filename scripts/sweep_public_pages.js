// Data-state-stratified public-page sweep — catches the "rare data state x
// shared render path" bug class (e.g. the approved-coin colophon 500 that a
// single-entity route audit can never hit). Renders pages for entities in
// EVERY interesting data state and reports 5xx.
//
// Usage (run against a THROWAWAY DB copy with worst-case states forced):
//   cp database.sqlite /tmp/sweep.sqlite   # + -wal/-shm, then checkpoint
//   sqlite3 /tmp/sweep.sqlite "UPDATE award_acknowledgements SET status='approved';
//     UPDATE award_card_photos SET status='approved';
//     UPDATE dancers SET card_photo_status='approved' WHERE card_photo_url IS NOT NULL;
//     -- approve a coin on a big org with a logo; corrupt another org's JSON:
//     UPDATE organizations SET custom_icons=json_set(COALESCE(NULLIF(custom_icons,''),'{}'),
//       '$.logo_approved', json('true'), '$.colophon_message','QA \"msg\" & <3')
//       WHERE logo_url IS NOT NULL AND id=(...biggest org...);
//     UPDATE organizations SET custom_icons='{corrupt' WHERE id=(...another...);"
//   DB_PATH=/tmp/sweep.sqlite PORT=3011 BETA_MODE=false PROFILE_RATE_LIMIT=50000 node server.js &
//   DB_PATH=/tmp/sweep.sqlite SWEEP_BASE=http://localhost:3011 node scripts/sweep_public_pages.js
//
// Complements scripts/audit_get_routes.js (route coverage, one entity each);
// this one is DATA-STATE coverage. Run both after card/render refactors.
const path = require('path');
const { openDb } = require(path.join(__dirname, '..', 'database'));
const BASE = process.env.SWEEP_BASE || 'http://localhost:3011';

const q = async (db, sql) => (await db.all(sql)).map(r => Object.values(r)[0]);

(async () => {
  const db = await openDb();
  const urls = new Map(); // url -> stratum label

  const add = (list, label, fmt) => list.forEach(v => { if (v) urls.set(fmt(v), label); });

  // --- dancers by state ---
  add(await q(db, `SELECT DISTINCT d.unique_id FROM dancers d JOIN award_dancers ad ON ad.dancer_id=d.id
    JOIN awards a ON a.id=ad.award_id JOIN events e ON e.id=a.event_id
    JOIN organizations o ON o.id=e.org_id WHERE o.custom_icons LIKE '%logo_approved%' LIMIT 15`),
    'dancer:coin-org', u => `/dancer/${u}`);
  add(await q(db, `SELECT DISTINCT d.unique_id FROM dancers d JOIN award_dancers ad ON ad.dancer_id=d.id
    JOIN awards a ON a.id=ad.award_id JOIN events e ON e.id=a.event_id
    JOIN organizations o ON o.id=e.org_id WHERE o.custom_icons LIKE '{corrupt%' LIMIT 15`),
    'dancer:corrupt-icons-org', u => `/dancer/${u}`);
  add(await q(db, `SELECT DISTINCT d.unique_id FROM dancers d JOIN award_acknowledgements aa ON aa.dancer_id=d.id LIMIT 10`),
    'dancer:has-acks', u => `/dancer/${u}`);
  add(await q(db, `SELECT DISTINCT d.unique_id FROM dancers d JOIN award_card_photos p ON p.dancer_id=d.id LIMIT 10`),
    'dancer:has-award-photo', u => `/dancer/${u}`);
  add(await q(db, `SELECT unique_id FROM dancers WHERE card_photo_url IS NOT NULL LIMIT 10`),
    'dancer:default-photo', u => `/dancer/${u}`);
  add(await q(db, `SELECT d.unique_id FROM dancers d JOIN award_dancers ad ON ad.dancer_id=d.id
    GROUP BY d.id ORDER BY COUNT(*) DESC LIMIT 10`),
    'dancer:most-awards', u => `/dancer/${u}`);
  add(await q(db, `SELECT unique_id FROM dancers WHERE id NOT IN (SELECT dancer_id FROM award_dancers) LIMIT 5`),
    'dancer:zero-awards', u => `/dancer/${u}`);
  add(await q(db, `SELECT unique_id FROM dancers WHERE is_claimed=1 LIMIT 10`),
    'dancer:claimed', u => `/dancer/${u}`);
  add(await q(db, `SELECT DISTINCT d.unique_id FROM dancers d
    JOIN dancer_card_hidden h ON h.dancer_id = d.id LIMIT 10`),
    'dancer:hidden-cards', u => `/dancer/${u}`);
  add(await q(db, `SELECT unique_id FROM dancers WHERE COALESCE(hide_from_rankings,0)=1 LIMIT 5`),
    'dancer:rankings-optout', u => `/dancer/${u}`);
  add(await q(db, `SELECT unique_id FROM dancers ORDER BY RANDOM() LIMIT 60`),
    'dancer:random', u => `/dancer/${u}`);
  // group-award-heavy dancers
  add(await q(db, `SELECT d.unique_id FROM dancers d JOIN award_dancers ad ON ad.dancer_id=d.id
    JOIN awards a ON a.id=ad.award_id GROUP BY d.id
    HAVING SUM(CASE WHEN (SELECT COUNT(*) FROM award_dancers x WHERE x.award_id=a.id) > 1 THEN 1 ELSE 0 END) > 3 LIMIT 10`),
    'dancer:group-heavy', u => `/dancer/${u}`);

  // Safety-suppressed dancers 404 by design (utils/suppression.js); the
  // interesting render paths are their CASTMATES' pages and their studios,
  // where shared group awards now render with one member filtered out.
  add(await q(db, `SELECT unique_id FROM dancers WHERE suppressed_at IS NOT NULL LIMIT 10`),
    'dancer:suppressed(404-by-design)', u => `/dancer/${u}`);
  add(await q(db, `SELECT DISTINCT d2.unique_id FROM dancers d1
    JOIN award_dancers ad1 ON ad1.dancer_id=d1.id
    JOIN award_dancers ad2 ON ad2.award_id=ad1.award_id AND ad2.dancer_id!=d1.id
    JOIN dancers d2 ON d2.id=ad2.dancer_id AND d2.suppressed_at IS NULL
    WHERE d1.suppressed_at IS NOT NULL LIMIT 10`),
    'dancer:castmate-of-suppressed', u => `/dancer/${u}`);
  add(await q(db, `SELECT DISTINCT s.unique_id FROM studios s JOIN dancer_studios ds ON ds.studio_id=s.id
    JOIN dancers d ON d.id=ds.dancer_id
    WHERE d.suppressed_at IS NOT NULL AND COALESCE(s.is_independent,0)=0 LIMIT 10`),
    'studio:has-suppressed', u => `/dance/studio/${u}`);

  // design variants for a subset of interesting dancers
  const variantTargets = [...urls.entries()].filter(([, l]) => l.startsWith('dancer:')).slice(0, 40).map(([u]) => u);
  for (const u of variantTargets) {
    urls.set(`${u}?card_design=flipbook`, 'variant:flipbook');
    urls.set(`${u}?card_design=rafters`, 'variant:rafters');
    urls.set(`${u}?design=rafters`, 'variant:v2-chrome');
  }

  // --- studios by state ---
  add(await q(db, `SELECT unique_id FROM studios WHERE name LIKE '% & %' LIMIT 10`), 'studio:collab', u => `/dance/studio/${u}`);
  add(await q(db, `SELECT unique_id FROM studios WHERE is_claimed=1 LIMIT 10`), 'studio:claimed', u => `/dance/studio/${u}`);
  add(await q(db, `SELECT s.unique_id FROM studios s JOIN awards a ON a.studio_id=s.id
    GROUP BY s.id ORDER BY COUNT(*) DESC LIMIT 10`), 'studio:biggest', u => `/dance/studio/${u}`);
  add(await q(db, `SELECT unique_id FROM studios ORDER BY RANDOM() LIMIT 40`), 'studio:random', u => `/dance/studio/${u}`);
  // Independent dancers' synthetic studios take a different exit from this
  // route (redirect to the dancer, or 404 for a residual shared roster), so
  // both shapes need their own stratum.
  add(await q(db, `SELECT s.unique_id FROM studios s WHERE COALESCE(s.is_independent,0)=1
    AND (SELECT COUNT(*) FROM dancer_studios ds WHERE ds.studio_id=s.id) = 1 LIMIT 10`),
    'studio:independent-solo', u => `/dance/studio/${u}`);
  add(await q(db, `SELECT s.unique_id FROM studios s WHERE COALESCE(s.is_independent,0)=1
    AND (SELECT COUNT(*) FROM dancer_studios ds WHERE ds.studio_id=s.id) != 1 LIMIT 10`),
    'studio:independent-roster', u => `/dance/studio/${u}`);
  add(await q(db, `SELECT d.unique_id FROM dancers d JOIN dancer_studios ds ON ds.dancer_id=d.id
    JOIN studios s ON s.id=ds.studio_id WHERE COALESCE(s.is_independent,0)=1 LIMIT 15`),
    'dancer:independent', u => `/dancer/${u}`);

  // --- orgs: every single one ---
  add(await q(db, `SELECT slug FROM organizations WHERE slug IS NOT NULL`), 'org', s => `/dance/org/${s}`);

  // --- misc public surfaces ---
  ['/', '/dance', '/faq/admin', '/faq/dancer', '/faq/organizer']  // (/dance/studios is admin-only; no public dancer directory by design)
    .forEach(u => urls.set(u, 'surface'));

  // --- run ---
  const results = { total: 0, s2xx: 0, s3xx: 0, s404: 0, s4xx: 0, s5xx: [] };
  const list = [...urls.entries()];
  console.log(`sweeping ${list.length} urls...`);
  const POOL = 12;
  let i = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (i < list.length) {
      const [url, label] = list[i++];
      try {
        const r = await fetch(BASE + url, { redirect: 'manual' });
        results.total++;
        if (r.status >= 500) { results.s5xx.push([r.status, label, url]); }
        else if (r.status === 404) { results.s404++; console.log('404:', label, url); }
        else if (r.status >= 400) { results.s4xx++; console.log(String(r.status)+':', label, url); }
        else if (r.status >= 300) results.s3xx++;
        else results.s2xx++;
      } catch (e) { results.s5xx.push(['ERR', label, url + ' ' + e.message]); }
    }
  }));
  console.log(JSON.stringify({ ...results, s5xx: undefined }, null, 0));
  if (results.s5xx.length) {
    console.log('FAILURES:');
    results.s5xx.forEach(f => console.log(' ', ...f));
  } else {
    console.log('NO 5xx — all strata render clean.');
  }
  process.exit(results.s5xx.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
