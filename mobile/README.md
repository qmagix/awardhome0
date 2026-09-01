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
npm run go             # Expo dev server in Expo Go mode  <- the normal one
npm run web            # render in a browser, no phone needed
npx expo-doctor        # preflight; must stay 18/18
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

The API address comes from `EXPO_PUBLIC_API_BASE_URL`, read from
`mobile/.env.local` (gitignored) for local work and from the EAS build profile
otherwise. `app.config.js` overlays it onto `app.json`'s
`extra.apiBaseUrl`, which is the production default.

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

Two terminals:

```bash
npm run dev            # repo root — the API server
cd mobile && npm run go # Expo Go mode
```

Then **scan the QR code**. Don't tap the entry under "Recently in development"
in Expo Go — that list caches whatever URL it last saw, which is the single
most common way to end up staring at a blank screen.

`.env.local` holds the API address, so no environment prefix is needed:

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.243:3008
```

It is gitignored, and it is a DHCP lease. `npm run dev` prints the current LAN
address on boot — if it stops matching `.env.local`, update the file. The
address matters because `localhost` on the phone means *the phone*.

### If Expo Go refuses the bundle entirely

`npm run web` opens the app in a browser with no Expo Go involved. It is not a
substitute for a device — no Keychain, no real gestures, no deep links — but it
renders every screen and exercises the API client against a live server, which
is most of what a first look is for.

Use it whenever the Expo Go SDK question is unresolved; it never has that
problem.

To find out which SDK your Expo Go *can* run: **since SDK 54 the Expo Go client
version number matches the SDK it supports** (SDK 56 → client 56.0.4, SDK 57 →
client 57.0.9; older clients used a `2.x` series, e.g. 2.33.17 → SDK 53). Open
Expo Go and read its version, then pin this project to that major.

A common trap: "the latest version in my App Store" is capped by the phone's
**iOS version**. An older iPhone is offered an older Expo Go, and it really is
the newest one available *to that device* — so the fix is the project's SDK,
not another download.

### `npm run go` vs `npm start`

`expo-dev-client` is installed (the EAS `development` profile needs it), and
its presence makes a bare `expo start` default to **dev-client** mode. Expo Go
will still discover a project served that way and then do nothing useful with
it — the URL it is handed points at a custom dev client that is not installed.
Pressing `s` in the terminal switches modes and changes the URL, which is why
the entry then disappears from Expo Go's list.

So the mode is pinned in the scripts rather than left to a default:

| Command | Mode | Use when |
|---|---|---|
| `npm run go` | Expo Go | the normal case — no build, no Apple account |
| `npm run go:clear` | Expo Go, cache cleared | after dependency changes, or a stale-looking blank screen |
| `npm start` | dev client | you have installed a build from the `development` EAS profile |

If Expo Go shows a blank screen or the project vanishes from its list, you are
almost certainly in the wrong mode — `npm run go:clear` and rescan.

## SDK version: why 54 and not npm-latest

**The project is pinned to Expo SDK 54, because that is what this developer's
Expo Go supports.**

npm's `latest` tag for `expo` is 57. Following it produces *"The project you
requested requires a newer version of Expo Go"* on a phone that already has the
newest Expo Go installed — and there is no newer one to download, because
**App Store Expo Go is capped by the phone's iOS version**. It really is the
latest available to that device. No amount of re-downloading fixes it; only
changing the project's SDK does.

This project went 57 → 56 → 54 before landing, which is two wasted dependency
realignments. The lesson, in order:

1. Open Expo Go and read the SDK it says it supports.
2. Pin the project to that major.

Since SDK 54 the Expo Go client version number tracks the SDK it supports
(SDK 56 → client 56.0.4, SDK 57 → client 57.0.9); older clients used a `2.x`
series (2.33.17 → SDK 53). So the version number in Expo Go is the answer
either way.

`npx expo-doctor` is **18/18 on SDK 54**. Keep it there — a red check here has
twice turned out to be a real problem rather than noise.

### Moving to a newer SDK later

Two things unpin this, and only these:

- **A dev client or TestFlight build.** Expo Go stops being the constraint
  entirely, so the project can take any SDK. Use `npm start` (dev-client mode)
  rather than `npm run go`.
- **A newer Expo Go actually running on the phone** — which may need an iOS
  upgrade first.

Then `npx expo install expo@^<sdk> --fix`, clean-reinstall `node_modules`, and
re-run `expo-doctor`, `npm run typecheck` and `npm test`. Expect config-plugin
churn: `expo-status-bar` is a config plugin on newer SDKs and not on 54, which
broke `expo config` until it was removed from `plugins` in `app.json`.

### If Expo Go refuses the bundle entirely

`npm run web` opens the app in a browser with no Expo Go involved. It is not a
substitute for a device — no Keychain, no real gestures, no deep links — but it
renders every screen and exercises the API client against a live server, which
is most of what a first look is for.

Use it whenever the Expo Go SDK question is unresolved; it never has that
problem.

To find out which SDK your Expo Go *can* run: **since SDK 54 the Expo Go client
version number matches the SDK it supports** (SDK 56 → client 56.0.4, SDK 57 →
client 57.0.9; older clients used a `2.x` series, e.g. 2.33.17 → SDK 53). Open
Expo Go and read its version, then pin this project to that major.

A common trap: "the latest version in my App Store" is capped by the phone's
**iOS version**. An older iPhone is offered an older Expo Go, and it really is
the newest one available *to that device* — so the fix is the project's SDK,
not another download.

### `npm run go` vs `npm start`

`expo-dev-client` is installed (the EAS `development` profile needs it), and
its presence makes a bare `expo start` default to **dev-client** mode. Expo Go
will still discover a project served that way and then do nothing useful with
it — the URL it is handed points at a custom dev client that is not installed.
Pressing `s` in the terminal switches modes and changes the URL, which is why
the entry then disappears from Expo Go's list.

So the mode is pinned in the scripts rather than left to a default:

| Command | Mode | Use when |
|---|---|---|
| `npm run go` | Expo Go | the normal case — no build, no Apple account |
| `npm run go:clear` | Expo Go, cache cleared | after dependency changes, or a stale-looking blank screen |
| `npm start` | dev client | you have installed a build from the `development` EAS profile |

If Expo Go shows a blank screen or the project vanishes from its list, you are
almost certainly in the wrong mode — `npm run go:clear` and rescan.

## SDK version: why 56 and not 57

**The project is pinned to Expo SDK 56 so that App Store Expo Go can run it.**

npm's `latest` tag for `expo` is 57, and that is the wrong thing to follow when
Expo Go is the target: the App Store build lags npm by weeks, so a project on
npm-latest gets *"The project you requested requires a newer version of Expo
Go"* from a phone that already has the newest Expo Go installed. There is no
newer one to download. This project was briefly on 57 and hit exactly that.

The heuristic that matters: **pick the newest SDK the shipped Expo Go
supports**, not the newest on npm.

### The cost of that choice, stated honestly

`npx expo-doctor` reports one failing check on SDK 56, and it will keep
reporting it:

> This project uses Hermes V1 with expo@56.0.21, which is affected by a known
> memory regression. Its only fix is SDK 57.

So there is a real trade, and no version satisfies both sides today:

| | Expo Go works | Hermes fixed |
|---|---|---|
| SDK 56 | ✅ | ❌ |
| SDK 57 | ❌ | ✅ |

SDK 56 is the right side of that trade **right now**, because the immediate job
is seeing five read-only screens render at all, and a memory regression will
not bite a session like that. It would matter for a shipped build.

### When to move to 57

Either trigger, whichever comes first:

- **You build a dev client or a TestFlight build.** Expo Go stops being the
  constraint at that moment, and the Hermes fix starts mattering. Then:
  `npx expo install expo@^57.0.9 --fix`, and use `npm start` (dev-client mode)
  rather than `npm run go`.
- **App Store Expo Go picks up SDK 57.** At that point 56 buys nothing.

Until one of those, `expo-doctor`'s Hermes failure is a known, accepted
finding — not something to fix by upgrading blindly, which would put you back
on a bundle your phone refuses to open.

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

The `development` profile points at `http://192.168.1.243:3008`. **That is a
DHCP lease, not a fixed address** — if `npm run dev` starts printing something
else, update `eas.json` to match, or the dev build will silently fail to reach
the server.

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
