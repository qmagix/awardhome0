# TODOS and DONE

## TODO

### Data quality
- [x] (DONE 2026-08-25) "Play Video" title contamination: the KAR/Rainbow results site nests a "Play Video" link in the routine cell and .text() concatenated it into 173,210 titles (125,465 KAR + 47,745 Rainbow — no clean twins, pure rename). Scrapers fixed (scrape_kar_year/scrape_rainbow/scrape_dancekar strip the suffix), cleanup via scripts/fix_play_video_titles.js (dry-run default, --apply; run identically on local + prod). Root cause of the 2026-08-24 RED import review (suffixed refetch != clean prior row -> idempotency break); dismiss that held import — the next weekly run is clean.
- [ ] Review the 553 flagged same-name-no-evidence studios (needs_investigation=1, still tab-named) — possibly distinct studios sharing a name; merge or clean case-by-case.
- [ ] Clean-vs-clean duplicate studios: 892 same-normalized-name groups with no tab member (case/punctuation variants like "ELITE DANCE ACADEMY" vs "Elite Dance Academy") — needs the same evidence-based approach.
- [ ] Studio+teacher concat records from the StarQuest import (e.g. "Lanzi Academy Of Dance Christina Lanzi" #16125) — detect and merge into the base studio.
- [x] (DONE 2026-08-09 via scripts/backfill_showstopper_dancers.js, applied local+prod identically: 241 awards completed, 2,413 dancer links added — 2,227 matched existing rosters, 192 created; split names reconstructed, lone-word fragments never become dancers.) Showstopper dancer backfill: awards had fewer linked dancers than the re-extracted txt lists (overflow name lines were swallowed by the old extractor bug).
- [x] (FIXED 2026-05-25, 4ba2911: all importers now match dancers by name+studio, creating separate records per studio; fix_duplicate_dancers.js split the pre-existing mixed unclaimed records — verified 2026-08-10: "Angela Zhang" is 10 clean per-studio records.) Dancer same-name mixing bug (duplicate_name_bugs.md is stale).
- [ ] Admin dancer merge/split tools — the remaining half of the same-name work: merge records for a real dancer who trains at / moved between studios (split records are now the default), split any claimed profiles the 2026-05-25 cleanup skipped.

### Security / launch
- [x] (DONE 2026-08-19) Anti-scrape rate limit: per-IP limiter (PROFILE_RATE_LIMIT, default 100/5min, admins exempt) on the five enumerable surfaces — /dance/studio/:id, /dance/studio/:id/first-places, /api/studio/:id/year/:year, /dancer/:unique_id, /widget/studio/:id; smoke suite bursts a profile to verify the 429.
- [ ] Anti-scrape follow-up: consider Cloudflare bot-fight / managed challenge rules on top of the app-level limiter.
- [ ] Launch-day SEO: sitemap.xml for studio/dancer pages (replaces the public directory as the crawl path once BETA_MODE=false).

### Features
- [x] (DONE 2026-08-24) Homepage org-card demand telemetry: cards stay deliberately unlinked (org data low-profile until the org partners — recorded in CLAUDE.md deliberate decisions); clicks recorded via POST /api/org-card-click + dance_home_views impressions; CTR surfaces in /admin/orgs "Card Demand" column as outreach ammunition. See features.md §1b.
- [ ] Per-org card linking: when an org partners/approves, flip its homepage card to a real /dance/org link (likely a flag on the organizations row).
- [x] (DONE 2026-08-24) Studio page "Rafters" design preview: alternate owner-conversion design on `?design=rafters` (views/studio_v2.ejs + public/css/studio_v2.css), same route/data/prefs/claim flows as classic; static concept mockup in design/studio_page_mockup.html. See features.md §2d.
- [x] (DONE 2026-08-24) Rafters CUTOVER: Rafters is the default on all public surfaces (landing = hybrid public3/, /dance = The Hall for non-admins, studio/org/dancer = v2 views); ?design=v0 = classic escape hatch everywhere, ?design=rafters = alias; preview ribbons removed; admins keep index_admin. Card default stays classic (registry decides separately).
- [x] (DONE 2026-08-24) Landing champions ticker fed from public/marquee_awards.txt (one top award per organizer, pipe-separated, # comments; empty file hides the ticker) — replaces the hardcoded all-KAR/Rainbow list that could read as favoritism to other organizers. Edit the file + deploy to change it.
- [x] (DONE 2026-08-24) Award vocabulary batch editor (superadmin): /admin/orgs/:id/award-vocab — batch-rename award_type/category per org or per event, mark top awards (awards.is_top_award). Marquee list corrected to real National Champions / Title Winners (Grand Lines = size category, Diamond = adjudication level, Pas de Deux = category — not awards).
- [ ] Award data cleanup pass (Q, manual): go through each org's award types/categories in the vocab editor, correct mislabeled values, and mark the true top awards per event; Spotlight/Encore/Epic/Nexstar still need marquee entries once their data supports one. Future: wire marquee/HOF picks to is_top_award.
- [ ] Rafters post-cutover: gather feedback from studio owners + org contacts on the live design; decide the rafters CARD variant default (/admin/settings); align landing/org marketing mock cards to the winning card design before invite letters go out; eventually delete classic views + v0 flag once confidence is total.
- [x] (DONE 2026-08-24) Dancer page Rafters chrome preview (/dancer/:uid?design=rafters, dancer_v2.ejs + dancer_v2.css — cards untouched) AND "rafters" award-card variant in the card-design registry (?card_design=rafters, card_rafters.css, third radio on /admin/settings). The two compose. See features.md §2d + §3b.
- [x] (DONE 2026-08-24) /dance homepage "The Hall" preview on /dance?design=rafters (index_v2.ejs + dance_home_v2.css layered on studio_v2.css): search-first hero with cached platform totals, restyled circuit cards (still unlinked + click-tracked), featured-studio marquee (hidden when none), full leaderboard machinery reused (same endpoints/partials), three-doors band. Admins see it under the flag too.
- [x] (DONE 2026-08-24) Landing "hybrid" third variation in public3/ (/?design=hybrid): original's two-column hero, two-color AwardHome wordmark, floating visual + glow orb — on the Front Door system (Cinzel, search-first, real numbers, ticker, doors).
- [x] (DONE 2026-08-24) Landing page "Front Door" redesign candidate in public2/ (static, self-contained — open public2/index.html to compare against landing/): search-first hero ("Your awards are already home"), real platform numbers, champions ticker, share-card fan, three doors, permanence section. Wired 2026-08-24: /?design=rafters serves it (bypasses the logged-in redirect for previewing); landing/ still serves / by default.
- [x] (DONE 2026-08-24) Org page "Rafters" organizer edition on /dance/org/:slug?design=rafters (org_v2.ejs + org_v2.css layered on studio_v2.css): reach hero, season chart, "The Coin" share-card mock (approval-gated logo), champions wall, year-tabbed archive, status-free organizer pitch. Use as the demo link in invitation letters once blessed. See features.md §2d.
- [x] (DONE 2026-08-13) Feature-flag release infrastructure: feature_flags table (off/beta/on + lazy scheduled flips), flagOn() cached helper, /admin/features release console, early_access beta cohort column; thank_you_notes + award_photos ship dark on prod migrate; all card surfaces and write endpoints flag-gated (absent flag = off). See features.md §3c.
- [x] (DONE 2026-08-13) Auto-moderation for thank-you notes behind the auto_moderation flag: rules (links/contacts/profanity — minor-PII protection) → trusted authors → free OpenAI Moderation API; moderation_mode manual/assisted/auto on /admin/settings; queue shows 🤖 verdicts; "Recently Auto-Approved" feed with one-click revoke (pulls identical copies). Photos stay human-reviewed. See features.md §3c.
- [ ] Release-flip follow-ups: "What's New" public changelog page + release announcement email to claimed users on each flag flip; early-access opt-in toggle for users (column exists, no UI); vision-moderation pre-filter for photos + trusted-uploader auto-approve.
- [x] (DONE 2026-08-20) Social reactions on award cards behind the `reactions` flag (ships dark): cheer/love chips on trophy-case cards, anonymous via 1-yr signed cookie, separate reactions.sqlite (write isolation + own litestream replica — restart litestream.service after the deploy that ships it). See features.md §3d.
- [ ] Reactions follow-ups when the flag flips on: FAQ entry (views/faq_dancer.ejs), counts on mini-card grid / leaderboards if wanted, weekly "your awards got N cheers" digest email idea (ideas.md §5).
- [ ] Show dancer vanity chip (#Tag) on homepage leaderboard rows and share cards (field: dancers.vanity_tag, chip style: .vanity-chip; add vanity_tag to the three dancer leaderboard queries in routes/dance/public.js and render in views/partials/leaderboard_rows.ejs). The #Tag itself shipped on dancer profiles 2026-08-08.
- [ ] Email notifications for studio admins when new pending roster/award verification requests arrive (profile claims routed by studio code DO email the director as of 2026-08-13; award claims and roster joins still don't).
- [x] (DONE 2026-08-13) Dancer profile claim studio-code routing: optional Studio Claim Code on the claim form; valid code → claim routed to the studio director's Verifications queue (email ping, director approval finalizes — no admin step); no/bad code → admin queue with ✓/✗ code badges. Decision emails to claimants from both paths (approval deep-links to card extras); approving auto-rejects competing pending claims. Also fixed pre-existing 500 on /manage/studio/:id/verifications (missing dancer_studios.created_at column).
- [ ] Director-initiated profile claims (inverse flow): director enters a parent's email on a roster dancer → pre-authorized claim link, zero review (pattern: org claim tokens).
- [ ] Testimonials for organizations, studios, and dancers (makes them stand out; FAQ pages and org marketing profiles are done — this is the missing piece).
- [ ] File storage to AWS S3 for uploads (org results, branding images currently on local disk; ties into the org result submission pipeline below).
- [ ] Organization competition result submission end-to-end: upload works (org_uploads table + local disk) but the S3 storage + admin review/batch-ingestion pipeline is not built. DESIGN CONSTRAINT (2026-08-23): org-supplied casts must land as suggestions diffed against the director's cast (preview-then-apply + verification queue), respect award_dancer_removals tombstones, and results-facts (placement/routine names) take precedence over user input while casts defer to directors. See features.md §2c.
- [ ] Mobile app as a PWA (MVP). The responsive web pass is done; PWA manifest/service worker/install flow is not.
- [x] (DONE 2026-08-12) Multi-page flip-book award card: paged back-stack (certificate → photo → acknowledgements → organizer colophon), per-dancer ack lines on group cards, all owner content superadmin-moderated at /admin/card-content, A/B design switch (classic/flipbook) at /admin/settings + ?card_design= session preview. See features.md §3b.
- [ ] Flip-book follow-ups: per-page share-image rendering (canvas/off-screen render — groundwork for auto-generated social video shorts, see ideas.md §3); email superadmin when new card content lands in the review queue; certificate-page photo medallion inset.

### IP / legal
- [ ] Patent triage: have an attorney review maybe_patentable.md (Tier A first); if we commit to the flip-book card (A3/A4), consider a provisional filing BEFORE deploying it publicly.

## DONE

### 2026-08-23 — Non-enumerable public studio URLs
- [x] Public studio surfaces now resolve by studios.unique_id (STU-<hex>-slug, already present + distinct on all 18,514 rows): /dance/studio, first-places, year-tab API, widget, claim pages. Numeric ids 404 with NO redirect (an id→uid redirect would be an enumeration oracle); legacy /studio/:id 301s removed for the same reason. ~45 link generators across 25 files converted (views, login redirects, invite emails, search API, leaderboards, admin consoles); smoke asserts numeric-404 + uid-200; full authenticated route audit clean. Documented as a deliberate decision in CLAUDE.md.

### 2026-08-23 — Refactor-damage audit (prompted by the lost Compare & Merge wiring)
- [x] Three-sweep audit for silent refactor breakage: (1) runtime — every GET route hit with authenticated superadmin/owner/org-owner sessions, zero 5xx (kept as scripts/audit_get_routes.js — run after big refactors); (2) static — every onclick handler in views vs defined JS functions (3 hits, all resolved by including pages); (3) static — every form/fetch URL vs registered routes (7 hits, all false positives; /beta-unlock lives in server.js). Verdict: the two already-fixed bugs (history bare app.locals, roster merge JS deletion) were the only refactor casualties.

### 2026-08-23 — Link provenance & tombstones (three-source reconciliation, phase 1)
- [x] award_dancers.source ('import'/'studio_owner'/'dancer_claim'/'admin') + created_at (DB-trigger-stamped) on every new link; legacy claim links recovered from status. award_dancer_removals tombstones written on all four director-removal surfaces; auto-backfill respects them; explicit claims still allowed (pending → director queue referees); director re-add clears. Group-dancers chips styled by provenance with legend. Merges carry provenance. See features.md §2c; org-upload design constraint recorded in TODOS.

### 2026-08-22 — Group Routine Dancers
- [x] Group Routine Dancers page for studio owners (/manage/studio/:id/group-dancers): paste-a-list cast entry per routine-year, preview-then-apply with roster matching (link / create / ambiguous-pick for same-name dancers), applies to every award the routine won that year; sidebar link on all manage pages + onboarding step + FAQ §8b. See features.md §2b.
- [ ] Group-dancers follow-ups: "copy cast from another routine/year" shortcut; extract the duplicated manage-sidebar markup (now 8 copies) into a partial with an active-item param.

### 2026-08-21 — studio-claim walkthrough fixes (user QA on studio 62)
- [x] QA test tenant for safe manual walkthroughs on prod: `scripts/qa_fixtures.js seed|remove|status` — transient org/studio/dancers/awards, all named "(please ignore)"; deliberate decision: NO is_test discovery filters (transience + naming instead of a filter every future query must remember). `remove` is surgical (fixture keys + qa-*@awardhome.com users) and self-verifies zero leftovers. Rules: register test accounts as qa-*@awardhome.com; never leave seeded overnight (featured cron).
- [x] Pending-claim visibility: login now lands pending studio claimants on their claimed studio's page (was: generic /dance); the studio page shows a "Verification & approval pending" banner instead of the Claim button; /my-dancers explains the pending studio claim instead of pushing the dancer flow.
- [x] /manage/studio/:id/history 500 fixed: bare `app.locals` reference left from the server.js modularization (threw for every owner whose studio had awards). Smoke suite now has an authenticated owner-flow section (temp user/studio/award fixtures, real login) covering history, awards editor, pending-claim states — 59 checks total.
- [x] "– #" routine names: Rainbow stores a literal placeholder for studio-level awards; scraper now blanks it, awards editor groups blank-name dancer-less awards as "Studio Awards" (dancer awards missing names stay "Unspecified Routine"), 143 rows cleaned.
- [x] Duplicate award repair: Rainbow importer's idempotency key included derived award_class, so classifier changes re-inserted whole events — 8,838 duplicate awards (37 Rainbow events + 3 StarQuest) removed by scripts/dedup_reimported_awards.js (idempotent, deterministic keeper choice, child rows repointed). Importer key now observable-fields-only + follows studio merges + updates award_class in place. RUN ON PROD after deploy: `node scripts/dedup_reimported_awards.js`.

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
- [x] Staged import gate (2026-08-11): weekly cron now imports into a snapshot (staging_import.sqlite via sqlite .backup; DB_PATH env override in openDb + self-connecting importers), scripts/validate_import.js scores each new/changed event against the org's own history (award-count percentiles, place vocabulary, category novelty, brand-new-studio share, junk name shapes, idempotency-break ratio) → green auto-promotes (deterministic cache replay to live), amber/red HOLDS with reports/import_review_*.md + email to REVIEW_EMAIL/SUPERADMIN_EMAIL, approve via weekly_update.js --promote. AUTO_PROMOTE=never forces manual approval of green too; LLM_REVIEW=true appends a claude -p second opinion. Live DB is untouched until promotion — validates the DB delta, not the txt (a txt gate would have missed the 08-11 studio-duplication importer bug).
- [x] Post-May data catch-up (2026-08-10/11, local+prod at parity): web orgs +65 events/+36.7k awards via weekly_update.js (KAR/Rainbow/Starpower/YAGP nationals incl.); StarQuest PDFs +12 events/+4,194 awards (Galveston/Hershey/Orlando nationals; first re-import created 34,956 dup awards + 1,778 dup studios via tab-named studio lookups — purged, importer now resolves raw→collapsed names and follows merges). NYCDA: 25-26 regionals were already complete; Buffalo/Dallas/Greenville/Savannah "Results" PDFs are running-order schedules (no results published) — quarantined NOT-, 4 empty events deleted; July 2026 nationals not yet posted. Showstopper 2026 not yet posted. Pre-existing local-only quirk: local has 669 Revolution awards prod lacks.
- [x] Weekly award-data updater (2026-08-10, scripts/weekly_update.js + server.js cron Mon 5AM behind ENABLE_WEEKLY_SCRAPE): two-tier freshness — discovery pages (event lists/sitemaps) refetched every run; result pages refetched while first-seen < --window days (scrape_log, seeded from cache mtimes), then frozen; content hashes flag late edits (insert-only imports don't auto-correct changed rows). Post-steps scoped to new events only: heuristic first-place marking (utils/first_place.js, shared with admin audit pages), org_first_place_rules, dancer backfill. PDF orgs download-only + "awaiting QA" report (downloaders got URL manifests — the filename-collision loop used to re-download everything as -1.pdf). Also fixed post-modularization path breakage: fetch_cache raw/, tobeprocessed/, and 14 scripts opening ./database.sqlite relative to cwd.
- [x] Data cleanup — StarQuest scattered-space categories (2026-08-10, scripts/cleanup_starquest_names.js, applied local+prod identically): PDF fragment joining had scattered spaces mid-word ("Adult S ol o Award") and left tabs between header columns, making one real category look like many single-use ones. utils/normalize_names.js reconstructs true spacing from content; 512→316 categories, 246→146 award types, 42,671 award fields rewritten, superadmin's 12 first-place rules deduped and ported to prod (802 firsts both sides). Extractor + importer now normalize at the source. Same damage likely exists in StarQuest routine/dancer/choreographer names — out of scope here.
- [x] Persistent org-level first-place rules (2026-08-10): org_first_place_rules table; the /admin/org/:slug/categories toggle now upserts a rule AND updates awards; scripts/apply_first_place_rules.js re-applies rules after imports (--org / --event scoping; --seed-showstopper imported the 95 pre-rules Showstopper combos — applied locally, 0 drift). Run the seed + deploy on prod. Event-level toggles remain direct overrides.

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
