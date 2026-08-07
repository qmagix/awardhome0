require('./instrument'); // Sentry first — must precede all other requires
require('dotenv').config();
const { PORT } = require('./config');
const morgan = require('morgan');
const express = require('express');
const session = require('express-session');
const cron = require('node-cron');
const bcrypt = require('bcrypt');
const { openDb } = require('./database');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');




const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'landing'), { index: false }));

// Request logging to stdout (journald captures it in production). Static
// assets never reach this (served above); health checks are skipped.
app.use(morgan(':remote-addr :method :url :status :res[content-length]b :response-time ms', {
  skip: (req) => req.path === '/healthz'
}));
app.use(express.json()); // Added for JSON parsing
app.use(express.urlencoded({ extended: true })); // Added for form parsing
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

app.locals.formatPlacement = function (award) {
  // Backwards compatibility if a string/null is passed directly
  let place = award;
  let awardClass = null;
  if (award && typeof award === 'object') {
    place = award.place;
    awardClass = award.award_class;
  }

  if (!place || place === 'N/A' || place === 'null') {
    if (awardClass === 'scholarship' || awardClass === 'title' || awardClass === 'special' || awardClass === 'studio') {
      return 'Winner';
    }
    return 'N/A';
  }
  const strPlace = String(place).trim();
  const num = parseInt(strPlace, 10);
  if (!isNaN(num) && num.toString() === strPlace) {
    const j = num % 10, k = num % 100;
    if (j == 1 && k != 11) return num + "st";
    if (j == 2 && k != 12) return num + "nd";
    if (j == 3 && k != 13) return num + "rd";
    return num + "th";
  }
  return String(place);
};

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

// ---- Routers ----
app.use(require('./routes/auth'));
app.use(require('./routes/dance/claims'));
app.use(require('./routes/dance/orgs'));
app.use(require('./routes/dance/studios'));
app.use(require('./routes/dance/dancers'));
app.use(require('./routes/admin'));
app.use(require('./routes/feedback'));
app.use(require('./routes/dance/public'));

// Sentry error handler must come after routers, before our own handler
if (process.env.SENTRY_DSN) {
  require('@sentry/node').setupExpressErrorHandler(app);
}

// Central error handler (Express 5 forwards rejected promises here)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(PORT, async (err) => {
  if (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  console.log(`Server running on http://localhost:${PORT}`);

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
  } catch (err) {
    console.error('Integrity check failed:', err);
  }
});

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
