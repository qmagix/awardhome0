# AwardHome mobile app

Expo / React Native / TypeScript client for families. Milestone **M6** of
`docs/mobile_app_development_plan.md`: read, recover, claim. **No submission
capability** — that is M7.

The server it talks to is this same repository. The API contract is served by
the app at `/api/v1/mobile/openapi.json`, and `src/api/schema.ts` is generated
from it — so the two sides cannot drift without a type error appearing here.

## Commands

```bash
npm install            # once
npm run typecheck      # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test               # token-lifecycle tests, plain Node, no simulator
npm run api:types      # regenerate src/api/schema.ts from ../docs/openapi_mobile.json
npm start              # Expo dev server (needs a simulator or a device)
```

From the repository root: `npm run mobile:check` runs the typecheck and the
tests together.

These are **not** part of `npm run gate`. The gate is the *server* deploy gate,
and the production host has no `mobile/node_modules`; wiring an app typecheck
into it would break deploys for a reason unrelated to the deploy. Run
`npm run mobile:check` when you change the app.

## What is verified here, and what is not

Verified on every run:

- **The token lifecycle** (`test/tokens.test.mjs`) — the highest-consequence
  logic in the app. The server rotates refresh tokens and treats a replayed one
  as theft by revoking the session, so a client that refreshes twice in parallel
  signs its own user out. Refresh is single-flight, and that is the first thing
  the tests check.
- **Types** across every screen and module, against the generated contract.

**Not** verified here, and it would be dishonest to imply otherwise: nothing in
this repository renders the app. There is no simulator and no device in the
environment it was written in, so layout, gestures, fonts, keyboard behaviour,
deep-link handling on a real OS, and anything that depends on native modules
(`expo-secure-store` in particular) are **unrun**. Treat the first device
launch as the real first test.

## Configuration

`app.json` → `extra.apiBaseUrl` selects the server. Point it at
`http://localhost:3008` for local development (and use a LAN IP rather than
`localhost` when running on a physical device).

## Universal links

The app claims `awardhome.com/dancer/*` only. The route file is
`app/dancer/[id].tsx`, which mirrors the web URL exactly, so Expo Router
resolves an incoming link with no extra mapping.

The server side is `routes/wellknown.js`, driven by environment variables:

| Variable | Example |
|---|---|
| `IOS_APP_ID` | `ABCDE12345.com.awardhome.app` |
| `ANDROID_PACKAGE` | `com.awardhome.app` |
| `ANDROID_CERT_SHA256` | `AA:BB:…` — comma-separate the upload key **and** the Play signing key |

Until those are set the association files return **404**, deliberately. A
placeholder is worse than nothing: the platforms cache association files, so a
wrong one breaks deep linking for as long as the cache lives, and it looks like
an app bug the whole time.

That Android fingerprint list is the usual cause of "links worked in the
internal build and broke in production" — Play re-signs the app, so its signing
key must be in the list too.

## Still to do before an invited cohort (plan M6)

- An Expo account and `eas.json` for internal builds; nothing here can create
  those.
- Real `IOS_APP_ID` / Android fingerprints, then re-test deep links on device.
- App icon and splash screen.
