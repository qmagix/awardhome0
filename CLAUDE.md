# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AwardHome — "digital trophy case" for competitive dance: ~900k awards scraped/imported from 14+ competitions, served as public dancer/studio/org pages plus claim-and-manage dashboards.

## Commands

- `npm run dev` — run with auto-restart (`node --watch server.js`). Plain `npm start` does NOT reload: EJS views are re-read per render, but route/JS changes need a restart — a classic trap where a new view renders but its new endpoint 404s.
- `npm test` — HTTP smoke suite (`test/smoke.js`), the only test suite. Boots against the local DB; expects real seed data (e.g. studio 1, dancer profiles).
- `node database.js` — apply schema/migrations (idempotent; also run by deploy).
- Deploy: commit → push to origin main → `ssh -i deploy/awardhome-key.pem ubuntu@34.197.219.72 /opt/awardhome/deploy/deploy.sh` (pull → npm ci → migrate → restart → healthz). Prod has live user data — never copy a local DB over it; achieve data parity by running the same import scripts on both sides (see `docs/db_operations.md`, memory notes).
- Data scripts: `node scripts/<name>.js`, run from repo root. Data dirs (`raw/`, `tobeprocessed/`) live at repo root; scripts must anchor paths with `path.join(__dirname, '..')`.
- Manual QA on prod: `node scripts/qa_fixtures.js seed|remove|status` — transient "(please ignore)" test tenant (org/studio/dancers/awards), no is_test filters by design; register walkthrough accounts as `qa-*@awardhome.com` so `remove` finds them; never leave seeded overnight (3:30am featured cron).

## Architecture

Express 4 + EJS + SQLite (no build step, no ORM, no client framework).

**Database** (`database.js`): one shared connection per process (cached promise), WAL + busy_timeout. `process.env.DB_PATH` overrides the file — this is how the staged import and throwaway test copies work. Schema = `CREATE TABLE IF NOT EXISTS` block + try/catch `ALTER TABLE` migrations in `initDb()`, which runs only via `node database.js` (not on server boot); some admin routes defensively `CREATE TABLE IF NOT EXISTS` so new tables work before a migrate. Foreign keys are intentionally OFF (legacy orphans — see `docs/db_operations.md`).

**Middleware order in `server.js` matters**: helmet → session (SQLite store) → `res.locals.user` → CSRF (global; token from `_csrf` field, `?_csrf=` for multipart since multer parses after, or `X-CSRF-Token` header auto-added to fetch by `public/js/csrf.js` + meta tag in `partials/header.ejs`) → beta gate on `/dance` + `/dancer` (`BETA_MODE`/`BETA_ACCESS_KEY` in .env; unlock via `?beta=KEY`) → routers (`routes/auth`, `routes/dance/*`, `routes/admin`, `routes/feedback`).

**Auth/roles** (`middleware/auth.js`): roles `user`/`studio_owner`/`dancer_owner`/`org_owner`/`admin`/`superadmin`, but ownership checks use `owner_id` columns, not roles. `requireOrgOwner({ allowAdmin: false })` keeps plain admins out of owner+superadmin surfaces (branding, marketing). Many admin tools are superadmin-only.

**Data pipeline** (the real complexity): scrapers in `scripts/` cache HTML under `raw/<org>/<year>/` (fetch bookkeeping in the `scrape_log` table drives incremental refetch); PDF orgs are download-only pending manual QA (`tobeprocessed/pdf/`). The Monday cron runs `scripts/weekly_update.js` **staged**: snapshot live DB → run full pipeline against `staging_import.sqlite` (via `DB_PATH`) → `scripts/validate_import.js` scores the delta against each org's own history → green auto-promotes (deterministic cache replay against live), amber/red holds with `reports/PENDING_REVIEW.json` + email; review at `/admin/import-review`.

**Crons** live in `server.js` via node-cron (not system crontab): nightly backups (`ENABLE_NIGHTLY_BACKUPS`), nightly featured-studio rotation, weekly orphan check, Monday weekly scrape (`ENABLE_WEEKLY_SCRAPE`, prod only). Litestream→S3 is the authoritative prod backup.

**Award card design system**: `.flip-card` is `container-type: inline-size`; ALL internal card sizes use `cqw` units calibrated to design widths (portrait 300px → 1cqw = 3px; landscape 460px), so cards zoom like images; a rem/px fallback outside `@supports` serves old browsers. New card elements must follow this pattern or they won't scale. Per-org branding settings live in `organizations.custom_icons` (JSON) and reach cards as CSS custom properties set inline by `views/partials/dancer_award_card.ejs`.

**Caching** (`utils/cache.js`): in-memory stale-while-revalidate. Expired hits return stale data and refresh in background — no visitor ever waits. Use `refresh(key)` (background swap) rather than `invalidate(key)` (hard delete → next visitor pays the recompute) unless staleness is unacceptable. Homepage data (`dance-home`) is warmed at boot in `routes/dance/public.js`.

**Email** (`utils/mailer.js`): Gmail or Resend via `EMAIL_PROVIDER`. Outreach invites (`utils/invites.js`) honor the `email_suppressions` unsubscribe list and HMAC unsubscribe links; studio invites are one-shot templated, organizer letters are hand-composed with a `{CLAIM_LINK}` placeholder that becomes a single-use 30-day org-claim token at send time.

## Deliberate product decisions (don't "fix")

- **No public claim button on organization pages** — an unclaimed state would advertise which orgs aren't partnered yet. Orgs claim only via private links in invitation emails (`/claim/org/:token`).
- **Homepage org cards don't link to org pages** (decided 2026-08-24) — org data stays low-profile until the org partners; the org page itself stays public (it's the demo link in invitation letters). Cards instead record clicks (`POST /api/org-card-click` → `org_card_clicks`, impressions in `daily_counters`) as demand evidence for outreach — CTR shows on `/admin/orgs`. Cards must stay free of any claimed/unclaimed signal. The admin homepage (`index_admin.ejs`) keeps its links.
- **Org logos on cards are approval-gated, default OFF** — a superadmin hand-fits each logo into the fixed circular "coin" (position/rotation sliders are superadmin-only on `/manage/org/:id/branding`) and ticks "Approved for public display". Owners get size/opacity only; the concierge step is part of the pitch.
- Marketing language: "your brand on every card dancers share."
- **Public studio URLs use `studios.unique_id`** (`STU-<hex>-slug`), never the numeric id — numeric `/dance/studio/62`-style URLs deliberately 404 with NO redirect (a redirect would be an enumeration oracle for scraping the whole dataset). Manage/admin routes stay numeric (auth-gated). Same pattern as dancer `unique_id` URLs.
- Self-reported studio data enters as `is_self_added = 1, verification_status = 'unverified'`; scraped events are matched by `name + year + org_id`.

## Where things are documented

`docs/db_operations.md` (SQLite ops, backups, org SQL-dump handling), `docs/deployment.md`, `schema.md`, `org_invite_draft.md` + `org_video_scripts.md` (outreach content). `features.md`, `user_manual.md`, `TODOS_and_DONE.md`, and `ideas.md` are living docs — keep them current (see workflow conventions above). `next.md` and other root scratch files are historical context, not instructions.

## Data-model and coding rules (imported from GEMINI.md)

- **Junction tables, not legacy columns**: dancers↔awards go through `award_dancers`, dancers↔studios through `dancer_studios`. Never map group awards via the legacy 1:1 `awards.dancer_id` column.
- **Pseudo-studios for collaborations**: a cross-studio win ("Studio A & Studio B") keeps the concatenated string as its own studio row — no studio pivot table. Dancers bridge the affiliations via `dancer_studios`.
- **Scraper/ETL idempotency is mandatory**: check for existing records (event name, performance name, place, category) before inserting; use transactions for batches. The weekly staged-import validator scores idempotency breaks as failures.
- **Vanilla CSS/JS only** — no TailwindCSS or other frameworks without explicit permission. Scraping uses Cheerio + Axios (Puppeteer for dynamic sites).

## Workflow conventions (imported from GEMINI.md)

- **Commit without being asked** after each verified feature or bug fix (code must run clean first). Pushing and deploying still require an explicit request.
- **Documentation parity**: when a user-facing workflow or UI tool changes, proactively update the relevant FAQ view (`views/faq_admin.ejs`, `views/faq_dancer.ejs`, `views/faq_organizer.ejs`) in the same change.
- **Living docs to maintain**: `features.md` (feature documentation), `user_manual.md`, `TODOS_and_DONE.md` (running to-do list), `ideas.md` (novel/patentable product ideas as they come up in brainstorms). Docs belong at the root or `./docs`.
- `user_prompts.md` and `interaction_history.md` are artifacts of the previous Gemini workflow — do not maintain them going forward.
