// Session-backed CSRF protection.
//
// issueCsrfToken: lazily creates a per-session token and exposes it to views
// as res.locals.csrfToken (rendered into a <meta> tag by partials/header.ejs
// and into hidden inputs on the anonymous-critical forms).
//
// verifyCsrf: rejects unsafe-method requests whose token doesn't match the
// session's. The token may arrive as req.body._csrf (urlencoded forms),
// req.query._csrf (multipart forms — multer parses the body *after* this
// middleware, so public/js/csrf.js puts the token on the query string), or
// the X-CSRF-Token header (fetch calls, auto-added by public/js/csrf.js).
const crypto = require('crypto');

// Paths that never need a token and where creating a session per request
// would just bloat sessions.sqlite (monitors, cross-origin widget embeds).
const SKIP_ISSUE = [/^\/healthz$/, /^\/widget\//, /^\/uploads\//];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueCsrfToken(req, res, next) {
  if (req.session && !SKIP_ISSUE.some(re => re.test(req.path))) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
  }
  next();
}

function tokensMatch(sent, expected) {
  if (typeof sent !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session && req.session.csrfToken;
  const sent = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
  if (expected && tokensMatch(sent, expected)) return next();

  // fetch callers (they send the header or JSON) get JSON; native forms get text
  const wantsJson = req.get('x-csrf-token') !== undefined || req.is('json') ||
    (req.get('accept') || '').includes('application/json');
  if (wantsJson) {
    return res.status(403).json({ error: 'Your session expired. Please refresh the page and try again.' });
  }
  res.status(403).send('Your session expired or the form was missing its security token. Please go back, refresh the page, and try again.');
}

module.exports = { issueCsrfToken, verifyCsrf };
