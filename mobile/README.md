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

## Running it for the first time

**The cheapest first run needs no EAS build and no Apple account.** Every native
module this app uses (`expo-secure-store` included) is in the Expo Go runtime,
so:

```bash
cd mobile
EXPO_PUBLIC_API_BASE_URL=http://<your-LAN-IP>:3008 npx expo start
```

Scan the QR code with Expo Go. Use your machine's LAN IP, not `localhost` —
the phone is a different host. Start the server with `npm run dev` from the
repo root first.

Given that nothing in this app has ever rendered, this is worth doing before
anything else.

## Builds (EAS)

`eas.json` is committed with three profiles, and the Expo project id is already
in `app.json` (`extra.eas.projectId`), so the only interactive step left is
signing in:

```bash
npm install -g eas-cli     # or use npx eas-cli@latest
eas login                  # your Expo account — must be run by you
```

`eas init --id <project-id>` is **not needed**: its only job is writing that id
into the config, and it is already there. Running it anyway is harmless — it
will report the project is already linked. Note that `eas init` often declines
to write the id itself once it sees a dynamic `app.config.js` and asks you to
add it by hand, which is exactly why it is committed instead.

`app.json` stays static so tooling has a plain file to read and write;
`app.config.js` overlays only the value that changes per build.

Then:

```bash
eas build --profile development --platform ios     # simulator build, no Apple account needed
eas build --profile preview --platform android     # installable APK for invited families
eas build --profile preview --platform ios         # TestFlight — needs an Apple Developer account
```

**Before the first build, edit the dev IP in `eas.json`.** The `development`
profile ships with a placeholder LAN address (`192.168.1.10`); change it to
yours.

### Which profile points where

| Profile | Server | Distribution |
|---|---|---|
| `development` | your LAN IP | dev client, iOS simulator |
| `preview` | production | internal (TestFlight / APK) |
| `production` | production | store |

There are no update `channel`s in `eas.json`: `expo-updates` is not installed,
so a channel would configure nothing. Add both together if you want
over-the-air updates.

The API base URL comes from `EXPO_PUBLIC_API_BASE_URL` per profile, and
defaults to production when unset. That default is deliberate: an unconfigured
build should point at a server that *rejects* it, not one that accepts writes
into the live archive. Before this existed, a simulator build would have
written real claims and submissions to production.

### Accounts you will need

- **Nothing** for Expo Go or an iOS *simulator* build.
- **Apple Developer Program** ($99/year) for any build on a physical iPhone or
  for TestFlight.
- **Google Play Console** ($25 once) for Play internal testing. A plain APK
  from the `preview` profile can be side-loaded without it.

## Still to do before an invited cohort (plan M6)

- Run it. Nothing here has rendered on a device.
- `eas login` + `eas init` (above), and set your LAN IP in `eas.json`.
- Real `IOS_APP_ID` and Android fingerprints for universal links. After a build,
  `eas credentials` shows both — the iOS Team ID and the Android SHA-256. Add
  the **Play signing key** fingerprint too once the app is in the Play Console.
- App icon and splash screen.
