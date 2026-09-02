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

## 2b-i. Solo "Primary Dancer" — the two-table convention (2026-08-30)
- Dancers reach an award two ways: the canonical `award_dancers` junction, and the legacy 1:1
  `awards.dancer_id`. **Solos are written to BOTH by convention** — many surfaces still read the
  legacy column, including the awards editor's "Primary Dancer" column, Hall of Fame, and the
  card queries. Groups use the junction ONLY (never the legacy column).
- Five importers had been writing the junction only, leaving **79,181 solos with no primary
  dancer**: their dancer appeared under "Group Dancers" in the editor, and rendered blank
  anywhere a query joined `a.dancer_id`. Fixed at the source (all five now call
  `setSoloPrimary()` after linking a cast), repaired by
  `scripts/backfill_solo_primary_dancer.js`, and swept weekly. Blank-dancer solo/title awards
  went 79,538 -> 357.
- **`utils/soloPrimary.js` holds the single definition of "belongs to one dancer"**, used by the
  backfill, the importers, and the editor so they cannot drift. Identification is POSITIVE — the
  label (`award_type` + `category`, never `performance_name`) must say solo/title and carry no
  duo/trio/group/line wording. It is deliberately NOT inferred from "one linked dancer", because
  1,874 group-worded awards have exactly one link (a partly-entered cast) and promoting those
  would turn real groups into solos.
- The awards editor is also **defensive**: for a solo with exactly one linked dancer and no
  stored primary, it displays that dancer as Primary marked "(linked)", so the page is right for
  any row the weekly sweep hasn't reached yet without pretending the column is populated.

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
- Public directory at `/dance/events`: all orgs' future events, filterable by state / month / competition, grouped by month, with Register (or Official Site) links. Within a month, rows sort by **start date, then end date, then org** — the end-date tie-break was added 2026-08-30 because sorting ties by org name alone was deterministic but *looked* random on screen: a run of same-start-date events rendered "07/05 – 07/10", "07/05 – 07/11", "07/05 – 07/09", since the tie-break is not what the eye tracks in a column of date ranges. Org names are deliberately plain text, not links — same low-profile rule as homepage org cards. Unlisted/hidden orgs are excluded.
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

## Owner award emphasis: private weighting, public figure fixed (2026-08-30)
`studio_award_weights` (studio_id, award_term, weight 0-3) + utils/awardWeights.js.
In the Major Awards popup, owners weight their own award types: Not notable /
Normal / Notable / Headline. Boundaries, deliberately: weights NEVER affect the
public Major Awards figure (utils/majorAward.js stays the platform rule) — so no
studio can inflate a public claim; they drive a private "Your Highlights 🔒"
count on Organization History; and they steer the AI summary (emphasise/downplay
lists injected into the prompt, with a hint next to the Generate button telling
owners their emphasis drives it). Because inflating buys nothing public while
accuracy improves the generated summary, the pooled weights are a credible
signal: GET /admin/award-emphasis (superadmin) aggregates them per award term
(studios, avg weight, headline/not-notable counts) to inform canonical
classification (docs/org_top_awards.md, award vocab). Owner endpoints:
GET/POST /manage/studio/:id/history/weights. Activity: award_weights_updated.
IP: maybe_patentable.md §A11.

## Independent dancers: synthetic studios (2026-08-31)
Some competitions publish an unaffiliated entrant on a shared regional roster —
YAGP's `Independent, CA`, `Independent, Poland` and 91 siblings, carrying 459
dancers between them. That is a latent conflation of real children, because
`scripts/auto_merge_dancer_profiles.js` groups candidates by
`(studio_id, cleaned name)` and four same-name pairs already sat on those
rosters. They survived only because the script's third condition — a shared
canonical routine in the same year — was unmet, and family award entry is
precisely what supplies routines.

So an independent dancer now gets a **synthetic one-dancer studio** of their
own (`studios.is_independent = 1`, name
`Independent — <dancer name> (<DNC-unique_id>)`). This makes "independent" a
data case rather than a code case: `resolveDancer`, both solo-repair scripts,
and the planned convergence key all keep working on a studio key with no
parallel branch. It is the same pseudo-studio pattern the platform already uses
for cross-studio collaborations.

Two conditions hold it up, and both are enforced in code:
- **Globally unique names.** The dancer's `unique_id` is in the stored name, and
  `scripts/merge_studio_aliases.js` skips independents outright — otherwise two
  independents named "Emma Smith" would be fused on the case tier and the
  shared roster would return one step later. Visitors never see the machine
  name: card and profile queries render `Independent` via
  `studioDisplayNameSql()`.
- **Invisible to studio surfaces.** Excluded from the studio directory, public
  search, the featured rotation, homepage leaderboards, the platform studio
  count, and owner merge suggestions. `/dance/studio/<uid>` for a synthetic
  studio redirects to the dancer; a *residual* roster (several dancers, e.g. a
  same-name pair awaiting a human) 404s rather than asserting an identity.

Detection is a **reviewed per-organization marker list**
(`utils/independents.js`), never a regex on `independ`: `IndepenDANCE Studio`
and `Independent Dance Collective` are real studios, and a substring match
would dissolve their identity. A rule fires only on studios whose awards
actually come from that organization.

Migration: `node scripts/migrate_independent_studios.js [--apply]` (idempotent,
dry-run by default, writes `reports/independent_migration.json`). Awards with no
resolved dancer, and genuine cross-independent collaborations, stay on the
roster — a published result is a real fact even when the person cannot be
identified. Same-name pairs are never split automatically: each is either one
person entered twice or two different children, and only a person can tell.

## Family award submissions, staged (2026-08-31)
Competitions do not publish everything. A family that owns a dancer profile can
now add a missing award themselves at
`/manage/dancer/:id/submissions` — the first milestone of the mobile-app plan
(`docs/mobile_app_development_plan.md` M1), shipped web-first so the riskiest
part (data integrity of family-entered awards) is proven on a surface we already
know how to ship. Behind the `family_submissions` feature flag, dark by default.

Nothing canonical is written. Submissions land in **their own SQLite file**
(`submissions.sqlite`, `SUBMISSIONS_DB_PATH` override) so a submission spike at
a competition never contends with the database that renders every public page.
They are private to the household and appear on no public surface until a
reviewer promotes them (M3).

The rules that protect the archive live in `utils/submissions.js`, so the web
form and the future mobile API cannot drift apart:
- **Studio is derived from affiliation, never typed** — the single largest
  duplicate vector, removed at the source. A multi-studio dancer is *asked*
  which studio the routine was danced for; a dancer with no affiliation submits
  with no studio.
- **Group size is required** and drives the canonical write path later: solo
  double-writes `awards.dancer_id` + the junction, groups use the junction only.
  Only solo/duet/trio may claim a complete cast; a group, line or production is
  recorded as explicitly partial no matter what the client sends, so a parent
  who enters one child never produces a record indistinguishable from a solo.
- **Server-side normalisation.** Whitespace collapse and typographic folds are
  re-applied on receipt; the client's version is a courtesy to reviewers, not a
  guarantee. The raw payload is retained for the reviewer.
- **Idempotent on `(user_id, client_submission_id)`** — a double-click, a
  refresh-resend, or (later) a retried offline upload returns the original row.
- **Per-household daily limits** (40 submissions, 10 dancer links) recorded in
  an append-only ledger, so a refusal is auditable. The dancer-link limit also
  applies to authenticated profile claims.
- **Teacher and choreographer** are captured as award metadata — data organizers
  almost never publish. (The credit *graph* with two-sided accept remains behind
  its IP gate; see TODOS_and_DONE.md.)

Event choice is against **canonical events only** — families cannot create an
event here. `event_candidates` and the geo/date picker arrive in M2.

`award_provenance` (canonical DB) records how each award came to exist and who
vouched for it; it is written at promotion time in the same transaction as the
award. `scripts/check_submission_orphans.js` reports cross-database dangling
references (the weekly Sunday integrity cron runs it) and never deletes: a
family's submission is their record of their own child's award.

## Event candidates and the picker (2026-08-31)
The second milestone of the mobile-app plan (`docs/mobile_app_development_plan.md`
M2), still web-first. Event identity is the hardest free-text problem in this
domain, so the picker asks the cheapest question first and only falls back to
typing when it must.

**Three sources, one list** (`utils/eventPicker.js`):
- **Organizer tour stops** (`org_upcoming_events`) — ~1,080 of them geocoded with
  real ISO dates, which is what makes *"Are you at Starpower — San Jose today?"*
  a one-tap answer. Browsing writes nothing; picking one seeds its candidate
  lazily at submit time.
- **Other families' candidates**, labelled "Added by a family" so they read as
  provisional.
- **Canonical historical events**, by name only. They carry no geography and
  their `date_string` is free text ("March 22 - 24, 2024", and in one case a
  venue name), so they cannot answer a geo/date question — which is exactly why
  the geocoded upcoming table carries the one-tap path.

**Families may create an event, but only ever as a candidate.** No canonical
`events` row is ever written by a family action — that invariant has its own
smoke check. A candidate is selectable by other families at the same event
immediately, because the alternative is every household at a new competition
creating its own copy.

**Dedup at creation, on the server.** Before a create is accepted, anything that
looks like the same event is offered back: *"Someone here added 'Starquest
Spring Classic' 20 minutes ago — is that yours?"* Only an explicit "mine is
different" creates a second row, and the two are then filed under one
`dedup_cluster_id` so a reviewer decides once instead of twice. Matching is
date + geography + name (token overlap with containment, stopwords stripped —
"dance", "competition", "nationals" identify nothing).

**Lifecycle decisions**, closed here and env-overridable so they can be tuned
against real traffic without a deploy:

| Decision | Value | Why |
|---|---|---|
| Visibility scope | 75 miles, ±14 days | Wide enough for a family entering from home that evening; narrow enough that provisional data stays local noise |
| Dedup match | 40 miles, ±3 days, name ≥ 0.5 | Tighter, because this decides "same event", not "might interest you" |
| Promotion authority | AwardHome reviewers only | A studio owner promoting would let one studio mint canonical events platform-wide |
| Auto-merge | Unambiguous match only, score ≥ 0.75 | Two plausible events is a tour with two nearby stops; guessing would file an award on the wrong weekend |

**Two promotion paths.** A reviewer works `/admin/event-candidates` (superadmin;
grouped by dedup cluster, with canonical-event suggestions ranked by name
similarity plus a city bonus, since canonical event names usually carry the
city). Or the organizer's own results import lands and
`scripts/merge_event_candidates.js` merges the candidate into it with no human
step — the organizer's published data outranks a family's guess by definition.
That script runs automatically at the end of every successful weekly import.

Both paths re-point the family's submissions at the canonical event and keep
`event_candidate_id` as provenance. Promotion spans two SQLite files and so
cannot be one transaction; it is therefore idempotent by construction — an
already-promoted candidate returns its event, and an existing event with the
same (org, name, year) is reused — so a crash between the halves costs a retry,
never a duplicate event. Rejecting a candidate never deletes the family's
submissions: the award still happened, it just needs a new home.

## Studio reviewer inbox + delegated photo approval (2026-08-31)
Milestone M3 of the mobile-app plan — **the reviewer-economics milestone**.
AwardHome staff review does not scale. Studio owners already know their
dancers, their routines and their results, already have a dashboard, and are
already motivated: the studio's page is the showcase. This is the difference
between review scaling with our headcount and review scaling with the network.

### Family submissions → canonical awards
`/manage/studio/:id/submissions` (studio owner, behind `family_submissions`)
lists that studio's pending submissions with **confirm / correct / ask /
reject**. Corrections are made in place — a director fixes a placement rather
than bouncing a real award back over a typo — and only fields the reviewer
actually changed are applied, so the family's words otherwise stand. The
family's original stays in `raw_payload`.

`utils/promotion.js` is the only door from staging to canonical, and holds five
rules, each a scar from real data:

1. **The write path follows the declared group size.** Solo double-writes
   `awards.dancer_id` *and* the junction; a group writes the junction only.
   The family told us the format, which is a stronger positive identification
   than `utils/soloPrimary.js` can infer from a label. An absent or unknown
   size is treated as a group — mistaking a group for a solo is the damaging
   error; the reverse is not.
2. **Find before create.** An award matching (event, studio, routine key,
   place, category, award type) is reused and the dancer linked to it. That is
   both the mandated ETL idempotency and what makes promotion safe to retry
   across two SQLite files that cannot share a transaction — and it is how a
   second household's submission for the same routine will converge onto one
   award in M4.
3. **Tombstones are never resurrected.** If a director removed this dancer
   from this routine, confirming is refused and says so. Re-adding is a
   deliberate act in Group Routine Dancers, not a side effect of clicking
   confirm.
4. **No canonical award without a canonical event.** A submission whose event
   is still a family-created candidate cannot promote; the reviewer is sent to
   `/admin/event-candidates` to settle the event first.
5. **Typed cast names never become people.** A family naming teammates is
   evidence for a reviewer, never authority to create dancer profiles.

Confirming writes `award_provenance` in the same transaction as the award —
who contributed the fact, who confirmed it, and at what verification level
(`studio_confirmed`). Scope is enforced twice: `requireStudioOwner` proves the
caller owns the studio, then each handler proves the submission belongs to it,
answering with 404 rather than 403 so probing ids reveals nothing.

### Card photo approval, delegated to the people who were there
Every award card photo used to need a superadmin before going public — review
scaling with headcount again, and worse for photos, since a family uploads one
per routine per season. The ladder now runs (`utils/cardPhotos.js`):

1. **Upload → team-visible.** A pending photo is visible to the families of the
   dancers *on that award*, and nobody else. This rung does real work: a group
   photo shows other people's children, and cross-studio collaborations mean
   the studio owner alone cannot speak for everyone pictured. Families see them
   on `/manage/dancer/:id/card`.
2. **Objection → stop.** One objection from a cast family blocks studio
   approval and sends the photo to AwardHome. Not a vote count: the pool is a
   handful of families, and a single *"that's my child and no"* deserves to
   win. Objections reuse `content_flags`, so an objection and a public report
   are one record with one audit trail. Only a household owning a claimed
   dancer in that routine may object — and owning a claimed dancer means
   passing a human review, which is what makes a threshold of one safe here.
3. **No objection → the studio publishes**, from Pending Verifications. Consent
   is passive by design: a unanimity rule would never fire, because most
   dancers on a big group have no claimed profile, so "everyone approved" would
   in practice mean "the one family that claimed approved their own photo".
4. **Public → community flagging, unchanged.** `routes/flags.js` darkens
   approved content on the first report and routes it back to the superadmin
   queue; a human reinstate blocks repeat auto-darkening, so an attacker gets
   exactly one dark per photo, ever.

Superadmin becomes exception handling — objections and public reports, not
volume. The dancer-level default photo (`dancers.card_photo_*`) still goes
through the superadmin queue: it is not scoped to a routine, so there is no
cast to consult.

## Convergence, corroboration, and the AwardHome queue (2026-09-01)
Milestone M4 of the mobile-app plan. M1–M3 made family entry possible and
reviewable; M4 is what keeps it from quietly re-creating the duplicate problem
the 2026-08-30/31 repair removed.

### Convergence — two households, one award
Two parents at the same competition both submit *Small Group — Fireworks —
1st*. Neither can see the other's entry, and neither types it identically.
`utils/convergence.js` folds them onto one award with two dancer links:

- **Normalise, don't guess.** "1st" / "1" / "First" / "1st Place" fold to one
  key; text fields fold on case, punctuation and whitespace. Nothing semantic
  is inferred — "Teen Contemporary" and "Contemporary Teen" stay different,
  because deciding they are the same is a judgement no normaliser should make
  silently.
- **Absence is not disagreement.** A field one household left blank matches a
  field the other filled in, and promotion then *enriches* the award with it.
  A field both filled with different values is a real difference and keeps the
  awards apart — which is how a routine's "1st in Teen Contemporary" and its
  "Overall High Score" stay the two distinct awards they are.

Enrichment never overwrites: published organizer data and earlier reviewer
decisions outrank a later family description.

### Corroboration — the cheapest trust signal available
Two **unrelated** households describing the same result promote each other, at
verification level `corroborated`, with no reviewer involved. Unrelated means a
different account *and* a different dancer: a family agreeing with itself is
not independent evidence, and two accounts submitting for the *same* dancer is
a contested-ownership signal, not corroboration.

### Independents auto-approve, honestly labelled
An independent dancer has no studio owner to review them — that is what
independent means here — so their submissions publish immediately at
`family_submitted` (design §6.2.3). Latency and trust are separated: the award
is public straight away, but `rankableAwardSql()` holds `family_submitted`
awards out of every leaderboard and top-studio/top-dancer ranking until
something corroborates them. Appearing in your own trophy case is a different
claim from being ranked against reviewed data. Anomalies still queue — a dancer
whose ownership is contested never gets published by the dispute itself.

### The AwardHome queue — `/admin/submissions`
What studios cannot decide, and — the operationally important one —
**everything no studio owner will ever see**. A submission for a dancer at an
*unclaimed* studio has nobody to review it and would otherwise sit pending
forever in an inbox that does not exist. Most studios are unclaimed, so that is
the common case, not the edge. Each row says why it is here; anything with a
real studio owner stays in their inbox and never appears.

### Contested claims never reach a studio
A second household claiming one dancer marks **both** claims `contested`
(design §6.9). Contested claims leave the studio queue by construction — the
studio routes filter on `pending` — and are decided only at `/admin/claims`,
grouped by dancer so both sides of one argument are read together. A director
asked to choose between two families is being asked to arbitrate a private
dispute.

### Correction proposals — `award_corrections`
A family never edits a published fact. "Something's wrong?" files a
**field-level proposal** with the current value, the proposed value and a
reason; a reviewer accepts or rejects at `/admin/corrections`. Accepting applies
the field and writes provenance in one transaction, and re-derives
`performance_name_key` when the routine name changes so convergence keeps
finding the award. A proposal whose current value has moved since it was filed
is refused with a warning: accepting would overwrite something the family never
saw. Only a household whose own dancer is on the award may propose.

### Archive-integrity guardrails — `scripts/archive_metrics.js`
The design's §14 numbers, queryable, and printed at the end of every successful
weekly import. These catch **silent decay** — the failure mode where nothing
errors while the archive degrades:

| Metric | Baseline (2026-09-01) | Direction |
|---|---|---|
| New studios per 100 accepted submissions | 0 | must stay ~0 — studios are derived, never typed |
| Event candidates merged into events that existed | — | measures picker quality |
| Duplicate canonical awards | 6,408 (legacy import residue) | must not rise |
| Group awards with one linked dancer | 1,874 | must fall, never rise |
| Convergence rate | — | share of family awards with more than one household |

Both duplicate-style metrics were calibrated against the real corpus rather
than assumed: keying duplicates on (event, studio, routine, place) alone
reported 97,556, because one routine legitimately wins several awards at one
event, and blank-routine per-dancer placement rows share every field by
construction. A guardrail that cries wolf gets ignored.

## Mobile API — `/api/v1/mobile` (2026-09-01)
Milestone M5. The versioned JSON API the Expo client (M6/M7) will consume, and
the last milestone before any mobile code exists.

### Mount position is part of the contract
`server.js` mounts this router after `express.json()` and **before** the
session store, the CSRF middleware and the private-beta gate. Each is
deliberate:

- **Before session** — a bearer-authenticated request has no reason to create a
  session row, and a native client never returns the cookie anyway. The API
  test asserts no `Set-Cookie` is issued on any API call, which turns this from
  a claim into a property.
- **Before CSRF** — CSRF defends against a browser attaching an *ambient*
  credential to a cross-site request. A bearer token is not ambient: nothing
  attaches it automatically, so there is nothing to forge. The check does not
  apply rather than being skipped.
- **Outside the beta gate** — the app ships to invited families through
  TestFlight and internal builds, which is its own gate.

This is the only place in the app where router order carries a security
argument; `scripts/audit_get_routes.js` now mints a real bearer session and
sweeps the API surface with it.

### Auth: opaque tokens, only hashes stored
Emailed one-time codes, then a short-lived access token (15 min) and a
long-lived refresh token (60 days). Only SHA-256 hashes are stored — a database
leak must not hand anyone a working token, the same rule
`users.reset_token_hash` already follows. SHA-256 rather than bcrypt because
these are 32 random bytes: a work factor buys nothing against a value nobody
can dictionary-attack, and would cost latency on every call.

**Refresh tokens rotate on every use**, which gives a cheap theft signal: a
refresh token is valid exactly once, so presenting a rotated one means either a
replay or a stolen token. We cannot tell which, so we assume the worse and
revoke the whole session. Revocation takes effect on the very next request —
there is no token cache to wait out.

`/auth/request-code` always answers identically whether or not the address has
an account. Whether a family exists here is not something an unauthenticated
caller gets to learn.

### Guests are first-class
Read endpoints mirroring a public web page work with no token: a parent can
search for their dancer and read the trophy case before deciding whether to
make an account. `/dancers/:id/awards` honours the owner's per-card hide, pages
on a `cursor` (award ids only increase, so paging is stable under concurrent
writes) and syncs on `updated_since`.

The sync marker is **derived** from the two timestamps that exist — when the
dancer's link was made and when the fact last changed — because `awards` has no
`updated_at` and putting a trigger on a 900k-row table's UPDATE path would tax
every import to serve a sync protocol. Stated consequence: an importer editing
an award without writing provenance will not move its marker.

### Writes reuse the M1–M4 services
Claim, submit, correct and create-event all call the same domain services the
web surfaces do, so the two clients cannot drift: studio still derived from
affiliation, group size still required, submissions still idempotent on
`(user, client_submission_id)`, dedup still offered before an event is created,
independents and corroboration still auto-promoting with honest labels.

### Evidence: private by default, stored outside the served tree
`utils/evidence.js`. A two-step grant (ask, then send bytes) so the storage
driver can change without the client changing. **The storage decision is still
open** (design §16.4: S3 vs R2, and the retention period) — both cost money and
need an account, so the code ships the driver *interface* plus a local
implementation correct at beta scale. Swapping in S3/R2 means implementing
`put`/`get`/`remove`; `object_key` already holds an opaque key rather than a
path, so stored rows survive the swap.

What is done, and what deliberately is not:

| | |
|---|---|
| ✔ | magic-byte sniffing — the declared Content-Type is a claim, not evidence |
| ✔ | hard size ceiling on the bytes actually received |
| ✔ | EXIF/GPS stripping (JPEG) and text-chunk stripping (PNG), no dependency — a competition photo carries the venue's coordinates and often the child's name |
| ✔ | random opaque keys; files written 0600 outside `public/`, never enumerable |
| ✔ | served only to the uploader and reviewers, always as an attachment |
| ✘ | malware scanning — needs ClamAV or a service; `scan_status` and `scanFile()` are the hook, files stay `pending`, and `canServe` treats pending as uploader-and-reviewer-only |
| ✘ | re-encoding — needs an image library; metadata stripping covers the privacy case, not the malformed-decoder case |
| ✘ | PDFs — plausible evidence, but PDF sanitisation is its own project |

### The contract ships with the code
`/api/v1/mobile/openapi.json` is served from `docs/openapi_mobile.json`, so the
spec cannot drift into a wiki. `test/api_mobile.js` runs against its **own
throwaway copy** of the database (the API mints awards, claims and evidence; a
contract test that leaves debris is one people learn to skip) and is a gate
stage of its own: `npm run test:api`, and stage 2 of `npm run gate`.

## Mobile app: read, recover, claim (2026-09-01)
Milestone M6 — the first mobile code, in `mobile/`. Expo SDK 54, React Native
0.81, TypeScript **strict** plus `noUncheckedIndexedAccess`, Expo Router with
typed routes. Guest search, trophy-case viewing, email-code sign-in, household
dashboard and profile claiming. **No submission capability** — that is M7, and
the screens deliberately offer no disabled button pretending otherwise.

### The contract cannot drift
`src/api/schema.ts` is **generated** (`npm run api:types`) from the same
OpenAPI document the server serves at `/api/v1/mobile/openapi.json`. Nothing in
the client restates a response shape by hand, so a server change that breaks
the app shows up as a type error rather than a runtime surprise. This closes
the M5 deferral: the generator now has a consumer to generate for.

### The token lifecycle is where the risk is
`src/api/tokens.ts` takes `fetch` and its storage adapter as parameters, with
no React Native imports, so the riskiest logic runs in plain Node
(`npm run mobile:test`) rather than only in a simulator nobody runs in CI.

The property it exists to guarantee: **refresh is single-flight**. The server
rotates refresh tokens and treats a replayed one as theft by revoking the
session — correct server behaviour, and exactly what lets a naive client sign
its own user out:

> five screens mount at once → five requests 401 on an expired access token →
> five parallel refreshes with the *same* refresh token → the first rotates it,
> the other four look like theft → session revoked, family signed out for no
> reason.

Concurrent callers await one in-flight refresh. Seven tests cover that, the
single retry on 401, rotation being followed, a dead session clearing storage
and reporting *why*, and guests reading public endpoints without ever
attempting a refresh.

Refresh tokens live in `expo-secure-store` (Keychain / Keystore). The access
token is **memory only** — it lives fifteen minutes, and persisting it would
widen the blast radius of a device compromise for no benefit. A test asserts it
never reaches storage.

### Universal links
The app claims `awardhome.com/dancer/*` and nothing else — claiming the domain
would swallow `/dance`, `/admin` and the marketing pages into an app with no
screens for them. The route file `app/dancer/[id].tsx` mirrors the web URL, so
Expo Router resolves an incoming link with no extra mapping.

`routes/wellknown.js` serves the association files from environment variables
(`IOS_APP_ID`, `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256`) and **404s until they
are set**. A placeholder would be worse than nothing: the platforms cache
association files, so a wrong one breaks deep linking for as long as the cache
lives and looks like an app bug the whole time.

### What is not verified
Nothing in this repository renders the app — there is no simulator or device in
the environment it was written in. Layout, gestures, keyboard behaviour,
on-device deep linking and every native module (`expo-secure-store` above all)
are **unrun**. Types and the token lifecycle are checked on every run; the first
device launch is the real first test. `mobile/README.md` says so plainly.

The mobile checks are deliberately **not** in `npm run gate`: that is the
server deploy gate, and the production host has no `mobile/node_modules`.
`npm run mobile:check` runs them.

**SDK pin (2026-09-01):** the app targets Expo SDK **54**, not npm's `latest`
(57). App Store Expo Go is capped by the phone's iOS version, so "the latest
Expo Go I can install" can be several SDKs behind npm — and it genuinely is the
newest available *to that device*, so no amount of re-downloading fixes it. The
only reliable input is the number Expo Go reports as its supported SDK; pin the
project to that. Since SDK 54 the Expo Go client version tracks the SDK it
supports, which makes the number easy to read off.

Getting this wrong costs a full dependency realignment each time, so it is
worth asking before choosing: this project went 57 → 56 → 54 before landing.
`expo-doctor` is 18/18 on 54. Web support (`npm run web`) was added along the
way as an escape hatch that never has this problem.

## Mobile app: submission, offline, media (2026-09-01)
Milestone M7 — the app writes. Offline drafts, the Add flow, evidence capture,
card content, push, and sharing.

### The offline outbox is the milestone
"A parent adds a weekend of results offline at a venue; all submissions arrive
exactly once." Exactly-once over an unreliable network is not achievable by
trying to send once — so the client doesn't try:

> `client_submission_id` is minted when the draft is **created**, written to
> disk before the first attempt, and never regenerated. The server is idempotent
> on `(user, client_submission_id)`. The client's promise is therefore not
> "send exactly once" but "always send the same id for the same draft" — a
> promise it can actually keep across a crash mid-request, a timeout that
> secretly succeeded, and a process death between send and acknowledgement.

A draft may be sent many times; that is expected and harmless. Nine Node tests
cover it, including the nastiest case — the server succeeded and the reply was
lost, so the client retries believing it failed and still produces **one**
award.

Storage is `expo-sqlite`, not AsyncStorage: these rows are a family's only
record of their child's awards before anything reaches the server, and a JSON
blob rewritten in full on every change loses everything on a partial write.

A draft that exhausts automatic retries is **parked, never discarded** — it
stays visible with a manual retry, because silently dropping someone's record
is worse than a stuck queue. One bad draft never blocks the rest of a weekend.

### Event sessions: server-issued, get-or-create
A weekend batches under one session id so a reviewer can approve it in one pass
and convergence can see across households. The id comes from the **server**
(`POST /event-sessions`), because a local one cannot survive two devices or a
reinstall mid-weekend — each would invent its own "weekend" for one event.
Asking twice rejoins the same session rather than starting a second.

A session id belonging to another household is **dropped, not rejected**: the
award is still a real record, and failing the whole submission over stale
batching context would lose it for no benefit.

**Picking the event needs signal, once per weekend** — an event has to be
resolved against the archive or it becomes a duplicate. Everything after that is
fully offline. That split is the whole reason the flow works at a venue.

### Card content captured at the moment of motivation
The photo and thank-you note ride on the *submission*, not the award — there is
no award yet, and there may never be one if a reviewer rejects it. Promotion
copies them across at status `pending`, into exactly the same moderation path as
content added from the web. Submitting publishes nothing, and a test asserts the
canonical card tables stay empty until promotion.

### Push: decisions and questions only
`utils/push.js` sends on confirm, reject and ask — nothing else. No digests, no
re-engagement. The module has no scheduling or campaign concept on purpose: a
future engagement ping should have to build that machinery and argue for it
rather than find it lying around. Sends are best-effort; a failed notification
never rolls back the decision it was announcing. A `DeviceNotRegistered`
receipt disables the device.

### Sharing: the link, not a rendered image
The native share sheet shares the public trophy-case URL, and the web page now
carries OpenGraph tags so it unfurls properly in a message. `og:image` uses the
dancer's **approved** card photo — approved being the operative word, since an
unfurled preview is about as public as an image gets.

Server-generated share *images* are deliberately not built: they need a
headless browser on the production box, which is an infrastructure decision
rather than a detail. The link works today, keeps working for someone without
the app, and costs nothing. **Evidence is never share media.**

## Onboarding from the app: sign-up on claim, and studio claiming (2026-09-01)
A gap found by testing the app as a stranger would use it. The claim flow
required an account the parent did not have — she heard about AwardHome from a
friend, found her child, tapped claim, and was sent to a sign-in screen that
only worked for existing users. The web has had one-page apply since launch
(`/claim/dancer/:id/apply` creates the account and files the claim together);
the mobile API had simply never exposed the equivalent.

### The code is the signup
`POST /auth/verify` now **creates the account** when the address has none.
There is no signup form, no password, and no verification link to chase: the
six-digit code already proves she controls the address, which is exactly what
the web's password-plus-link flow is establishing more slowly. `isNewAccount`
tells the client which happened.

No password is set — a random unusable hash goes in the column, and the web's
"forgot password" flow is how she gets one if she ever wants to sign in there.

### Studio claiming, from a phone
**21,693 of 21,695 real studios are unclaimed.** That is not a cold-start
curiosity: an unclaimed studio is one where *nobody reviews that studio's
families' submissions*, so every one falls to AwardHome. The person who can fix
it is a director who just heard about this from one of their own parents,
standing in a lobby with a phone — and sending them to a desktop is where that
ends.

So the app now has `/studios/search`, a studio page, and a claim flow mirroring
the web's, **including the domain fast-track**: a claimant whose email is on
the studio's own website domain is approved on the spot. That is as safe here
as on the web for the same reason — it only fires on a verified address, and a
mobile address is verified by the code that signed them in.

### The claim response names the gap
`POST /dancers/:id/claim` now returns `unclaimedStudio` when the dancer's
studio has no owner. The app turns that into an invitation at the one moment
the family cares most:

> *Your studio hasn't claimed its page, so AwardHome reviews your claim instead
> of your own director — who would recognise you instantly. If you mention it
> to them, they can claim it from their phone in a minute.*

Every family whose studio is unclaimed becomes a channel to that studio, and
the pitch is true rather than promotional: their own claim genuinely resolves
faster once their director is there.

## Dancer claims route by competence, not by paperwork (2026-09-01)
A correction to the claim routing, prompted by a question worth asking out
loud: *what can an AwardHome admin actually check about a dancer claim?*

Nothing. The question a claim asks is "is this person really this child's
parent", and an AwardHome reviewer has no relationship to the family and
nothing to check against. Sending them that decision does not produce review —
it produces rubber-stamping, on a child-safety surface, wearing the appearance
of oversight. Three such claims were sitting in the queue for dancers whose
studio *had* an owner who could have decided them instantly.

The studio director can answer it. So routing now follows who is competent:

| Case | Decided by |
|---|---|
| Contested (two households) | **AwardHome** — a director must never be asked to choose between two families (§6.9) |
| Independent dancer | **AwardHome** — there is no director, by definition (§6.2.3) |
| Studio has an owner | **That studio**, whether or not a claim code was supplied |
| Studio unclaimed | Waits. The family is told why, and offered the invite path |

This demotes the studio claim code from a routing gate to what it always
really was: a shortcut proving community membership that lets a family skip a
queue. Its *absence* never made AwardHome more able to judge. The director's
queue still shows whether a code was used, because that tells them how much the
claimant already proved — it just no longer decides who reviews.

### Asking twice
Claiming a dancer you have already claimed now returns the pending state
instead of the form. Previously the app offered "This is my dancer" again, and
tapping it filed a second claim — which the contested-claim machinery then read
as two households in dispute over the child, and escalated to AwardHome. A
family could put their own claim into dispute with itself.

The trophy case returns `myClaim` for a signed-in caller, so the app shows
where the claim stands and what happens next rather than a button that makes
things worse.

### The studio page has to be recognisable, not just accurate
A name and three counts cannot answer the question the page exists to ask.
"Is this your studio?" under *Dance Unlimited · 5,672 awards · 802 dancers* is
not a decidable question — there are a great many studios with that name, which
is exactly why the claim form below it asks for an address.

`/studios/:id` now returns a recognition preview:

- **`recentEvents`**, newest season first. The strongest signal available, for
  a reason worth recording: event names carry the city ("Rainbow - Pueblo, CO",
  "JUMP 2026 ORLANDO, FL"), so they identify a studio better than the `address`
  column does — that is on file for 1,340 of 25,081 studios, while every studio
  with awards has events.
- **`recentAwards`**, named routines first. A convention scholarship with no
  routine name is a real award that identifies nothing; "Sunny's Delight" is
  instantly recognisable to whoever choreographed it.

**No dancer names, deliberately.** Roster lists are not public — a dancer
appears only on awards they have claimed — and a page whose entire job is "do
you recognise this studio?" is the last place that should start listing
children. Routines and placements do the recognising perfectly well. A contract
test fails if a dancer name ever appears in the preview.

**"Already claimed" was a dead end.** The page said the studio was managed by
its director and stopped — the least useful thing to tell the director reading
it, who may simply be signed out. Three cases now: `studio.is_mine` (yours, say
so), claimed-and-signed-out (offer sign-in, returning to this page), and
claimed-as-someone-else (explain, point at us). `is_mine` is reported only to
the person it is about; a guest learns nothing beyond the `is_claimed` flag the
page already showed.

### The claim action is pinned, and "already claimed" names a person
Two things a director could not act on.

**The action was below the fold.** With a recognition preview above it, a
studio with a real history pushed "Is this your studio?" past two lists — the
one thing the page exists to offer, discoverable only by scrolling. The claim
block is now a **sticky child** (`stickyHeaderIndices`), visible before any
scrolling and still reachable while reading the evidence that answers the
question. It is deliberately compact: a pinned bar that takes a third of the
screen is worse than one you have to scroll to. Stickiness switches off once
the form opens, or the pinned block would cover the fields it just revealed.

**"Someone at the studio manages it" was a dead end.** The immediate question
is *who*, and the page had no answer — no name to ask for, no next step.

Answering it needed new structure, not a new query. `users` has no name column,
and a studio claim's contact name lived only inside free-text `proof_text`.
That text is **verification evidence**, given so a reviewer could check it;
publishing it afterwards would repurpose data collected for one purpose into
another. So `studio_claims.contact_name` / `contact_role` / `show_publicly` are
captured structurally, behind a checkbox whose label says families will see it,
and `approveStudioClaim` promotes them to `studios.manager_name` /
`manager_role` / `manager_public` on approval. Consent is asked at collection;
a claimant who was never asked defaults to 0 and is never retroactively
published. The page then says *"Dana Reyes manages this studio · Director"*, or
says plainly that the manager has not chosen to be named — never a vaguer
version of the same dead end.

### A face on a studio claim
A claimant may attach a photo of themselves. It is **private** — it goes to
reviewers at `/admin/claims`, not onto the studio page — and it earns its place
for two separate reasons:

- **It is checkable.** A studio's own "meet the staff" page is public, so a
  reviewer can hold a face against it. A typed name cannot be checked against
  anything; this is the first piece of claim evidence that can.
- **It deters.** Being asked for your own face raises the cost of a
  speculative claim in a way another text field does not.

It rides the exact treatment award evidence gets — the bytes are believed
rather than the `Content-Type` header, camera metadata is stripped, the file
lands 0600 outside the served tree — because those primitives are now exported
from `utils/evidence.js` rather than copied into a second, weaker version.

Attachable only to the caller's **own pending claim**; anything else is 404, so
a studio id alone cannot be used to put a face on someone else's claim. The
claim never fails because the photo did: a photo is supporting evidence, not
the claim.

**Public display is deliberately not built.** `studios.manager_photo_public`
exists and stays 0. Putting a real person's face on a public page is a larger
step than naming them, and it wants the moderation this codebase already
applies to photographs elsewhere — not an implicit yes carried along by a claim
form.

### The beta gate is a production concern
`BETA_MODE=true` now only gates when `NODE_ENV=production`, or when a
developer explicitly asks with `BETA_MODE_DEV=true` to test the gate itself.

A `.env` carried over from a production-shaped config used to gate localhost
too, which does more harm than the obvious annoyance: it makes the local server
behave unlike the developer's mental model, so when a mobile client
accidentally pointed at production and met the real gate, the symptom was
indistinguishable from a local misconfiguration. Two different causes, one
identical screen.

What the gate actually covers, measured rather than assumed:

| Surface | Gated |
| --- | --- |
| `/dancer/*`, `/dance/*` — public data pages | **yes** |
| `/login`, `/register` — accounts | no |
| `/dance/card/*` — the app's card | no (mounted before it) |
| `/api/v1/mobile/*` | no (mounted before it) |

Worth stating plainly because it is the opposite of the intuitive reading: the
gate protects **public award data**, not account creation. Signing up has never
been gated. The gate exists so an unpartnered organization's results are not
broadly browsable before launch, which is the same instinct behind
non-enumerable studio URLs and homepage org cards that do not link.

### The app shows the REAL award card, not a copy of it
Tapping an award in the app opens the actual card — the same
`views/partials/dancer_award_card.ejs` the web renders — served standalone at
`/dance/card/:dancerUniqueId/:awardId` and shown in a web view.

That is a deliberate refusal to reimplement it natively. The card is the
product, not a layout: a container-query design measured in `cqw` so it scales
like an image, per-org branding arriving from `organizations.custom_icons` as
CSS custom properties, a flipbook back stack, and the subject of the
provisional filing. A hand-built React Native copy would drift from all of that
inside one release — and every future card change would then need an App Store
review to reach anybody. One card, and the app picks up card work the moment
the server ships it.

**Scoped to a (dancer, award) pair**, because the per-card hide lives in
`dancer_card_hidden` and is per-pair, and a solo card names the dancer on its
face. An award the dancer has no link to answers **404, never 403** — probing
ids reveals nothing the trophy case would not already show.

**Mount position is load-bearing**, and it is the second place in the app where
that is true: `routes/cardEmbed.js` is mounted after the session store (so an
`early_access` family sees the same flipbook pages here as on the web) but
*before* the beta gate — for the same reason `/api/v1/mobile` sits outside it.
The app ships through TestFlight and internal builds, which is its own gate; a
card that met the beta password page inside a native sheet would simply look
broken. It did, the first time.

**`.embed-stage .flip-card` had to be registered as a container** in
`styles.css`. That file states the rule plainly — any surface rendering a
flip-card must be listed, or `cqw` silently resolves against the viewport — and
skipping it produced exactly the documented symptom: a card with text several
times too large for it. There is now a smoke check asserting the registration,
because the failure is silent in CSS and only visible in a screenshot.

`react-native-webview` is required lazily, like `expo-network` and
`expo-clipboard`: a binary built before the dependency existed falls back to an
honest summary plus a link that opens the same card in the browser, rather than
taking the route down.

### My Dancers: confirmed first, pending visible, refreshed on focus
Three faults, one screen. Once `/me` started returning pending claims (M8), a
dancer she had merely *asked* for rendered identically to one she manages —
same card, same award count, no badge — so the app silently promised something
it had not delivered. They were also interleaved alphabetically with confirmed
dancers, and the empty state's copy pointed at "the list below" from inside the
empty state, where there is no list (a leftover from when a family with a claim
in flight was told she had no dancers at all).

Order is now part of the API contract rather than a display detail, because the
app renders the list as the server returns it: **confirmed dancers first**
(alphabetical — a stable list should not reshuffle between visits), then
**pending claims newest-first**, because a claim filed minutes ago is the one
she is looking for. Pending rows carry a badge, a dashed border, and the one
thing she actually needs to know: she can add awards now, privately, and they
send on approval. Section headers appear only when both kinds are present, so a
household with one dancer still sees a plain list.

`No dancers yet` now means exactly that — no confirmed dancer *and* no claim in
flight.

The screen also re-reads on focus, not just on mount. It is where a family comes
back to check whether anything moved; loading once at launch answers with
whatever was true when the app started, which is the wrong answer precisely when
she is looking.

### Independents curate; publishing is a separate grant (M9)
Auto-approval for independent dancers existed because there is no director to
ask — **not** because anything had been checked. That quietly turned one weak
decision into an unbounded one: an AwardHome reviewer approves a profile claim
they cannot really verify (parentage is exactly what AwardHome cannot judge),
and that single yes granted an ongoing right to put unreviewed claims about a
child on a public page, forever, with nothing looking at them again.

Those are two different questions, and they are now asked separately:

| Question | Who answers | What it grants |
| --- | --- | --- |
| Is this your child? | the profile claim (superadmin, for independents) | management of the profile |
| Do we publish your unreviewed entries? | `dancers.independent_publish_status` | auto-publish, still `family_submitted`, still unranked |

Default is `none`: **she curates privately.** Entries stay in staging, visible
only to her, and nothing is public. The record is kept, not queued — the app
and the web page say so plainly, because "pending review" would name a reviewer
who does not exist. Two things publish it:

1. **Corroboration**, unchanged and deliberately still automatic. Another
   household recording the same result publishes both, with no AwardHome
   involvement at all. An independent at a real competition surrounded by
   studio families is published by the people who were there. This is the door
   the "friends who are already in studios" idea eventually widens, and it is
   why the grant check sits on path 1 only and falls through to path 2 rather
   than returning early.
2. **A superadmin grant**, asked for by the family (`requested`) and decided
   once per dancer. It is **retroactive** — the whole private record publishes
   together (`releaseIndependentQueue`), which is the point: one considered
   decision instead of a queue of per-award reviews nobody can actually check.
   Revoking is deliberately *not* retroactive; it stops new entries, and
   unpublishing what is already public is a heavier decision than this surface
   should make.

Granting is superadmin-only, like the org logo coin — plain admins are kept out
of what the public sees under AwardHome's name.

**Absence is not independence.** `isIndependentSubmission` used to return true
when a submission had no `studio_id`, which handed the auto-publish door to
every dancer with no affiliation on file — 493 of them, a data gap rather than
a statement about anyone. Independence is a reviewed per-org determination that
produces a synthetic studio (`utils/independents.js`); it is never inferred
from a missing row.

Nothing was retroactively unpublished: zero awards existed at
`family_submitted` when this landed, because `family_submissions` has never
been released.

### Queuing while you wait (M8)
A pending claimant may enter awards. They stage; they do not publish.

Her premise is right — the staging file is separate, nothing in it is public,
and promotion is the only door — but it was not true of the system as built:
`runAutoPromotion` fires synchronously when a submission is created, and two of
its paths need no human at all. So staging had two trapdoors, and both had to
be closed before letting an unconfirmed household in.

- **Independent auto-approval** publishes immediately, because an independent
  dancer has no director to review anything. An unconfirmed household would
  have written canonical awards onto a child it had no established
  relationship to.
- **Corroboration** promotes *both* partners when two unrelated households
  describe the same result. This is the direction that is easy to miss:
  blocking only her own promotion would still leave her row matchable, so her
  entry would publish a *real* family's submission. Whether she is that child's
  parent is exactly what has not been answered, so her agreement is not yet
  evidence.

`award_submissions.unverified_household` records that a submission was made by
a household whose relationship to the dancer was not established. It is a fact
about the submission at the time, and it is cleared by the event that
establishes the relationship — the claim being approved — which then re-runs
auto-promotion over everything she queued. One decision by one director
releases a season of entries. A rejected claim withdraws them instead
(`withdrawn`, never deleted: the row is the audit trail, and nothing was ever
public).

Queued entries are held out of **both** reviewer queues, for different
reasons. The studio's, because the prerequisite question is already in front of
that director as a profile claim, and answering it releases everything at once —
listing them separately would put content from unconfirmed strangers in the
scarcest inbox the product has and ask for the same judgment twice. AwardHome's,
because AwardHome cannot judge parentage at all; that is why dancer claims route
to studios in the first place, and reviewing her awards while that is open would
be rubber-stamping on a child-safety surface.

Standing is decided in `utils/claims.js` (`householdStanding`) and consumed by
`validateSubmission`, so the web form and the mobile API cannot drift on the one
rule that governs who may write on a child's behalf. `/me` returns `standing`
per dancer so the app can promise the right thing: "saved to your own list and
sent when your claim is approved" is a different promise from "pending review".

**Fixed in passing:** the web claim route computed `routeDancerClaim(...)` and
then discarded it, inserting a studio only when a claim code was supplied. A
codeless claim filed on the web went to AwardHome while the identical claim from
the app went to the director — the same product decision behaving two ways. The
smoke test for the release path is what surfaced it.

### The waiting room
A pending claimant cannot submit anything yet, so the page she is left on has
to be worth the wait on its own — she is the only person in the system who can
reach the director who would end it.

Three things changed for her:

- **Most recent first.** The trophy case was ordered by award id, which is
  import order and interleaves seasons badly (one real dancer read 2023, 2025,
  2024, 2024, 2026, 2023). It now orders by competition year, newest first.
  Because a single id can no longer locate a position in that list, the page
  cursor became an opaque `"<year>:<id>"` keyset — `nextCursor` is a string,
  and clients should treat it as opaque rather than parse it.
- **The card, not the row.** Tapping any award opens the award card: the
  placement medallion, the routine, the event, the studio. The list is only an
  index into it. Empty fields are omitted rather than filled with placeholder
  words, and an unconfirmed award says so.
- **The invite path, every time.** When the dancer's studio has no owner, the
  pending panel says plainly that nobody is reviewing the claim, and offers the
  director's `/claim/studio/<unique_id>` link to share or copy. 21,693 of
  21,695 real studios are unclaimed, so this is the ordinary case.

`unclaimedStudio` is computed only for a caller with a live pending claim. A
guest browsing the same public page is told nothing about it: which studios are
unclaimed is precisely the list an outreach scraper would want, and the family
already knows which studio her child dances for.

## Rankings are objective; featuring is additive (2026-09-01)

The homepage built its Featured strip first and then **subtracted those studio
ids from every leaderboard** — all-time, this-year, and 1st-places-this-year.
The intent was to avoid listing a studio twice on one page. The effect was that
a studio silently disappeared from the Top 100 for the entire 14 days it held
an auto-rotation slot, then reappeared.

Found in production: Jun Lu Performing Arts (1,827 awards, rank #76 all-time)
was absent from the Top 100. Nothing was wrong with its data — the nightly
rotation (`utils/featured.js`, 3:30 AM) had given it `auto_featured_rank = 1`
on 2026-08-30, and it was the only studio holding a slot, so it was the only
studio being subtracted. Locally no studio had ever been auto-featured, so the
same page looked correct — which is why review never caught it.

**A ranking is decided by awards and nothing else.** Featuring is a bonus laid
on top of the board, never a swap for a place on it. The exclusion is gone
(`routes/dance/public.js`), and featured studios now deliberately appear twice
on the homepage: in the Marquee, and at the rank they earned.

This matters beyond one page of HTML. The rotation's published policy (FAQ §14)
promises "no payment, no favoritism"; a spotlight that quietly costs a studio
its leaderboard position is a real penalty attached to a reward, and the studio
owner has no way to discover why their placement vanished. It also made the
board wrong on its own terms — a Top 100 that omits #76 is not a Top 100.

Guarded by a smoke check that pins the true #1 studio as featured and requires
it in **both** the Marquee and the all-time board (the toggle at
`POST /api/studios/:id/feature` kicks a background cache refresh, so the check
polls). Restoring the old `NOT IN (...)` clause fails it. FAQ §14 now states
plainly that being featured never changes a ranking in either direction.

## Adjudicated dancer merges (2026-09-02)

`scripts/merge_duplicate_dancers.js` carries out a human's decision on the
same-name pairs that `migrate_independent_studios.js` deliberately refuses to
touch. Dry run by default; `--apply` writes.

**Why not the admin button.** `POST /api/merge/dancers` moves three tables —
`awards.dancer_id`, `award_dancers`, `dancer_studios` — and runs outside a
transaction. Ten tables carry a `dancer_id` today (add claims,
acknowledgements, card photos, consents, tombstones, hidden cards,
corrections), so the button orphans rows in the other seven, and a mid-flight
failure leaves a dancer half merged. It also deletes the source with no check
that the two records are the same person, so one mistyped id destroys an
unrelated child's profile. The script moves every table, wraps each merge in
one transaction, refuses unless both records carry the same normalised name,
and fills in profile fields the survivor lacks without ever overwriting one.

**The evidence pattern, worth reusing.** YAGP publishes a single result at
several tiers — a podium placement plus the Top 6 / Top 12 / Top 24 lists — and
the scraper writes each tier as its own award row. Normally they all land on
one dancer; where the importer name-matched them to different profiles you get
a split identity. So **two records holding nested tiers of the same event and
category are provably one dancer**: a 1st place is inside the top 6. That
proved two of the three merges. The third (Takdanai McLeod-Smith) rested on a
globally-unique name plus a valid progression inside YAGP Senior (15–19), and
the script says so rather than dressing judgment up as proof.

Idempotent — a merge whose source is already gone is reported and skipped, so
the identical run on local and prod is how parity is reached. Re-run the
independent migration afterwards to move each survivor onto its own synthetic
studio.

### Addressing rows across two databases (2026-09-02)

Folding the Zixi Yu cluster turned up a rule worth keeping. Local and prod
agree on ids for rows that predate their split, but **not** for anything
imported separately on each machine: the ADC IBC rows carry different `id`s
*and* different `unique_id`s on the two sides — prod `321833`/`321895`, local
`325181`/`325243`. Id `321833` is Zixi Yu on prod and an unrelated dancer on
local, so an id-keyed merge run on both sides would have deleted the wrong
child's profile on one of them. The same-name guard refused it.

So a data script that must run identically on both sides addresses rows by a
**natural key** — `{name, studio}` for a dancer, name for a studio — and
refuses when the key resolves to anything other than exactly one row. Ids are
safe only where both databases demonstrably agree, and `unique_id` is not the
escape hatch it looks like: it is minted at insert, so an import run twice
mints it twice. This is the same principle as ETL idempotency (find before
create on a natural key), applied to maintenance scripts rather than importers.

A corollary for `POST /api/merge/dancers`: it takes raw ids from the caller and
deletes the source with no identity check at all. Fine from the admin compare
screen, where a human just looked at both records; not something to drive from
a list of ids copied between environments.
