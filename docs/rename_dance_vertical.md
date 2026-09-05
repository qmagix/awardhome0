# AwardHome Dance — the dance vertical's rename plan and real cost

Decided 2026-09-05 (Q): **AwardHome** is the parent family award-and-milestone
platform; the curated dance surface becomes **"AwardHome Dance"** at
**dance.awardhome.com**. danceawardhome.com is purchased and 301s there.
AwardHome LLC remains the entity for everything; only the service name and
canonical host change. The AwardHome app will later import a family's dance
record via their dancer unique_id ("magic string") using the partner-API
connector pattern.

Measured surface (2026-09-05): 91 "AwardHome" mentions in `views/`, 11 across
the static landing variants, 32 in `mobile/`, domain literals in
`mobile/app.json` / `eas.json` / `src/api/client.ts`, and `routes/wellknown.js`
reads app-link hosts from env. All *email letter* URLs already derive from
`BASE_URL` (done in the v6 letter pass), as do the sitemap, OG tags, share
links, and claim/unsubscribe links.

Total estimated cost: **about one focused day**, in four phases. Only Phase 1
must precede the next batch of org invite letters.

## Phase 1 — infrastructure + BASE_URL (~1–2 hours; BEFORE the next letters)

1. DNS: `dance.awardhome.com` → the prod box (A/CNAME, same as apex).
   `danceawardhome.com` → same box (nginx handles the redirect).
2. TLS: expand the cert (`certbot --expand -d dance.awardhome.com -d danceawardhome.com`).
3. nginx:
   - `dance.awardhome.com` → proxy to the app (same upstream as today);
   - `danceawardhome.com` → `301 https://dance.awardhome.com$request_uri`;
   - `awardhome.com` + `www` → **301 to dance.awardhome.com for now** (query
     strings preserved, so old beta-keyed letter links keep working). When the
     family app gets its web home, the apex flips to serve it and only
     `/dance/*`, `/dancer/*`, `/dance/card/*` keep the 301 to the vertical.
4. Prod `.env`: `BASE_URL=https://dance.awardhome.com` + restart. This alone
   flips every generated link: letters, claim links, unsubscribe (HMAC is
   email-keyed, so links already sent keep validating and 301 across),
   sitemap URLs, OG/share tags.
5. Known cost: session cookies are host-only — existing signed-in users log in
   once more on the new host. Beta unlock state likewise. Acceptable pre-launch.

## Phase 2 — copy sweep (~half a day)

- `views/` (91 mentions): rename to "AwardHome Dance" where the text names the
  dance site: header wordmark, homepage hero, FAQs, beta gate, claim pages,
  partners page, the news article. **Do not touch:** "AwardHome LLC" in
  terms/privacy (the entity is unchanged), the patent-pending footer line,
  `hello@awardhome.com` (parent-domain mail stays valid).
- `landing/`, `public2/`, `public3/` static variants (11 mentions).
- Mailer FROM display name → "AwardHome Dance" (env, not code).
- `org_video_scripts.md` + any marketing copy before recording.
- Gate note: the armed-mode smoke boot, sweep, and sentinel all probe
  localhost, so none of this is domain-sensitive; the copy sweep is cosmetic
  risk only.

## Phase 3 — mobile app (~1–2 hours; cheap now, nothing has shipped)

- `mobile/app.json`: add `applinks:dance.awardhome.com` + the universal-link
  host entries (keep the apex entries — the generic app will own them);
  `extra.apiBaseUrl` → `https://dance.awardhome.com`.
- `mobile/eas.json`: `EXPO_PUBLIC_API_BASE_URL` → `https://dance.awardhome.com`.
- `mobile/src/api/client.ts`: the two hardcoded fallback literals (the
  baseurl contract test will flag any stragglers).
- Prod `.env`: set `IOS_APP_ID` so `/.well-known/apple-app-site-association`
  serves on the new host (Apple fetches per-host; same app serves it).
- API-host decision, made deliberately: the app keeps talking to
  `dance.awardhome.com` until the generic-app split; at that point the
  AwardHome app gets its own backend and the dance vertical becomes a
  connected data source through the partner-API key/audit machinery.

## Phase 4 — external (~30 min)

- Google Search Console: add the `dance.awardhome.com` property; submit
  `/sitemap.xml` on launch day (it self-arms when BETA_MODE lifts).
- Nothing else is domain-bound: Sentry, Litestream, crons, backups unchanged.

## Sequencing against launch (Sept 15)

1. Phase 1 next (it gates the remaining ~10 org letters — they should carry
   final-name links).
2. Phases 2–3 land any time before Sept 15, independently deployable.
3. Phase 4 on launch day.
