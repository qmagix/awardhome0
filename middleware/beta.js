const { BETA_MODE, BETA_KEY } = require('../config');

// Private-beta gate for public data surfaces (/dance*, /dancer/*).
// Passes: gate disabled, logged-in users, unlocked sessions, or a valid
// ?beta=KEY link (the magic link embedded in invite emails). Everyone
// else sees the gate page. Launch = set BETA_MODE=false and restart.
function betaGate(req, res, next) {
  if (!BETA_MODE || !BETA_KEY) return next();
  if (req.session.user || req.session.betaAccess) return next();
  if (req.query.beta && req.query.beta === BETA_KEY) {
    req.session.betaAccess = true;
    return next();
  }
  res.status(200).render('beta_gate', { error: null, next: req.originalUrl, pageTitle: 'Private Beta' });
}

module.exports = { betaGate };
