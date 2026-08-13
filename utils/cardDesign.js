// Award-card design registry. The public dancer page renders one of these
// variants; the site-wide default lives in system_settings ('card_design',
// superadmin toggle at /admin/settings) and any visitor can preview a
// variant for their session with ?card_design=<name> (?card_design=default
// clears the override). Add future designs ('v3', ...) to this list and
// branch on the value in views/partials/dancer_award_card.ejs.
const CARD_DESIGNS = ['classic', 'flipbook'];

async function resolveCardDesign(req, db) {
  const q = req.query.card_design;
  if (q === 'default') {
    delete req.session.cardDesignOverride;
  } else if (q && CARD_DESIGNS.includes(q)) {
    req.session.cardDesignOverride = q;
  }
  if (req.session.cardDesignOverride) return req.session.cardDesignOverride;
  try {
    const row = await db.get("SELECT value FROM system_settings WHERE key = 'card_design'");
    if (row && CARD_DESIGNS.includes(row.value)) return row.value;
  } catch (e) { /* table missing before first migrate — fall through */ }
  return 'classic';
}

module.exports = { CARD_DESIGNS, resolveCardDesign };
