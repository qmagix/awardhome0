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

## 3b. Award Card Designs (A/B)
Two selectable card designs render on public dancer pages. The site-wide default is a superadmin
setting (`card_design` at `/admin/settings`); any visitor can preview a variant per session with
`?card_design=classic|flipbook` on a dancer page (`?card_design=default` clears the override).
The registry lives in `utils/cardDesign.js` — future designs are added there and branched on in
`views/partials/dancer_award_card.ejs`.

- **Classic (original):** two faces — trophy front, champagne certificate back with the share button.
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

## 5. FAQ & Instructions Documentation
- **Studio Admin FAQ (`/faq/admin`)**: Outlines how to claim a studio, customize the profile, manage the roster using the Secret Join Code, approve/deny claims, handle multi-studio "Pseudo-Studio" collaborations, and embed the Widget.
- **Dancer FAQ (`/faq/dancer`)**: Explains how to create a profile via award claiming, the difference between the Unique ID and Studio Code, what the colored verification badges mean, how Smart Auto-Backfill works, and privacy guarantees.
- **Global Footer Navigation**: Both FAQ pages are permanently linked in the website footer for easy accessibility from any page.
