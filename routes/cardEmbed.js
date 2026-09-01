// A single award card, rendered standalone for the mobile app.
//
// MOUNT POSITION IS LOAD-BEARING — after the session store (so an early_access
// family sees the same flipbook pages here as on the web) and BEFORE the
// private-beta gate, for the same reason /api/v1/mobile sits outside it: the
// app ships to invited families through TestFlight and internal builds, which
// is its own gate. A card that met the beta password page inside a native
// sheet would simply look broken.
//
// GET-only and public, like the dancer page the card comes from.
const express = require('express');
const router = express.Router();
const { openDb } = require('../database');
const rateLimit = require('express-rate-limit');
const { resolveCardDesign } = require('../utils/cardDesign');
const { flagOn } = require('../utils/featureFlags');
const { studioDisplayNameSql } = require('../utils/independents');

// Same shape and reason as the profile limiter in routes/dance/public.js:
// award ids are sequential, so a card endpoint is an enumerable surface and
// the remaining bulk-scrape path. Admins are exempt.
const cardLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: parseInt(process.env.PROFILE_RATE_LIMIT, 10) || 100,
  message: 'Too many requests from this address — please slow down and try again in a few minutes.',
  skip: (req) => {
    const role = req.session && req.session.user && req.session.user.role;
    return role === 'admin' || role === 'superadmin';
  },
});

// ONE award card, standalone, for embedding in the mobile app.
//
// The app renders this in a web view rather than reimplementing the card in
// React Native, and that is a deliberate call. The card is the product: it is
// a container-query design measured in cqw, it carries per-org branding from
// organizations.custom_icons as CSS custom properties, it has a flipbook back
// stack, and it is the subject of the provisional filing. A hand-built native
// copy would drift from all of that within a release, and every future card
// change would need an App Store review to reach anyone. This way there is one
// card, and the app gets card improvements the moment the server ships them.
//
// Scoped to a dancer for two reasons: the per-card hide lives in
// dancer_card_hidden and is per (award, dancer), and a solo card names the
// dancer on its face. Public, like the dancer page it comes from, and it
// answers 404 — never 403 — for a hidden or mismatched pair, so probing ids
// reveals nothing that the trophy case would not already show.
router.get('/dance/card/:dancerUniqueId/:awardId', cardLimiter, async (req, res) => {
  const db = await openDb();
  const dancer = await db.get(
    'SELECT id, unique_id, name FROM dancers WHERE unique_id = ?', [req.params.dancerUniqueId]);
  if (!dancer) return res.status(404).send('Not found');
  const awardId = parseInt(req.params.awardId, 10);
  if (!awardId) return res.status(404).send('Not found');

  // The SAME select the dancer page uses, narrowed to one award — including
  // the link check, so an award this dancer has no part in cannot be rendered
  // under their name.
  const sql = `
    SELECT DISTINCT a.*, e.name as event_name, e.year as event_year, o.name as org_name,
      o.logo_url, o.custom_icons,
      ${studioDisplayNameSql('s')} as studio_name, s.unique_id as studio_unique_id,
      CASE WHEN s.owner_id IS NOT NULL THEN 1 ELSE 0 END as studio_claimed,
      (SELECT COUNT(*) FROM award_dancers ad2 WHERE ad2.award_id = a.id) as dancer_count
    FROM awards a
    LEFT JOIN events e ON a.event_id = e.id
    LEFT JOIN organizations o ON e.org_id = o.id
    LEFT JOIN studios s ON a.studio_id = s.id
    LEFT JOIN award_dancers ad ON a.id = ad.award_id
    WHERE a.id = ? AND (a.dancer_id = ? OR ad.dancer_id = ?)`;
  let award;
  try {
    award = await db.get(sql + `
      AND NOT EXISTS (SELECT 1 FROM dancer_card_hidden h
                      WHERE h.award_id = a.id AND h.dancer_id = ?)`,
      [awardId, dancer.id, dancer.id, dancer.id]);
  } catch (e) {
    award = await db.get(sql, [awardId, dancer.id, dancer.id]);
  }
  if (!award) return res.status(404).send('Not found');

  if (award.custom_icons) {
    try { award.customIconsObj = JSON.parse(award.custom_icons); } catch (e) { /* unbranded */ }
  }

  // Cast, for the group card's roster page.
  award.dancers = await db.all(`
    SELECT d.name, d.unique_id FROM award_dancers ad
    JOIN dancers d ON ad.dancer_id = d.id WHERE ad.award_id = ? ORDER BY d.name`, [awardId]);
  if (!award.dancers.length) award.dancers = [{ name: dancer.name, unique_id: dancer.unique_id }];

  const cardDesign = await resolveCardDesign(req, db);
  // Flags are passed EXPLICITLY and default off (the partial's own rule): a
  // surface that forgets to pass one must not leak a dark feature.
  const [featureNotes, featurePhotos] = await Promise.all([
    flagOn('thank_you_notes', req), flagOn('award_photos', req)]);

  if (featureNotes && cardDesign === 'flipbook') {
    try {
      award.acks = await db.all(`
        SELECT aa.id as ack_id, aa.award_id, aa.dancer_id, aa.message, d.name as dancer_name
        FROM award_acknowledgements aa
        JOIN dancers d ON aa.dancer_id = d.id
        WHERE aa.status = 'approved' AND aa.award_id = ?
        ORDER BY (aa.dancer_id != ?), d.name`, [awardId, dancer.id]);
    } catch (e) { /* pre-migration */ }
  }
  if (featurePhotos && cardDesign === 'flipbook') {
    try {
      const ph = await db.get(
        "SELECT id, photo_url FROM award_card_photos WHERE dancer_id = ? AND award_id = ? AND status = 'approved'",
        [dancer.id, awardId]);
      if (ph) { award.award_photo_url = ph.photo_url; award.award_photo_id = ph.id; }
    } catch (e) { /* pre-migration */ }
  }

  // Embedded in a native sheet on the same origin the app already talks to.
  // Framing is same-origin only; this is a card, not a login surface.
  res.set('X-Frame-Options', 'SAMEORIGIN');
  // The partial reads `dancer` from page scope for the certificate back and
  // the solo card's identity line, and `dancer.card_photo_*` for the flipbook
  // photo fallback — so it needs the same columns the dancer page loads, not
  // just the three the lookup above needed.
  const full = await db.get(
    'SELECT id, unique_id, name, card_photo_url, card_photo_status FROM dancers WHERE id = ?',
    [dancer.id]);

  res.render('card_embed', {
    award, dancer: full || dancer, cardDesign, featureNotes, featurePhotos,
    pageTitle: `${dancer.name} — award card`,
  });
});

module.exports = router;
