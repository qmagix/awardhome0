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
present only when claimed). FAQ: studio admin §15 (was §14 before the Secret Code question landed at §2, 2026-08-28) (dancer FAQ intentionally untouched — the studio line is self-explanatory to dancers).

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
- **Launch mechanics:** every organizer gets ONE free gold button, placed/moved from the dashboard's Upcoming Events tab (`POST /manage/org/:id/upcoming/:eventId/gold`; since 2026-08-28 the free button is FIXED to its event until the event passes — no relocation while active (rotation would substitute for buying; simultaneous highlighting is the product); owner 'clear' removed (same loophole); admins may relocate/mark 'paid'/clear for support). Free golds were seeded onto each org's earliest upcoming event, so the directory shows gold from day one. Additional buttons are per-event purchases opening **October 15, 2026** (~1 month post-launch) — a synchronized market open, so no organizer can watch an empty early window and conclude nobody's buying. Purchases handled off-platform (email) for now; superadmin marks paid.
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

## News (2026-08-27)
Public `/news` + `/news/:slug` (routes/news.js; OUTSIDE the beta gate so the launch
announcement is shareable pre-launch). Articles = EJS partials in views/news/ +
registry array in the route — git-versioned, publish = add partial + registry entry +
deploy; local/prod parity automatic; no CMS by design until contributors exist
(phases 2-3 in ideas.md §10). Seeded: "Why AwardHome exists" (founder origin story)
+ "AwardHome opens to the public on September 15". Links in all THREE footers
(partials/footer.ejs + public3 + public2 static landings). Byline: Sam.

## Dancer privacy controls (2026-08-28)
Two owner controls, both claimed-profile-only (privacy concern -> claim funnel):
- **Per-card hide** — `dancer_card_hidden(dancer_id, award_id)` overlay table (NOT an
  award_dancers column: preference, not link property). Public dancer page query
  excludes via NOT EXISTS; the record stays in the archive, the owner's card editor
  (Public/Hidden toggle, top-left of each card, `POST /manage/dancer/:id/card/visibility`,
  NOT flag-gated — privacy controls don't wait for release cohorts), and all studio
  surfaces. One hidden award removes N rendered instances (page pre-renders portrait +
  landscape grids — expected).
- **Rankings opt-out** — `dancers.hide_from_rankings` checkbox on Manage Profile;
  filters the three topDancers* queries (all-time / this-year / first-places). Profile
  stays reachable by search + direct link; it's exclusion from curated prominence only.
- **Search opt-out (strongest)** — `dancers.hide_from_search`, second checkbox:
  excluded from public name search (`/dance/api/search`) AND rankings (coupled by
  design — leaderboards are a name index, so search-hiding without ranking-hiding
  would be self-defeating). Page opens by direct link only; the owner's
  find-missing-awards tool and all studio surfaces unaffected. Separate checkboxes,
  not bundled: different families calibrate differently.
Copy doctrine (3rd application, 2026-08-28): moderation described as MECHANISM
("goes live once approved"), never as promise ("our team reviews") — FAQ §6/§9 +
launch article aligned. Sweep/gate/sentinel gained hidden-card + optout strata.

## Community flagging (2026-08-28)
Viewers flag USER-ADDED card content only — photos (`award_photo`/`default_photo`)
and thank-you notes (`ack`) — NEVER award facts (confirmed scope; official results
cannot be mobbed off the archive). Mechanics: quiet ⚑ buttons on the flipbook photo
page + per ack line (public render only) → `POST /api/flag-card-content` (10/hr/IP,
CSRF, one flag per content per flagger via UNIQUE, unknown-content probes get generic
success). First open flag on APPROVED content demotes it to `pending` — conditional
materialization unpublishes instantly, zero new render logic — and it reappears in
/admin/card-content. **Griefing guard:** once a human reinstates (approve resolves
flags `resolved_reinstated`), later flags only queue (⚑ "Viewer Flags on Live Content"
section, Keep/Remove via `/api/admin/flag-resolve`) — one auto-dark per content per
human decision, verified end-to-end incl. second-flagger case. Approve/reject/revoke
handlers resolve open flags. `content_flags` table in database.js.

## Demo award card (2026-08-28)
`views/partials/demo_card.ejs` — a live, playable flip-book card with fictional
data (Peacock Cup / Angela Ng / Swanlake Dance; peacock-crest coin as inline SVG
data URI) for "show, don't tell" embeds. Include with `{ demo: {...} }` overrides;
all fields optional. Inert by construction: no flag buttons (no ack_id), no studio
link, share button hidden (.demo-card-wrap .tcb-share). Embedded in organizer FAQ
Q1 (colophon-slanted: "the closing page is yours") and dancer FAQ §9 (ack-slanted).
REMEMBER: any new surface rendering flip-cards must join the container-type list
in styles.css (~line 1133) or cqw falls back to viewport units and the card
renders 3x oversized (the lightbox bug, rediscovered by this feature).
flipbook.js is now double-load-safe (swipe listeners bind once).

## Rogue-studio containment (2026-08-28)
Three layers against mass dancer-attachment abuse (public unique_ids make it
possible; approval process makes it unlikely; these make it survivable):
1. **Detect** — sentinel abuse-watch: >200 owner-sourced award links or >100
   roster adds per studio per 24h -> ABUSE-WATCH line in reviewer alerts.
   Alert-first by design (group-dancers paste-a-list makes legit bursts).
2. **Cure** — superadmin Freeze & Release on /admin/studios: provenance-SCOPED
   (releases source='studio_owner' award_dancers + dancer_studios rows only;
   dancer_claim + import links untouched), admin_freeze tombstones block
   auto-backfill re-adds, ownership revoked (frozen_prev_owner_id recorded),
   status='frozen' drops the studio from active-only surfaces. Unfreeze
   restores visibility, never ownership. dancer_studios now carries `source`
   ('import' default; 'studio_owner'/'dancer_claim' set at every app insert;
   merges copy it).
3. **Deter** — notifyRosterAttach (utils/claims.js): owner-attaching a CLAIMED
   dancer emails the family ("not your studio? tell us") — fires only on
   genuinely new links (upsert/ignore guarded), unclaimed dancers no-op.

## Events-directory analytics (2026-08-29)
What converts on /dance/events, for superadmin (/admin/events-analytics, card
on /admin). Register/Official-Site anchors carry data-event-id + data-link-type;
a fire-and-forget keepalive fetch posts to /api/upcoming/:id/reg-click
(rate-limited, CSRF via csrf.js, admin sessions excluded like all counters).
`event_reg_clicks` snapshots **was_gold at click time, resolved server-side**
(gold moves between events, sponsorships lapse — historical gold-vs-standard
comparisons must describe what the visitor actually saw). Impressions:
daily_counters 'upcoming_events_views' (page) + 'upcoming_events_ics_exports'
(calendar pulls = planning intent). Dashboard shows CTR, gold share, and the
**per-listing gold lift** (clicks per gold listing / clicks per standard
listing) — the number to quote when gold buttons go paid (Oct 15, 2026);
shortlist saves per event ride along from event_shortlists.

## Legal pages (2026-08-29)
/terms + /privacy (views/terms.ejs, privacy.ejs; routes in routes/dance/public.js;
footer links). Both tailored to the product, not boilerplate: published-results
archive framing (children's names as competitions announced them; competition
records stay authoritative), claim rules, UGC license + photo-consent, family
controls enumerated, sponsored-placement disclosure, patent-pending IP, no sale
of data, "Near me" never stored, first-party-only analytics. DMCA-conformant
takedown machinery (2026-08-29): Terms §11 names the Copyright Agent
(hello@awardhome.com) + full 512(c)(3) notice elements + counter-notice/restore
flow; §12 has the repeat-infringer termination clause. Safe harbor still needs
the $6 Copyright Office agent registration once the LLC is approved (tracked in
TODOS). Governing law:
California (Q's choice, 2026-08-29). Operator: AwardHome LLC, a California LLC
(Articles of Organization filed 2026-08-29) — named in both intro paragraphs and
the footer copyright; formation follow-ups tracked in TODOS_and_DONE.md §IP/Legal.
Attorney review still recommended (children's data / COPPA, liability cap tuning).

## Peacock Cup sample org page (2026-08-29)
`/dance/org/peacock` — a fictitious competition's organizer page for outreach
demos, rendered by `org_v2.ejs` entirely from an in-memory object
(`PEACOCK_DEMO` in `routes/dance/public.js`, registered above the `:slug`
route). Zero DB rows: platform totals, search, rankings, and the sentinel never
see it. Shows the fully-dressed claimed state — approved peacock coin
(`public/img/demo/peacock_logo.svg` — same gold-feather mark as the demo
card's coin, one consistent brand), partner badge, reach chart, champions
wall, tour dates, archive tabs — with a banner declaring it a sample and
illustrative numbers. `demoMode` flag in `org_v2.ejs` renders champion studio
cards inert (fictional studios have no pages), swaps "The Card" section's flat
`v2-card-mock` for the REAL flip-book demo card (`partials/demo_card.ejs`,
whose fictional defaults are already Peacock Cup — Angela Ng / Swanlake Dance /
"Feathers of Gold"), and points "All N tour stops" at the plain `/dance/events`
directory — the one outbound content link, kept deliberately (benefit 3 demo). `X-Robots-Tag: noindex`. Zero-events outreach
letters link here (see org_invite_draft.md v5.2); orgs with archived events
keep their own page as the demo link.

## Owner merge requests (2026-08-29)
"Merge into Mine" on the studio dashboard previously POSTed to the admin-only
merge API — owners got a silent 403 (HTML error body made the client's .json()
throw before any alert). Now owner-initiated merges are REQUESTS, reviewed by a
human (deliberate: absorbing another record's awards is the rogue-studio attack
surface). Flow: owner clicks Merge into Mine → row in `studio_merge_requests`
(pending; defensive CREATE TABLE in utils/studioMerge.js + database.js) → shown
immediately in a "Merge Requests" table on the dashboard (Pending review /
Merged / Kept separate) and the suggestion leaves the list; heads-up email to
hello@awardhome.com. Claimed sources are refused up front (can't absorb another
owner's studio). Admins review at /admin/duplicates ("Owner Merge Requests"
queue: compare link, approve-and-merge, reject) — decisions email the owner
(utils/studioMerge.js notifyMergeDecision; rejection copy stays warm). Merge
SQL extracted to utils/studioMerge.js mergeStudios(), shared by the admin
compare tool (which also settles matching pending requests when used directly).
"Not My Studio" now hits an owner-scoped endpoint (was the same silent-403
bug). Decided requests can be cleared from the dashboard ("Clear decided →
history" sets dismissed_at; pending rows can't be dismissed) — the full record
lives on the owner's Action History page (/manage/studio/:id/activity —
merge-request history incl. dismissed + a friendly-labeled studio_activity
feed). Dismissed sources stay excluded from Merge Suggestions. FAQ: studio
admin §18.

## Roster duplicate cleanup, selective merge (2026-08-29)
The roster page's Suspected Duplicates widget now supports partial merges:
every profile row has a checkbox (default: all ticked); "Merge Selected (N)"
merges only the ticked profiles (claimed > most-awarded picks the primary),
leaving unticked ones untouched so the set re-renders and twins can be merged
pair-by-pair, then "Mark as Different People" ends the flag (endpoint accepts
optional merge_ids, validated against the name+studio scope). [View Profile]
opens the dancer's trophy case in an iframe modal (logged-in sessions pass the
beta gate) instead of a new tab. All alert()/confirm() on the roster page
replaced by a shared promise-based confirm modal + toast. FAQ: studio admin §19.

## Group Routine Dancers, per-event casts (2026-08-29)
Routine cards batch by routine+year, but casts differ per event (injuries,
subs, regionals-vs-nationals lineups). Multi-event cards now list each event
with a checkbox (default all ticked = one paste covers everything); preview and
apply take optional event_ids (0 = self-reported/no event; absent = all —
backward compatible), so a round of names lands only on ticked events. Cards
show per-event coverage (✓ / "missing dancers"), a partial badge ("1 of 2 events
have dancers"), and sort/progress count by full coverage. A "Sync dancers
across ticked events" button (shown when the routine has any cast) unions the
dancers linked at any ticked event onto all ticked events' awards — ADDITIVE
ONLY, and director-tombstoned pairs (award_dancer_removals) are never
resurrected (explicit re-add via the paste flow clears tombstones; sync
doesn't). Activity: group_cast_synced. Shared confirm
modal/toast extracted to public/js/ui_dialogs.js (self-injecting; roster page
now uses it too) — group-dancers page alert()/confirm() replaced. FAQ admin §6
updated.

## Routines Missing Dancers + All Routines (2026-08-29)
Sidebar "Group Routine Dancers" renamed to "Routines Missing Dancers" with an
amber count pill (routines having >=1 uncovered event; computed by a
router.use middleware for every /manage/studio/:id GET so all hand-copied
sidebars share it) — the old name was wrong: organizers that don't publish
solo names (NexStar) turn solos into this queue's work too. New sibling page
/manage/studio/:id/routines ("All Routines"): every routine-year, groups and
solos, with award/event counts, dancers on file, sortable columns
(sortable-table) and live search across routine + dancer names; per-row status
badge either "✓ credited" or "N awards missing dancers" linking to the entry
tool. FAQ admin §6 updated.

## Canonical routine names (2026-08-29)
Phase 1: awards.performance_name_key — machine-canonical routine key
(utils/routineKey.js: NFKC, curly quotes, dashes, nbsp, whitespace, case),
indexed, filled by scripts/sweep_routine_keys.js (weekly pipeline + deploy);
readers fall back to LOWER(TRIM()) for unswept rows; performance_name itself
is never rewritten (source-of-record + importer idempotency anchor). Unified
247 studio-routine spelling variants. Phase 2: studio_routine_aliases —
owner-declared merges for true misspellings via "Merge / fix spelling" on All
Routines (tick rows -> pick or type the correct spelling; display_name shown
everywhere; alias redirects stored keys instantly; sweep applies aliases so
weekly runs preserve them; Undo recomputes the studio from scratch). Write
paths resolve client-sent spellings through aliases (routineAwardIds,
resolveDancer tie-break). Group-dancers event rows show the title "published
as" each competition printed it whenever it differs from the display name —
the human audit trail for the folding. FAQ admin §6.

## Check Routine Dancers queue semantics (2026-08-30)
Sidebar item renamed "Routines Missing Dancers" -> "Check Routine Dancers"
(solos with unpublished dancer names are queue work too, so "missing" was only
half the story). The page is now a true work queue: routines auto-leave once
every event has dancers linked; "Show all routines" (?all=1) keeps covered/
completed cards editable. "✓ Mark complete" (studio_routine_checks, keyed
studio+routine_key+year) removes what the system can't judge — e.g. a NexStar
solo whose dancer was never published — undoable from show-all or the All
Routines status column ("✓ marked complete" + Undo). Sidebar count pill
excludes checked routine-years. Activity: routine_marked_complete. FAQ §6.

## Legacy retirement + year-aware dancer matching (2026-08-30)
Empty-cast routines no longer offer any dismissal (Q: encourage filling names
in, don't make skipping easy) — the "Names unavailable" button lasted one
deploy and is gone. Retirement runs on TWO clocks, both required (Q's
correction 2026-08-30: season year is irrelevant): studio claimed >= 2 years
ago AND the routine's data entered >= 2 years ago (events.created_at import
stamp; unknown claim date or entry stamp counts as recent — never retire on
missing information). Practical effect: every owner gets a full 2-year window
from whichever came later, claiming or the import. Legacy entries are out of
the check queue and sidebar pill, badged "legacy — names never recorded" on
show-all and All Routines, still fillable forever (adding names revives). Mark complete
remains only on cards WITH dancers. Dancer resolution
(utils/resolveDancer.js) tie-break now requires name+routine+studio+YEAR when
the award's year is known (undated awards fall back to routine+studio) —
callers (StarQuest importer + repair) pass the event year.

## Delegated cast entry — "class-mom flow" (2026-08-30, BUILT NOT SHIPPED)
IP GATE: maybe_patentable §A9 — do not deploy until filed or waived.
Director clicks "✉️ Ask someone who knows" on a Check Routine Dancers card ->
popup mail modal (email + personal note, no page navigation) -> capability
link emailed (also returned in the modal for direct sharing): /cast/<token>,
scoped to ONE routine-year of one studio, 14-day expiry, withdrawable from the
card. Helper needs no account; sees per-event blocks (award counts + already-
listed dancers as context — those names are already public on award pages),
enters names per event + their own name (required — credit) + optional note.
NOTHING writes directly: submissions stage in routine_cast_submissions; the
card shows the helper's names per event with "Load into form" (fills the
paste box + ticks that event -> normal preview/apply keeps the director in
the identity loop), then "Done — credit <helper>" or Dismiss. Applied
submissions show "💛 Cast credited to <name>" on the card; all steps hit the
activity log (cast_invite_sent / cast_submission_received /
cast_submission_applied -> Action History). CSRF on the public form,
rate-limited POST, tokens 48-hex, revoked/expired links die with warm copy.

## All Routines: in-place routine card popup (2026-08-30)
The routine name and the "N awards missing dancers" badge on All Routines now
open the FULL Check Routine Dancers card in a popup — paste/preview/apply,
event checkboxes, Sync, Mark complete, and Ask-someone-who-knows all work
without leaving the page (actions reload it, so the row updates). Mechanics:
the card is extracted to partials/gd_routine_card.ejs; its interactions to
public/js/gd_card.js (document-delegated; cards carry data-studio-id so the
same script drives both pages); the invite modal to partials/gd_modals.ejs;
GET /manage/studio/:id/group-dancers/card?routine&year serves one card as an
HTML fragment (buildCheckQueueData refactored out of the page route).
Deliberately NOT built (Q): a quick Sync button on list rows — same-named
routines (ballet variations by different dancers) make sync-without-detail-view
error-prone; the popup keeps the detail view in the loop.

## Roster duplicates: batch merge-all (2026-08-30)
"No two of your students share a name? Merge all N sets at once" link in the
Suspected Duplicates widget -> confirmation modal stating the premise and the
rails -> POST /manage/studio/:id/roster/clean-all-duplicates merges every
same-name set (claimed > most-awarded primary, per-set transaction). Rails:
sets with >1 claimed profile skipped for manual review (reported in the
toast); "different people" exceptions excluded; activity-logged
(roster_batch_merged). FAQ studio admin §19 updated.

## Password reset (2026-08-30)
Previously ABSENT — a forgotten password meant emailing support and a
hand-edited row. /forgot-password (linked from the login page) emails a
single-use link; /reset-password/:token sets a new one. Security: the emailed
token is 32 random bytes but only its SHA-256 hash is stored (a DB leak can't
be replayed), 1-hour expiry, cleared on use, rate-limited via authLimiter, and
the request endpoint answers identically for known and unknown emails (no
account enumeration). A successful reset also sets is_verified (clicking the
emailed link proves address control — otherwise an unverified user who forgot
their password stayed stuck) and regenerates the session so a stolen session
can't survive the change. FAQ: dancer + studio admin.

## Organizer FAQ: gold-button pricing moved private (2026-08-30)
Removed the public pricing paragraph from "What does this cost?" (Q's call):
the free-first-button perk, per-event pricing, and the Oct 15 market date now
surface only where interest already exists — the claimed org's dashboard
(manage_org.ejs Upcoming Events tab) and private email. Public FAQ keeps the
honest business-model answer ("most features are free... sponsoring is the best
way to help") without anchoring a price before demonstrated value, matching the
commitment-ladder strategy in org_invite_draft.md. The integrity disclosure
(sponsored placement never alters results, listing order, or dates) is
unaffected — it lives in Terms §9.

## Major Awards: one definition, explained in place (2026-08-30)
`utils/majorAward.js` is now the single source for the Major Awards stat —
`isMajorAward()` for JS passes and `majorAwardSql()` for aggregates — replacing
two hand-maintained copies (public studio page SQL, owner Organization History
JS) that had drifted. Rule unchanged in intent: a first place that is a
prestige award (title/scholarship/invitation/DOY/photogenic) at a national /
finals / grand / title stage, in the award's wording or the event's.
COUNT CORRECTIONS from unification (local DB, 236,721 first places): old public
SQL 10,969 -> 13,459 (+2,490) because bare `a.category || ...` concatenation
returned NULL whenever category was NULL, silently excluding 44,953 first
places — e.g. NexStar's branded "Premier/Elite Title - Miss Nexstar" wins; old
private JS 12,686 -> 13,459 because it read `award_type || category`, ignoring
category whenever award_type existed. Counts only ever rise, so no studio loses
a previously displayed achievement.
The Organization History card's ℹ️ is now a real button (was a hover-only
`title` most users never saw) opening a popup that explains the rule in plain
language, states that the figure is public and therefore platform-wide rather
than self-editable (a self-serve definition would let a studio inflate a public
claim), lists the studio's own qualifying awards from
GET /manage/studio/:id/history/major-awards so the rule is verifiable, and
offers a "something looks wrong" mail path for classification fixes.
Year rows: the expand chevron was an absolutely-positioned `::after` pinned to
the summary's right edge, overlapping the "Major: n" figure; it is now a real
flex item at the end of the stats row (`.yr-chevron`), so it cannot overlap.
