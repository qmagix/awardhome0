# Application Features

This document outlines the core features of the Dance Awards Platform.

## 1. Platform Structure
- **Public Directory:** Searchable homepage featuring top and featured studios.
- **Organization Dashboards:** Tabbed interfaces showing competition history grouped by year.
- **Studio Profiles:** Public pages displaying bio, logo, social links, and a searchable awards table.
- **Dancer Profiles:** Public pages displaying verified affiliations and a consolidated list of solo and group awards.

## 2. Studio Management Portal
- **Claim System:** Two-tiered approval (Automated Fast-Track vs Admin Review) to take ownership of a studio.
- **Profile Customizer:** Edit bio, update logos, and link Instagram/TikTok handles.
- **Widget Builder:** Generate copy-paste iframe code with custom color pickers to embed awards on external websites.
- **Awards Editor:** Add existing dancers to awards, manually input missing awards, and group awards by Event, Routine, or Dancer. Includes sorting options to organize awards alphabetically by name or chronologically by the most recent year.
- **Roster Management:** View the studio's full dancer roster and cycle the Secret Join Code.
- **Verifications Dashboard:** Approve or deny pending award claims submitted by dancers.

## 3. Dancer Experience
- **Award Claiming:** Dancers can click "+ Add Me" on any award to link it to their profile.
- **Find Missing Awards:** A dedicated search tool in the Dancer Dashboard allows students to scan the entire global database using their name and an optional studio prefix. This searches for scraped dummy profiles and lets dancers submit claims for unlinked awards.
- **Unique IDs:** Dancers are issued a Unique ID to rapidly claim future awards without needing the Studio Code.
- **Smart Auto-Backfill:** Whether claiming via the public directory or the Missing Awards search tool, claiming one award automatically queries and claims all other awards for the exact same routine at the same event.
- **Privacy:** Roster lists are hidden from the public; dancers only appear on the awards they claim.
- **My Dancers dashboard (`/my-dancers`):** the home surface for parent/dancer accounts — every
  dancer the account owns (a parent may manage several kids) with links to the trophy case,
  profile management, and card extras, plus the live status of claims still in review ("awaiting
  your studio director (X)" vs "awaiting AwardHome review" vs "not approved"). Linked as
  "My Dancers" in the nav for `user`/`dancer_owner` roles, and the post-login landing for any
  account with a claimed dancer or a claim in flight (previously such accounts landed on the
  generic homepage with no sign their claim existed). Legacy `/my-dancer` redirects here.
- **Profile claims with studio-code routing:** the dancer profile claim form takes an optional
  Studio Claim Code (`studios.join_code`). A code matching one of the dancer's affiliated studios
  routes the claim to that studio director's Verifications dashboard ("Profile Claims to Confirm",
  with an email ping) — the director confirms family identity and approval finalizes with no
  system-admin step. The code proves community membership, never identity, so it routes rather
  than auto-approves. Claims without a code (or with a wrong one, flagged "✗ Bad code") go to the
  system-admin queue at `/admin/claims`, where valid-code claims also appear as backstop with a
  "✓ Code" badge. Approval auto-rejects competing pending claims for the same dancer, and every
  decision (either path) emails the claimant — approvals deep-link to the card-extras page.

## 3a-2. Dancer & Studio Attribution on Award Cards (2026-08-28)
Solo cards carry the dancer's name on the front (`.card-dancer-line`, the strongest line of the
identity block; group fronts stay roster-free — the certificate back says "together with
teammates"). On the event-page lightbox the solo dancer's name links to their profile when
claimed. Every award card also carries the studio the routine competed with — a muted identity
line just above the event line (`.card-studio-line`, cqw-scaled with the rem fallback; hidden in
mini-mode via its `sub-category` class), and on the certificate back as "of <studio>" under the
dancer's name. The name always shows (it's part of the verified record and travels with every
shared screenshot); a **claimed** studio's name upgrades to a link to its public page (dotted
underline; `stopPropagation` so the tap doesn't flip the card). Design decision: claiming
enhances, never gates — a nameless card would advertise unclaimed status (the same leak the org
cards avoid) and would punish the dancer's card to pressure the studio. Wired through the dancer
page, the card manager, and the event-page lightbox payload (`card.studio {name, uid}` — uid
present only when claimed). FAQ: studio admin §14 (dancer FAQ intentionally untouched — the studio line is self-explanatory to dancers).

## 3b. Award Card Designs (A/B)
Two selectable card designs render on public dancer pages. The site-wide default is a superadmin
setting (`card_design` at `/admin/settings`); any visitor can preview a variant per session with
`?card_design=classic|flipbook` on a dancer page (`?card_design=default` clears the override).
The registry lives in `utils/cardDesign.js` — future designs are added there and branched on in
`views/partials/dancer_award_card.ejs`.

- **Classic (original):** two faces — trophy front, champagne certificate back with the share button.
- **Rafters (2026-08-24):** the classic anatomy reskinned in the Rafters design language — engraved
  stage-black front, gold hairlines + base strip, Cinzel display type (font ships as a data URI in
  `public/css/card_rafters.css`, loaded only when the resolved design is `rafters`). Tier medal
  colors, org coins, verification badges, and the certificate back all carry over; no flipbook
  pages. Pure CSS via `.flip-card.card-rafters` — preview with `?card_design=rafters`.
- **Flip-book (new):** the back becomes a swipeable mini-book. Pages materialize only when their
  approval-gated content exists, so the first flip always lands on a complete certificate:
  1. **Certificate** — "Presented to …" (always present; share button lives on the back across pages).
  2. **Photo** — per-award photo first (usually that routine's performance shot, stored per
     award+dancer in `award_card_photos` so each family controls their own dancer's card on group
     routines; rectangular frame + routine-name caption), falling back to the dancer's default
     card photo (circular medallion, `dancers.card_photo_*`). Both uploaded at
     `/manage/dancer/:id/card` by the dancer owner or a studio owner of an actively affiliated
     studio, consent checkbox required, public only after superadmin approval.
  3. **Acknowledgements** — per-award thank-you lines (280 chars). Group routines get one line per
     teammate ("yearbook back") stored in `award_acknowledgements`; the viewing dancer's line is
     pinned first. Every line/edit is superadmin-moderated before display.
  4. **Organizer colophon** — "Presented by": the org's coin logo shown large plus an optional
     owner-editable tagline (`custom_icons.colophon_message`, Branding page). Rides the existing
     logo-approval gate.
  - Navigation: tap flips, arrows/dots/swipe page through the back-stack, arrow keys when focused;
    wrap-around. All sizes are cqw-based so pages zoom with the card (portrait + landscape).
  - **Same-routine propagation:** one routine often wins several awards at one event; saving a
    note or award photo auto-fills the matching awards (Smart Auto-Backfill rule: same
    `event_id` + `performance_name`, INSERT OR IGNORE — awards already filled keep their content,
    and later edits change only that award; clearing clears only that award). Moderation matches:
    one approve/reject settles every pending copy with identical content from the same dancer.
  - **WYSIWYG editor** (`/manage/dancer/:id/card`): owners edit cards as cards, not forms — the
    page renders the dancer's actual flipbook cards (`cardEditMode` flag on the partial); pages
    that would only materialize with content materialize as editable placeholders ("Upload this
    routine's photo" / "Write your thank-you note here"), never on public pages. Inline saves via
    fetch (`?json=1` on the card endpoints) with propagation toasts; front faces carry a
    waiting/partial/done chip; filter chips + incomplete-first sort; one-time consent as a
    checkbox bar above the grid. The dancer's default card photo + consent also live on the
    Manage Profile page.
  - Moderation queue: `/admin/card-content` (superadmin) approves/rejects pending photos and lines.
  - Design intent: the multi-face structure is also groundwork for auto-generated social video
    shorts (flip through faces with audio) — see ideas.md.

## 3c. Release & Moderation Infrastructure
- **Feature flags (deploy ≠ release):** `feature_flags` table + `utils/featureFlags.js`
  (`flagOn(key, req)`, 15s in-process cache). States: `off` (nobody), `beta` (admins +
  `users.early_access`), `on` (everyone); an optional `flip_at` promotes to `on` lazily on read —
  scheduled releases with no cron. Superadmin release console at `/admin/features`. Surfaces must
  pass flags explicitly to the card partial (absent = off, so a forgotten pass can't leak a dark
  feature); write endpoints are gated server-side too. Current flags: `thank_you_notes`,
  `award_photos` (both ship dark on prod migrate), `auto_moderation`. New flags: add to
  `FLAG_DEFS`, gate surfaces with `flagOn()`.
- **Auto-moderation of thank-you notes** (`utils/moderation.js`, gated by the `auto_moderation`
  flag): tier 1 rules (links/emails/phone numbers/social handles — spam AND minor-PII protection —
  plus profanity), tier 2 trusted authors (≥3 approved notes skip the API), tier 3 OpenAI
  Moderation API (`omni-moderation-latest`, free). `moderation_mode` setting (`/admin/settings`):
  `manual` (queue everything — launch default), `assisted` (🤖 verdict hints in the queue),
  `auto` (machine-clean notes live instantly; flagged ones queue with reasons). API failure never
  auto-approves. Propagated copies inherit the verdict. `/admin/card-content` gains a "Recently
  Auto-Approved" trust-but-verify feed with one-click revoke (pulls identical copies together).
  Photos remain human-reviewed regardless of mode.

## 2b. Group Routine Dancers (studio owners)
- **The problem:** competitions rarely publish who danced in group routines, so imported group
  awards have no cast — and the per-award edit modal made fixing that painful at scale.
- **The page** (`/manage/studio/:id/group-dancers`, in the management sidebar + onboarding
  checklist): every group routine listed by year (solo-typed awards excluded), missing-cast
  routines first, with a progress header ("N of M routines have dancers listed") and the current
  cast as removable chips.
- **Paste-a-list input:** one name per line, commas, or semicolons — parsed, whitespace-normalized,
  deduped, capped at 60.
- **Preview-then-apply (duplicate safety):** preview classifies each name with NO writes —
  ✅ exactly one roster match (shown with award count + active years) links by default, with a
  pre-checked "same dancer" checkbox the owner can UNTICK to create a separate record instead
  (an 18-year-old and a 6-year-old can share a name within one studio); ➕ unknown name creates
  a dancer on the roster (same-named dancers at other studios are irrelevant — records are
  per-studio by design, so no note is shown); ⚠️ two+ roster dancers share the name → owner
  picks which one (or "none of these" → new record). Confirm applies the cast to EVERY award
  that routine won that year (`INSERT OR IGNORE`, so re-applying is safe).
- **Same-name disambiguation aids:** every candidate shows their 3 most recent routines (award
  counts/years can coincide; routines are what a director actually recognizes), and directors can
  set a **private tag** per dancer (`dancer_studios.label`, ≤40 chars, e.g. "Senior Mia") —
  editable inline in the ambiguous picker and on the roster page (click the 🏷/＋ tag next to a
  name). Tags appear across studio-management surfaces (candidates, cast chips, roster) and never
  on public pages.
- **Server safety:** chosen dancer ids must be on the studio's roster with the submitted name;
  removal deletes links only, never dancer records. Activity `group_cast_added` feeds the
  featured engine + onboarding. FAQ §8b documents it for owners.

## 2c. Link Provenance & Removal Tombstones (three-source reconciliation)
- **The model:** dancer↔award links are sourced assertions. `award_dancers.source` records who
  asserted each link (`import` — scrapers/org data, the ADD COLUMN default so importers need no
  changes; `studio_owner` — self-report, CSV, awards-editor, group-cast page; `dancer_claim` —
  claim + auto-backfill flows; `admin`), `created_at` records when (stamped by DB trigger
  `trg_award_dancers_created`, so no writer can forget). Legacy rows: claim-flow links were
  recovered from `status`; the rest predate provenance and read as `import`.
- **Tombstones** (`award_dancer_removals`): when a director deliberately removes a link — denies
  a claim in Verifications (single or bulk), removes a dancer in the awards editor, or removes a
  chip on the group-dancers page — the (award, dancer) pair is tombstoned. **Automated paths must
  check tombstones before inserting**: dancer auto-backfill expansion already does; any future
  cast-bearing import (org uploads!) must too. Explicit human claims are still allowed over a
  tombstone (they land `pending` — the director's queue referees the dispute), and a director
  re-adding by hand clears the tombstone.
- **Surfaced provenance:** group-dancers cast chips are styled by source with tooltips + legend —
  plain gold = imported, 👤 = added by the studio, blue ✓ = dancer-claimed & verified, dashed ⏳ =
  claim awaiting verification. Dancer merges carry source/status/created_at to the surviving record.
- **Design rule for the future org-upload pipeline:** org-supplied casts arrive as *suggestions*
  diffed against the director's cast (preview-then-apply + verification queue), never as silent
  writes. See conversation log 2026-08-23 / TODOS.

## 2d. "The Rafters" Design System (DEFAULT since 2026-08-24)
The Rafters design is the site-wide default on every public surface: landing (`/` serves the
"hybrid" `public3/`), app homepage (`index_v2.ejs`), studio (`studio_v2.ejs`), org (`org_v2.ejs`),
and dancer (`dancer_v2.ejs`) pages. `?design=v0` is the classic escape hatch on each of those
routes (instant rollback = flip the conditional back); `?design=rafters` still works as an alias
for the default, and `/?design=rafters` serves the full "Front Door" landing variant (`public2/`).
Admins keep `index_admin` as their `/dance` default (working tool — linked org cards, shortcuts).
Award cards were deliberately NOT part of the chrome cutover — the card default remains `classic`
in the registry (§3b) until feedback settles the `rafters` card variant.

The studio page (originally built as the owner-conversion preview):

- **Concept:** championship-arena narrative instead of a stats dashboard — spotlight hero with an
  engraved-serif studio name (Cinzel, embedded as a data-URI in `public/css/studio_v2.css`, so no
  font CDN), a lifetime-record strip, then "The Rafters": every National Grand Champion win
  (`award_type/category LIKE '%National Grand Champion%' AND is_first_place=1`) as a hanging
  banner. Below: awards-per-season bar chart, per-circuit totals, Hall of Fame restyled as a
  trophy shelf, the year-tab award ledger, dancer-count "Company" strip, and a closing
  owner-conversion section (claim pitch when unclaimed; dashboard/widget/roster quick links for
  the owner).
- **Parity with classic:** same prefs gating (`show_*` keys, Hidden chips for the owner), same
  owner-private stats (Events Attended, Past 5 Years — 🔒 chips), same claim modals and
  `/api/claim-award` flow, same lazy year loading via `/api/studio/:id/year/:year` (reuses
  `partials/studio_year_events`; v2 CSS restyles it in place), same pending-claim state.
- **Implementation notes:** all v2 styles are `v2-`prefixed and scoped under a `.v2` wrapper in
  `public/css/studio_v2.css` (also undoes the global heading border-left inside the wrapper); the
  three extra queries (title banners, yearly series, top-dancer initials) run only when the flag
  is present, so the classic page pays nothing. Smoke check: "Rafters design preview renders".
- **Origin:** static concept mockup lives at `design/studio_page_mockup.html` (real Triple Threat
  data, self-contained).

### Dancer edition (`/dancer/:unique_id?design=rafters`)
Rafters chrome around untouched award cards: spotlight hero (headshot coin, Cinzel name,
affiliations, record strip, milestone line, claim/manage/share CTAs), "The Case" section with the
classic display-mode machinery reused verbatim (mini/portrait/landscape/table toggle, lightbox,
sortable tables, flipbook.js, reactions). `public/css/dancer_v2.css` explicitly restores the
cards' inherited fonts inside the `.v2` wrapper so cards render pixel-identical to the classic
page. Composes with the card registry: `?design=rafters&card_design=rafters` shows the full
engraved look.

### Organizer edition (`/dance/org/:slug?design=rafters`)
The same design system applied to the public org page (`views/org_v2.ejs` +
`public/css/org_v2.css`, which layers org-specific pieces on top of `studio_v2.css` — the font
and shared chrome load once). Audience: competition organizers — this page doubles as the demo
link in invitation letters. Thesis: reach + permanence + "your brand on every card".

- **Sections:** spotlight hero with reach record (awards preserved, dancers celebrated, studios
  reached, events archived, national titles crowned) and the registration-site CTA; awards-per-
  season chart with per-year event counts; **The Coin** — a tilted share-card mock carrying the
  org's logo *only if fitted & approved* (`custom_icons.logo_approved`, same gate as real cards;
  otherwise "YOUR LOGO HERE"), plus the concierge pitch; **The Champions** — top 6 studios by
  awards, linking to their studio pages; **The Archive** — year tabs over the full event list
  (org-name prefix stripped from rows; event links stay admin-only); closing organizer section —
  owner sees branding/profile/dashboard links, everyone else sees the status-free
  `hello@awardhome.com` pitch (improves on classic, which shows a "Claim This Page" button only
  for unclaimed orgs — a status leak).
- Extra queries (dancers reached, titles, yearly series, top studios) run only under the flag.

## 1b. Homepage Org Cards — Deliberately Unlinked + Demand Telemetry
Public homepage org cards do **not** link to `/dance/org/:slug` — a deliberate decision
(2026-08-24): org data stays low-profile until the org partners with us. The org page route
itself remains public because it's the demo link in invitation letters ("your events are live
today — see [org page link]"); it's just not discoverable from the homepage. Org cards must stay
free of any claimed/unclaimed signal (same reasoning as the no-public-claim-button rule).

- **Click telemetry:** clicking a card records demand instead of navigating — `POST
  /api/org-card-click` (CSRF-covered, rate-limited, admins excluded, deduped per org per browser
  session) inserts into `org_card_clicks`; the visitor gets a "profiles coming soon" toast.
  Public homepage renders increment a `dance_home_views` day-counter in `daily_counters` as the
  impression denominator (admin homepage renders don't count — its cards are linked).
- **Where it surfaces:** `/admin/orgs` "Card Demand" column — 30-day clicks + CTR badge against
  30-day homepage views. This is outreach ammunition: "X% of homepage visitors tried to open
  your page" gives orgs an incentive to partner and get their page linked.
- **Rollout intent:** when an org partners/approves, flip its card to a real link (per-org,
  future work — likely a flag on the organizations row).

## 3d. Social Reactions on Award Cards (flag: `reactions`, ships dark)
- **What it is:** cheer (👏) / love (❤️) chips pinned to the bottom-right corner of every award
  card in a dancer's public trophy case. Tap toggles; counts show on the chip; the viewer's own
  reactions render highlighted on reload. No account needed — friends and family react via a
  1-year signed anonymous cookie (`ah_rk`, HMAC over `SESSION_SECRET`); logged-in users react as
  themselves (`u:<id>`), so their reactions follow them across devices.
- **Storage** (`utils/reactions.js`): separate `reactions.sqlite` (the `sessions.sqlite`
  precedent) — write isolation from app data + keeps tap churn out of the main DB's Litestream
  stream (own replica entry in `litestream.yml`, 60s sync; **restart litestream.service after the
  deploy that first ships this**). Self-creating schema: one `reactions` table,
  `PRIMARY KEY (award_id, reactor_key, type)` making toggles idempotent. Counts merge in app
  code — no cross-DB JOIN.
- **API:** `POST /api/award/:id/react` (`{type: 'cheer'|'love'}`) → `{mine, count}`. Flag-gated
  (404 while dark), CSRF-covered, rate-limited (`REACT_RATE_LIMIT`, default 60/5min/IP), validates
  the award exists.
- **UI:** chip sits inside `.flip-card` but outside `.flip-card-inner`, so it stays put while the
  card flips; sized in cqw per the card design system (px fallback). Hidden in mini-mode grids
  (the lightbox clone shows it). `public/js/reactions.js` uses one capture-phase delegated
  listener: taps never reach the card's flip handler, and lightbox clones work without re-binding.
  Not rendered on manage/editor surfaces (locals absent = hidden).

## 4. Superadmin Controls
- **Data Drafts / ETL Triage:** Review scraped web data (emails, addresses) before merging into live studios.
- **Role Management:** Promote standard users to admins.
- **Organization Management:** Full CRUD interface for adding, editing, and deleting Competition Organizations.
- **Studio Deduplication:** An automated system (`dedup_studios.js`) that identifies duplicated studios containing geographic suffixes (e.g., "Studio X, CA"), merging them into their base name and maintaining an internal `aka` alias field to prevent data fragmentation.

## 4b. Award Vocabulary Batch Editor (superadmin)
`/admin/orgs/:id/award-vocab` (linked as "Vocab" on `/admin/orgs`). The scraped data mixes real
awards ("National Grand Champion", titles) with adjudication levels ("Diamond") and size
categories ("Grand Lines") in `award_type`/`category` — this surface is the cleanup tool:

- **Scope selector:** entire organization or a single event; every action applies to the scope.
- **Batch rename:** distinct values listed with counts; renaming merges variants (rows combine on
  reload). Blank values are shown but not renameable.
- **Mark top awards:** flags every award carrying a value (in scope) as `awards.is_top_award` —
  the hook for surfaces that need each org's genuinely top honors (marquee picks, future HOF
  logic). ★ badges show full/partial marks; filter boxes handle large vocabularies (KAR has
  ~6.8k distinct type strings org-wide — use per-event scope or the filter).
- Endpoints are superadmin-gated + CSRF-covered; column added by idempotent migration and
  defensively by the routes.

## 5. FAQ & Instructions Documentation
- **Studio Admin FAQ (`/faq/admin`)**: Outlines how to claim a studio, customize the profile, manage the roster using the Secret Join Code, approve/deny claims, handle multi-studio "Pseudo-Studio" collaborations, and embed the Widget.
- **Dancer FAQ (`/faq/dancer`)**: Explains how to create a profile via award claiming, the difference between the Unique ID and Studio Code, what the colored verification badges mean, how Smart Auto-Backfill works, and privacy guarantees.
- **Global Footer Navigation**: Both FAQ pages are permanently linked in the website footer for easy accessibility from any page.

## Upcoming Events Directory — "Plan Your Season" (2026-08-26, phase 1)
- `org_upcoming_events` table: organizers' future tour stops (name, city/state, venue, start/end dates, registration link). `source` records provenance — `owner` (dashboard-entered, authoritative, never overwritten by automation), `seed` (hand-curated from official sites via `scripts/import_upcoming_txt.js`), `scraped` (reserved for phase 2).
- Organizer dashboard "Upcoming Events" tab (`/manage/org/:id?tab=upcoming-events`): add/edit/remove tour stops; past stops dim automatically; superadmins can manage any org's list through the same UI.
- Public directory at `/dance/events`: all orgs' future events, filterable by state / month / competition, grouped by month, with Register (or Official Site) links. Org names are deliberately plain text, not links — same low-profile rule as homepage org cards. Unlisted/hidden orgs are excluded.
- "On Tour" section on the Rafters org public page (between Champions and Archive) whenever the org has future dates; owner strip gains a "Tour dates" link; homepage circuit section links to the directory.
- Freshness guardrails: every public surface shows only `status='active'` rows with end (or start) date >= today, plus a "confirm with the organizer before booking travel" note.
- Weekly refresh (phase 2): `scripts/scrape_upcoming_events.js` scrapes 10 orgs' published schedules (three markup flavors: KAR-family `.event-details` grids, Ultra's `.sc_events_item` theme, DanceBug `events_list.php?ifid=N` widgets — ifids verified against hand-checked data 2026-08-26) and upserts into `org_upcoming_events` as `source='scraped'`. Owner rows are never touched; unmatched seed/scraped rows converge onto scraped naming when the org+date+city match is unambiguous; after a healthy scrape (>=5 rows) future rows the scrape didn't see get `status='unlisted'` (hidden, never deleted). Runs in the Monday weekly pipeline against the staged DB; dry-run by default, `--only=key` to scope, `DUMP=1` prints parsed rows. Not scraped (bespoke sites — manual/dashboard updates): YAGP, NYCDA, Showstopper, StarQuest, Spotlight, Encore.
- Phase 3 planning tools (2026-08-26): **Near me** — browser geolocation (explicit opt-in; coords ride the query string for one request, never stored) + per-event lat/lng (KAR-family sites publish data-lat/lng, captured by the scraper; everything else geocoded once via `scripts/geocode_upcoming.js` into the committed cache `scripts/seed/city_coords.json` — Nominatim only for cache misses, 1.1s apart; regional nicknames like "Quad Cities" hand-entered). Haversine distance sorts within each month group, radius filter 100/250/500 mi, un-geocoded rows stay visible. **Shortlist** — `event_shortlists` table, star toggle (`POST /api/upcoming/:id/save`, any signed-in account), "My Shortlist" filter (`?saved=1`, login-gated). **Calendar export** — `/dance/events.ics` renders the current filtered view (or shortlist) as all-day iCalendar events (stable UIDs `upcoming-<id>@awardhome.com`, exclusive DTEND, escaped text) for Google/Apple/Outlook. Weekly pipeline geocodes new cities after each scrape.
- Seed importer: `node scripts/import_upcoming_txt.js [file] [--apply]` reads a committed pipe-format seed file (default `scripts/seed/upcoming_events_2026.txt`) — idempotent on org+start_date+city, updates seed rows in place, never touches owner rows; run identically on local and prod (parity rule).

## Gold Register buttons — first revenue stream (2026-08-27)
- **Model:** in the Upcoming Events directory and org-page "On Tour" sections, Register buttons default to the ghost style; featured events render in gold. Gold = `organizations.is_sponsor` (org-wide partner tier, superadmin "Sponsor" toggle on /admin/orgs) OR `org_upcoming_events.gold` ('free' | 'paid', per event). **Emphasis only — listing order, dates, and results are never sponsored**; that neutrality is the product being sold.
- **Launch mechanics:** every organizer gets ONE free gold button, placed/moved from the dashboard's Upcoming Events tab (`POST /manage/org/:id/upcoming/:eventId/gold`, action 'free' relocates it; admins may mark 'paid' or clear). Free golds were seeded onto each org's earliest upcoming event, so the directory shows gold from day one. Additional buttons are per-event purchases opening **October 15, 2026** (~1 month post-launch) — a synchronized market open, so no organizer can watch an empty early window and conclude nobody's buying. Purchases handled off-platform (email) for now; superadmin marks paid.
- **Disclosure doubles as marketing:** directory footnote — "Gold Register buttons are featured placements from partner organizers — one of the ways AwardHome stays free… Listing order is never sponsored." Organizer FAQ "What does this cost?" explains the model openly (core free forever; first gold free; extras from Oct 15).

## Partners page (2026-08-27)
Public `/partners` (routes/partners.js + views/partners.ejs; footer link) — inbound
mini media-kit for sponsors/press/organizers arriving through the front door:
live platform stats (10-min `partner-stats` cache), inquiry form (name/company/
email/category/message) with honeypot + 5-per-hour-per-IP rate limit + global
CSRF; rows land in `partner_inquiries` (schema in database.js, defensively
created by the route), reviewers emailed per inquiry (getReviewerEmails chain),
PRG redirect to `?sent=1` thank-you banner. Deliberately OUTSIDE the beta gate
(must work for outsiders during the pre-launch invite window). Deliberate NOs
(2026-08-27): no public investor page (industry norm — public investor forms
attract ~100% spam; quiet hello@ line + private one-pager on request instead)
and no AI-assisted intake (simple form wins at this volume; AI assists in the
founder's inbox, not on the site). Placement details REMOVED from the public
page (2026-08-27): don't anchor prospects to a short menu, don't signal "that's
all", and public brand-placement talk on a minors-first platform risks reading
as exploitation to families — the placement deck lives in docs/partner_pitch.md
(PRIVATE, per-prospect replies only; sponsor-credit-page item is IP-gated).
