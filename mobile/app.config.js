// Dynamic Expo config.
//
// app.json holds everything static — bundle ids, associated domains, plugins —
// and stays a plain file so `eas init` can write `extra.eas.projectId` into it.
// This file overlays only what has to change per build.
//
// WHY THIS EXISTS. `extra.apiBaseUrl` used to be hardcoded to production, which
// meant a development build on a simulator would happily write submissions and
// claims to the live archive. The build profile now decides the server
// (eas.json sets EXPO_PUBLIC_API_BASE_URL), and the default stays production
// so an unconfigured build is wrong in the safe direction — pointing at a
// server that rejects you, not one that accepts you.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || config.extra?.apiBaseUrl || 'https://awardhome.com',
  },
});
