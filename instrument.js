// Sentry must initialize before the rest of the app loads so its
// auto-instrumentation can hook http/express. Required as the first line
// of server.js. No-op unless SENTRY_DSN is set (dev stays clean).
require('dotenv').config();
const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // 10% of transactions traced — enough for slow-endpoint visibility
    // without eating the free-tier quota.
    tracesSampleRate: 0.1,
  });
  console.log('Sentry error tracking enabled');
}

module.exports = Sentry;
