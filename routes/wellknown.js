// Universal / App Links association files (development plan M6).
//
// These two files are what let a family tap awardhome.com/dancer/<id> in a text
// message and land in the app instead of a browser. Both must be served from
// the APEX web app, over HTTPS, with no redirect — Apple and Google fetch them
// directly and will not follow one.
//
// DRIVEN BY ENVIRONMENT, NOT BY PLACEHOLDERS. Publishing an association file
// with a made-up Team ID or certificate fingerprint is worse than publishing
// nothing: the platforms cache it, and a wrong file silently breaks deep
// linking in a way that looks like an app bug for as long as the cache lives.
// So until the real values are set, these routes 404 — the honest state for
// "this app is not registered yet".
//
//   IOS_APP_ID              <TeamID>.com.awardhome.app
//   ANDROID_PACKAGE         com.awardhome.app
//   ANDROID_CERT_SHA256     colon-separated SHA-256 of the signing cert;
//                           comma-separate several (upload key + Play signing
//                           key, which is the usual reason links work in
//                           internal builds and break in production)
const express = require('express');
const router = express.Router();

// Only the paths the app can actually handle. Claiming the whole domain would
// swallow /dance, /admin and the marketing pages into an app that has no
// screens for them.
const APP_PATHS = ['/dancer/*'];

router.get('/.well-known/apple-app-site-association', (req, res) => {
  const appId = (process.env.IOS_APP_ID || '').trim();
  if (!appId) return res.status(404).json({ error: 'not_configured' });
  // Apple requires application/json and no .json extension on the path.
  res.type('application/json').json({
    applinks: {
      apps: [],
      details: [{ appID: appId, paths: APP_PATHS }],
    },
  });
});

router.get('/.well-known/assetlinks.json', (req, res) => {
  const pkg = (process.env.ANDROID_PACKAGE || '').trim();
  const fingerprints = (process.env.ANDROID_CERT_SHA256 || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!pkg || !fingerprints.length) return res.status(404).json({ error: 'not_configured' });
  res.type('application/json').json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: pkg,
      sha256_cert_fingerprints: fingerprints,
    },
  }]);
});

module.exports = router;
