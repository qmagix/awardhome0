# TODOS and DONE

## TODO

### Data quality
- [ ] Review the 553 flagged same-name-no-evidence studios (needs_investigation=1, still tab-named) — possibly distinct studios sharing a name; merge or clean case-by-case.
- [ ] Clean-vs-clean duplicate studios: 892 same-normalized-name groups with no tab member (case/punctuation variants like "ELITE DANCE ACADEMY" vs "Elite Dance Academy") — needs the same evidence-based approach.
- [ ] Studio+teacher concat records from the StarQuest import (e.g. "Lanzi Academy Of Dance Christina Lanzi" #16125) — detect and merge into the base studio.
- [ ] Dancer same-name mixing bug (see duplicate_name_bugs.md): scraper assumed same-name dancers are the same person; treat same name + different studio as different dancers, add admin merge/split tools.

### Security / launch
- [ ] Anti-scrape follow-up: rate-limit public /dance/studio/:id and /dancer/:unique_id per IP (sequential IDs make enumeration trivial even with the directory gated); consider Cloudflare bot-fight rules.
- [ ] Launch-day SEO: sitemap.xml for studio/dancer pages (replaces the public directory as the crawl path once BETA_MODE=false).

### Features
- [ ] Show dancer vanity chip (#Tag) on homepage leaderboard rows and share cards (field: dancers.vanity_tag, chip style: .vanity-chip; add vanity_tag to the three dancer leaderboard queries in routes/dance/public.js and render in views/partials/leaderboard_rows.ejs). The #Tag itself shipped on dancer profiles 2026-08-08.
- [ ] Email notifications for studio admins when new pending claims/verifications arrive (claims currently email only the claimant for verification; nothing notifies the studio owner of pending roster/award requests).
- [ ] Testimonials for organizations, studios, and dancers (makes them stand out; FAQ pages and org marketing profiles are done — this is the missing piece).
- [ ] File storage to AWS S3 for uploads (org results, branding images currently on local disk; ties into the org result submission pipeline below).
- [ ] Organization competition result submission end-to-end: upload works (org_uploads table + local disk) but the S3 storage + admin review/batch-ingestion pipeline is not built.
- [ ] Mobile app as a PWA (MVP). The responsive web pass is done; PWA manifest/service worker/install flow is not.

## DONE

### 2026-08-04 → 08-09 sprint (security, deploy, beta launch — previously untracked)
- [x] P0 security lockdown: admin/merge/backfill/feature endpoints require admin; random single-use 24h email-verification tokens; session hardening (SESSION_SECRET, custom SQLite store, 7-day cookies); login/register rate limits.
- [x] Owner-check middleware refactor: requireStudioOwner / requireOrgOwner replace ~40 inline checks.
- [x] App modularization: server.js (3,700 lines) split into routes/{auth,admin,feedback} + routes/dance/{claims,orgs,studios,dancers,public} + middleware; landing page at /, public dance routes under /dance with 301s from legacy URLs; central error handler; /healthz.
- [x] DB hardening: shared WAL connection (busy_timeout, synchronous=NORMAL); schema drift sync; orphaned-FK repair (all 153 awards.dancer_id restored); weekly PRAGMA foreign_key_check cron reporting to Sentry.
- [x] Smoke test suite (npm run smoke, 46 checks: public renders, auth lockdown, CSRF flows).
- [x] Production deployment: EC2 + systemd + nginx kit with deploy.sh (pull → npm ci → migrate → restart → healthz); Litestream continuous backup to S3 + passed restore drill; nightly local backup cron; HTTPS via certbot; Cloudflare (proxied DNS, real-IP for rate limits, Email Routing); Resend domain verified; stable EIP.
- [x] Observability: Sentry error tracking + morgan request logging.
- [x] Performance: homepage aggregation cache (2.6s → 30ms); leaderboards lazy-load beyond top 25 (2MB → 150KB); composite award indexes.
- [x] npm audit: 12 vulnerabilities (incl. 1 critical) → 0.
- [x] CSRF protection site-wide (session tokens + auto-injecting client script) + helmet security headers (CSP/HSTS, widget embeds preserved) + multer upload limits/type filters.
- [x] Black & gold design system unified across app and landing (two-tier gold, neutral graphite cards).
- [x] Featured-studio engine: activity-based auto-rotation (verified-action weighting, decay, tenure/cooldown), nightly cron, public policy FAQ; leaderboards stay unpaid (committed policy).
- [x] Invite cockpit (/admin/marketing/studios): award-count/rank filters, inline contact edit, per-row preview + send, rank-aware email copy, invite tracking, suppression list, RFC 8058 one-click unsubscribe.
- [x] Private beta gate (BETA_MODE) over /dance + /dancer with magic-link unlock embedded in invite emails.
- [x] One-page public claim flows for studios AND dancers (account + claim in one submit, deferred domain fast-track auto-approval after email verification); email deliverability fixes.
- [x] Post-claim onboarding checklist for studio owners.
- [x] Rate-limited hero typeahead search for studios and dancers.
- [x] Mobile responsive pass (nav collapse, WebP hero, 320px fixes).
- [x] Dancer vanity #Tag (dancer-chosen, next to immutable ID) on dancer profiles.
- [x] Dancer trophy case polish: year-first timeline, award-card flip easter egg (champagne certificate back), portrait/landscape/table three-way view toggle.
- [x] Data cleanup — garbled scraped studio names (scripts/cleanup_garbled_studios.js): 3 category-header pseudo-studios deactivated, 55 en-dash result-line studios merged via dancer/event evidence, 2 renamed; /dance/studios top now clean.
- [x] Data cleanup — tab-name dedup (scripts/dedup_tab_studios.js): 566 StarQuest tab-variant studios merged into proven twins (≥2 shared dancer names required — same-named studios in different places are NOT assumed identical), 1,544 renamed tabs→spaces, 553 unproven kept separate + flagged.
- [x] Studio directory (/dance/studios) admin-gated to prevent bulk scraping; public discovery via search + leaderboards + featured; landing CTA repointed to hero search.
- [x] Dancer award card scales like an image (2026-08-09): fixed-aspect card is a CSS container, all internal sizing in cqw — fonts/padding/radii/icons shrink proportionally with card width on mobile; rem fallback for old browsers.
- [x] Mini-card overview for big trophy walls (2026-08-09): 4th display mode "Mini" — compact tier-icon+placement grid per year, tap opens the full card in a lightbox (which keeps tap-to-flip); auto-default on phones for dancers with 12+ awards.

### Earlier features (previously untracked)
- [x] Global feedback system with admin replies + My Feedback dashboard.
- [x] Hall of Fame curation for studio admins.
- [x] AI marketing summary generator (OpenAI) with edit tracking, AI Summaries library tab, and superadmin model-switching settings dashboard.
- [x] Organization history analytics dashboard with drill-down award details and two-step text summary generator.
- [x] Unified mailer supporting Gmail and Resend (EMAIL_PROVIDER switch).
- [x] StarQuest and Showstopper offline PDF extraction + ingestion pipelines.

### Bootstrap-era TODOs (all shipped)
- [x] Initialize Node project and install dependencies
- [x] Create SQLite schema in `database.js`
- [x] Build `scrape_dancekar.js`
- [x] Build `server.js` and Express routes
- [x] Build EJS views (`layout`, `index`, `studio`, `dancer`)
- [x] Style the application to be premium and modern
- [x] Implement Dancer Public Profile Pages (`/dancer/:unique_id`) with verified awards and stats
- [x] Add optional Email-Backed Accounts for dancers to secure their unique IDs (dancer claim flow + verified accounts)
- [x] Add Bulk Actions (Approve/Deny Selected) to the Studio Verification Dashboard (awards + roster tabs)
- [x] Implement Roster Export to CSV for Studio Admins (/manage/studio/:id/roster/export)
- [x] Add Composite Indexes to the SQLite database (e.g., `event_id, performance_name, studio_id`) to optimize backfill and search queries at scale
- [x] Implement Server-side Pagination/Lazy Loading for studio awards lists (year tabs load on demand via partials/studio_year_events)
- [x] Create automated nightly backups for the SQLite database (3am cron keep-last-7 + Litestream continuous S3 replication)
- [x] Add API Rate Limiting to `/api/claim-award` to prevent brute-forcing of Join Codes
- [x] Verify email-based claim processes (verified end-to-end in production 2026-08-08, incl. deliverability fixes)
- [x] Suggest best DB for production (decision 2026-08-04: keep SQLite + WAL + Litestream; revisit Postgres only at real scaling signals)
- [x] On Dancer page, list awards by year (year-first timeline with year dividers)
- [x] add to superadmin dashboard: number of studios have more than 15 awards, number of studios have email addresses
- [x] Make sure resend API key and email function works
- [x] Create project documentation files

### Pre-sprint DONE (original list)
- [x] Rearrange columns on /admin/studios to put 'Featured' on the rightmost side.
- [x] Add search filter by studio name to /admin/studios.
- [x] Add is_claimed field to studios table.
- [x] Display Claim/Login buttons on individual studio pages based on claim status.
- [x] Add 'Why Claim' modal to studio page detailing benefits (embed widget, customize profile, manage awards, analytics).
- [x] Add dotenv and bootstrap Superadmin account via environment variables.
- [x] Create User Management dashboard for superadmin to toggle admin roles.
- [x] Build Phase 1 of Studio Management Dashboard (Profile Editing & Basic Analytics).
- [x] Build Phase 2: Awards Editor with empty-field locking and many-to-many group dancer mapping.
- [x] Build Phase 2: Widget Builder with custom theme and color pickers.
- [x] Phase 3: Optimize Awards Editor performance using Single Edit Modal and Year-Based Pagination.
- [x] NYCDA PDF Bulk Extraction: Developed coordinate-based parsing script (`categorize_nycda.js`) to parse all 2022+ competition and convention results from NYCDA PDFs into structured text, successfully marking valid files with `GOOD-`.
- [x] Integrate Instagram and TikTok handles into Studio Profiles and Management Dashboard.
- [x] Create a `.gitignore` file for the repository.
- [x] Build automated ETL Studio Data Bootstrapping pipeline with staging tables and admin review dashboard.
- [x] Design for dancers ease of use: view/search dancers by name, join studio via code, claim group award via unique ID, color-coded badges.
- [x] Build Organizer Custom Branding Dashboard (Live Trophy Preview, Logo sliders, Taxonomy-Based Custom Icons, Legal Agreements).
- [x] Implement Organizer Marketing Profile (Slogan and Description).
- [x] Refactor Organizer Overview to Tabbed UI with Client-Side Search for past events.
- [x] Phase 2: Bulk CSV Self-Reporting with Automatic Roster Linking for missing awards.
- [x] Adjust Studio Dashboard Analytics to count total Scholarships & Invites.
- [x] Add 'Invitation' default custom icon field for Organizer Custom Branding.
- [x] Finalize Embeddable Studio Widgets (Cross-Origin Headers, Many-to-Many Group Dancers, Custom Data Filters).
- [x] Build Dancer Dashboard: Find Missing Awards search tool and Smart Auto-Backfill claiming.
- [x] Enhance Studio Roster UI: Active/Inactive tabs, status toggles, and recent awards summary popup.
- [x] Add dynamic milestone and celebratory banner for top-performing dancers on public profiles.
- [x] Implement Awards Editor advanced grouping (by Event, Routine, Dancer) with multi-year sorting capabilities for Studio Admins.
