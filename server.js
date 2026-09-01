require('./instrument'); // Sentry first — must precede all other requires
require('dotenv').config();
const { PORT } = require('./config');
const morgan = require('morgan');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const cron = require('node-cron');
const bcrypt = require('bcrypt');
const { openDb } = require('./database');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');




const app = express();

// Security headers. CSP permits the app's inline scripts/styles and Google
// Fonts. frame-ancestors is deliberately omitted so framing stays governed by
// X-Frame-Options alone — the widget route removes that header to remain
// embeddable on external sites (routes/dance/public.js). CORP is cross-origin
// because widgets and invite emails hot-link images from this domain.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", "'unsafe-inline'"],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'https:'],
      'frame-ancestors': null,
      // Would rewrite http://localhost asset URLs to https in dev
      ...(process.env.NODE_ENV === 'production' ? {} : { 'upgrade-insecure-requests': null }),
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'landing'), { index: false }));
// Landing redesign previews — /?design=rafters (public2), /?design=hybrid (public3)
app.use('/public2', express.static(path.join(__dirname, 'public2'), { index: false }));
app.use('/public3', express.static(path.join(__dirname, 'public3'), { index: false }));

// Request logging to stdout (journald captures it in production). Static
// assets never reach this (served above); health checks are skipped.
app.use(morgan(':remote-addr :method :url :status :res[content-length]b :response-time ms', {
  skip: (req) => req.path === '/healthz'
}));
app.use(express.json()); // Added for JSON parsing
app.use(express.urlencoded({ extended: true })); // Added for form parsing

// ---- Mobile API (development plan M5) ----
// MOUNT POSITION IS LOAD-BEARING — after express.json(), and BEFORE the
// session store, the CSRF middleware and the private-beta gate:
//   * before session: a bearer-authenticated request has no reason to create
//     a session row, and a native client never returns the cookie anyway;
//   * before CSRF: CSRF defends against a browser attaching an AMBIENT
//     credential cross-site. A bearer token is not ambient — nothing attaches
//     it automatically — so the check does not apply rather than being skipped;
//   * outside the beta gate: the app ships to invited families through
//     TestFlight and internal builds, which is its own gate.
// This is the only place in the app where router order carries a security
// argument; scripts/audit_get_routes.js is the check on it.
app.use('/api/v1/mobile', require('./routes/api/mobile'));

// Universal / App Links association files. Mounted here for the same reason as
// the API — Apple and Google fetch them with no cookie and must not meet the
// beta gate or a CSRF token. They 404 until the real app IDs are configured;
// see routes/wellknown.js for why a placeholder would be worse than nothing.
app.use(require('./routes/wellknown'));
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET not set — using a random secret; sessions will reset on restart.');
  return crypto.randomBytes(32).toString('hex');
})();

const SqliteSessionStore = require('./utils/sessionStore');
app.set('trust proxy', 1);
app.use(session({
  store: new SqliteSessionStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // requires HTTPS (e.g. behind Cloudflare/nginx)
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.locals.formatEventTitle = require('./utils/format').formatEventTitle;

app.locals.formatPlacement = require('./utils/format').formatPlacement;

app.locals.getPremiumDetails = function (award) {
  const text = [award.category, award.award_type, award.performance_name].filter(Boolean).join(' ').toLowerCase();

  if (text.includes('scholarship')) return { isPremium: true, icon: '🎓' };
  if (text.includes('invite') || text.includes('invitation')) return { isPremium: true, icon: '💌' };
  if (text.includes('title') || text.includes('photogenic') || text.match(/\bdoy\b/) || text.includes('dancer of the year')) return { isPremium: true, icon: '👑' };

  return { isPremium: false, icon: '' };
};

app.locals.isPremiumAward = function (award) {
  return app.locals.getPremiumDetails(award).isPremium;
};

// Tier + emoji for a card face. Single source of truth — used by the
// dancer_award_card partial AND the event-page lightbox payload, so the
// two can never drift.
app.locals.cardTier = function (award, placeText) {
  let tier = 'tier-star';
  let icon = '⭐';
  const pLower = String(placeText || '').toLowerCase();
  const typeLower = (award.award_type || '').toLowerCase();

  if (app.locals.isPremiumAward(award)) {
    tier = 'tier-gold'; icon = app.locals.getPremiumDetails(award).icon;
  } else if (pLower.includes('1st') || pLower === 'winner' || pLower.includes('first') || pLower === 'champion') {
    tier = 'tier-gold'; icon = '🏆';
  } else if (pLower.includes('2nd') || pLower.includes('second')) {
    tier = 'tier-silver'; icon = '🥈';
  } else if (pLower.includes('3rd') || pLower.includes('third')) {
    tier = 'tier-bronze'; icon = '🥉';
  } else if (pLower.includes('4th') || pLower.includes('5th') || pLower.includes('6th') ||
    pLower.includes('7th') || pLower.includes('8th') || pLower.includes('9th') ||
    pLower.includes('10th')) {
    // keep as star
  } else if (pLower.includes('miss') || typeLower.includes('miss') || pLower.includes('mr ') ||
    typeLower.includes('mr ')) {
    tier = 'tier-gold'; icon = '🏆';
  }

  if (pLower.includes('1st runner')) { tier = 'tier-silver'; icon = '🥈'; }
  else if (pLower.includes('2nd runner')) { tier = 'tier-bronze'; icon = '🥉'; }
  return { tier, icon };
};

// Org coin visibility + fit CSS vars (concierge logo approval rules) —
// same contract as the partial's inline block; kept together with
// cardTier so every card surface resolves branding identically.
app.locals.cardCoin = function (award) {
  const lci = award.customIconsObj || {};
  const show = !!(award.logo_url && lci.logo_approved && !lci.hide_logo);
  const vars = [];
  if (show) {
    if (lci.logo_opacity !== undefined) vars.push('--org-logo-opacity: ' + lci.logo_opacity);
    const tf = [];
    if (lci.logo_offset_x || lci.logo_offset_y) tf.push('translate(' + (lci.logo_offset_x || 0) + 'px, ' + (lci.logo_offset_y || 0) + 'px)');
    if (lci.logo_rotation) tf.push('rotate(' + lci.logo_rotation + 'deg)');
    if (lci.logo_size && lci.logo_size !== 24) tf.push('scale(' + (lci.logo_size / 24) + ')');
    if (tf.length) vars.push('--org-logo-transform: ' + tf.join(' '));
  }
  return { show, vars };
};

app.locals.getCustomIcon = function (award, customIcons) {
  if (!customIcons || typeof customIcons !== 'object') return null;
  const pLower = String(award.place || '').toLowerCase();
  const aClass = award.award_class || '';

  if (aClass === 'title') {
    if (pLower.includes('runner') && customIcons.title && customIcons.title.runnerup) return customIcons.title.runnerup;
    if (customIcons.title && customIcons.title.winner) return customIcons.title.winner;
  }

  if (aClass === 'scholarship') {
    if (customIcons.scholarship && customIcons.scholarship.default) return customIcons.scholarship.default;
  }

  if (aClass === 'special' || aClass === 'studio') {
    const key = (award.award_type && award.award_type.trim() !== '') ? award.award_type : award.category;
    if (key && customIcons.special && customIcons.special.custom && customIcons.special.custom[key]) {
      return customIcons.special.custom[key];
    }

    const text = [award.category, award.award_type, award.performance_name].filter(Boolean).join(' ').toLowerCase();
    if ((text.includes('invite') || text.includes('invitation')) && customIcons.special && customIcons.special.invitation) {
      return customIcons.special.invitation;
    }

    if (customIcons.special && customIcons.special.default) return customIcons.special.default;
  }

  if (aClass === 'adjudication') {
    // Adjudications usually store the score string in the place field
    const adjKey = String(award.place || '').trim();
    if (adjKey && customIcons.adjudication && customIcons.adjudication[adjKey]) {
      return customIcons.adjudication[adjKey];
    }
    // Also try award_type just in case the importer mapped it weirdly
    const typeKey = (award.award_type && award.award_type.trim() !== '') ? award.award_type : award.category;
    if (typeKey && customIcons.adjudication && customIcons.adjudication[typeKey]) {
      return customIcons.adjudication[typeKey];
    }
  }

  if (aClass === 'overall') {
    if (pLower === '1' || pLower.includes('1st') || pLower === 'winner') {
      if (customIcons.overall && customIcons.overall['1']) return customIcons.overall['1'];
    } else if (pLower === '2' || pLower.includes('2nd')) {
      if (customIcons.overall && customIcons.overall['2']) return customIcons.overall['2'];
    } else if (pLower === '3' || pLower.includes('3rd')) {
      if (customIcons.overall && customIcons.overall['3']) return customIcons.overall['3'];
    }
    if (customIcons.overall && customIcons.overall['other']) return customIcons.overall['other'];
  }

  return null;
};

// Global middleware to pass user to templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Health check for deploys / load balancers / monitoring
app.get('/healthz', async (req, res) => {
  try {
    const db = await openDb();
    await db.get('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// CSRF protection: issue a per-session token (after /healthz so monitor pings
// never create sessions) and verify it on every unsafe-method request. Must
// precede the beta gate and all routers. See middleware/csrf.js.
const { issueCsrfToken, verifyCsrf } = require('./middleware/csrf');
app.use(issueCsrfToken);
app.use(verifyCsrf);

// Private-beta gate for the public data surfaces (see middleware/beta.js).
// Landing, auth, widgets, unsubscribe, and healthz stay open.
const { betaGate } = require('./middleware/beta');
app.use(['/dance', '/dancer'], betaGate);

app.post('/beta-unlock', (req, res) => {
  const { BETA_KEY } = require('./config');
  const body = req.body || {};
  const nextUrl = (body.next || '/dance').startsWith('/') ? body.next || '/dance' : '/dance';
  if (BETA_KEY && body.key === BETA_KEY) {
    req.session.betaAccess = true;
    return res.redirect(nextUrl);
  }
  res.status(401).render('beta_gate', { error: 'Incorrect password. Check your invite email for the access link.', next: nextUrl, pageTitle: 'Private Beta' });
});

// ---- Routers ----
app.use(require('./routes/auth'));
app.use(require('./routes/dance/claims'));
app.use(require('./routes/dance/orgs'));
app.use(require('./routes/dance/studios'));
app.use(require('./routes/dance/dancers'));
app.use(require('./routes/dance/submissions'));
app.use(require('./routes/admin'));
app.use(require('./routes/feedback'));
app.use(require('./routes/partners'));
app.use(require('./routes/news'));
app.use(require('./routes/flags'));
app.use(require('./routes/dance/public'));

// Sentry error handler must come after routers, before our own handler
if (process.env.SENTRY_DSN) {
  require('@sentry/node').setupExpressErrorHandler(app);
}

// Central error handler (Express 5 forwards rejected promises here)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Upload rejections (multer limits/fileFilter) are client errors, not crashes
  if (err && (err.name === 'MulterError' || err.status === 400)) {
    const msg = err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE'
      ? 'File too large. Please upload a smaller file.'
      : (err.message || 'Bad request.');
    return res.status(400).send(msg);
  }
  console.error('Unhandled error:', err);
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(PORT, async (err) => {
  if (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  console.log(`Server running on http://localhost:${PORT}`);

  // LAN addresses, for pointing a phone at this machine. A device on the wifi
  // cannot resolve `localhost` — that is the phone itself — so the mobile app
  // needs the machine's actual address on the network. Express binds 0.0.0.0
  // by default, so these work with no further configuration.
  const nets = os.networkInterfaces();
  const lan = Object.values(nets).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  if (lan.length) {
    for (const addr of lan) console.log(`  on your network:  http://${addr}:${PORT}`);
    console.log(`  for the mobile app (mobile/):\n` +
      `    EXPO_PUBLIC_API_BASE_URL=http://${lan[0]}:${PORT} npx expo start`);
  }

  // Bootstrap Superadmin
  if (process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD) {
    const db = await openDb();
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [process.env.SUPERADMIN_EMAIL]);
    if (!existing) {
      const hash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 10);
      await db.run(
        'INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, ?)',
        [process.env.SUPERADMIN_EMAIL, hash, 'superadmin', 1]
      );
      console.log(`Superadmin bootstrapped: ${process.env.SUPERADMIN_EMAIL}`);
    } else {
      // Ensure role is superadmin if it exists but was downgraded or something
      await db.run('UPDATE users SET role = "superadmin" WHERE email = ?', [process.env.SUPERADMIN_EMAIL]);
    }
  }
});

// Nightly featured-studio rotation at 3:30 AM (see utils/featured.js)
cron.schedule('30 3 * * *', async () => {
  try {
    const { computeFeaturedStudios } = require('./utils/featured');
    const result = await computeFeaturedStudios();
    console.log(`Featured rotation: ${result.selected.length} studios selected`);
  } catch (err) {
    console.error('Featured rotation failed:', err);
  }
});

// Weekly referential-integrity check (Sunday 4 AM). We deliberately do NOT
// enable PRAGMA foreign_keys (it would break legacy import scripts and slow
// parent deletes without new indexes) — instead, drift is detected here and
// reported so it can be repaired with scripts/fix_orphaned_awards.js.
cron.schedule('0 4 * * 0', async () => {
  try {
    const db = await openDb();
    const violations = await db.all('PRAGMA foreign_key_check');
    if (violations.length > 0) {
      const summary = `Integrity check: ${violations.length} foreign-key violation(s) found (e.g. ${JSON.stringify(violations[0])})`;
      console.error(summary);
      if (process.env.SENTRY_DSN) require('@sentry/node').captureMessage(summary, 'warning');
    } else {
      console.log('Integrity check: clean');
    }

    // Family submissions stage in their own SQLite file, so their canonical
    // references (dancer, event, studio) cross a database boundary that the
    // PRAGMA above cannot see at all. The script opens both connections;
    // it reports and never deletes — a family's submission is their record
    // of their own child's award.
    require('child_process')
      .spawn('node', [path.join(__dirname, 'scripts', 'check_submission_orphans.js')], { stdio: 'inherit' })
      .on('error', e => console.error('Submission orphan check failed:', e.message));
  } catch (err) {
    console.error('Integrity check failed:', err);
  }
});

// Weekly award-data update (Monday 5 AM): incremental re-scrape of the
// web-scraped orgs + new-PDF downloads via scripts/weekly_update.js.
// Long-running, so spawned as a child process; the summary lands in the
// app log, failures go to Sentry. Enable on prod only (dev shouldn't scrape).
if (process.env.ENABLE_WEEKLY_SCRAPE === 'true') {
  cron.schedule('0 5 * * 1', () => {
    const { spawn } = require('child_process');
    console.log('Starting weekly award-data update...');
    const child = spawn('node', [path.join(__dirname, 'scripts', 'weekly_update.js')], { cwd: __dirname });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', (code) => {
      const marker = out.indexOf('================ WEEKLY');
      console.log(marker > -1 ? out.slice(marker) : out.slice(-2000));
      if (code !== 0 && process.env.SENTRY_DSN) {
        require('@sentry/node').captureMessage(`Weekly award update exited ${code}:\n${out.slice(-1500)}`, 'error');
      }
    });
  });
}

// Hourly public-page sentinel (utils/sentinel.js): probes one REAL entity
// per data stratum against this instance and emails reviewers + Sentry when
// a render path 5xxes. Strata are live queries, so coverage tracks the data
// (first approved org coin => coin pages guarded automatically). Prod only.
if (process.env.ENABLE_SENTINEL === 'true') {
  cron.schedule('7 * * * *', async () => {
    try {
      await require('./utils/sentinel').runSentinel();
    } catch (err) {
      console.error('Sentinel run failed:', err);
    }
  });
}

// Setup automated nightly backups at 3:00 AM
if (process.env.ENABLE_NIGHTLY_BACKUPS === 'true') {
  cron.schedule('0 3 * * *', () => {
  console.log('Running automated nightly backup of database.sqlite...');
  try {
    if (!fs.existsSync(path.join(__dirname, 'backups'))) {
      fs.mkdirSync(path.join(__dirname, 'backups'));
    }
    const dateStr = new Date().toISOString().split('T')[0];
    const backupPath = path.join(__dirname, 'backups', `database_${dateStr}.sqlite`);
    fs.copyFileSync(path.join(__dirname, 'database.sqlite'), backupPath);
    console.log(`Backup successfully created at ${backupPath}`);

    // Cleanup old backups (keep last 7)
    const files = fs.readdirSync(path.join(__dirname, 'backups'))
      .filter(f => f.startsWith('database_') && f.endsWith('.sqlite'))
      .sort()
      .reverse();

    if (files.length > 7) {
      const toDelete = files.slice(7);
      toDelete.forEach(file => {
        fs.unlinkSync(path.join(__dirname, 'backups', file));
        console.log(`Deleted old backup: ${file}`);
      });
    }
  } catch (err) {
    console.error('Failed to run nightly backup:', err);
  }
});
}
