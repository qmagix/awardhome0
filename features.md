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
  - Moderation queue: `/admin/card-content` (superadmin) approves/rejects pending photos and lines.
  - Design intent: the multi-face structure is also groundwork for auto-generated social video
    shorts (flip through faces with audio) — see ideas.md.

## 4. Superadmin Controls
- **Data Drafts / ETL Triage:** Review scraped web data (emails, addresses) before merging into live studios.
- **Role Management:** Promote standard users to admins.
- **Organization Management:** Full CRUD interface for adding, editing, and deleting Competition Organizations.
- **Studio Deduplication:** An automated system (`dedup_studios.js`) that identifies duplicated studios containing geographic suffixes (e.g., "Studio X, CA"), merging them into their base name and maintaining an internal `aka` alias field to prevent data fragmentation.

## 5. FAQ & Instructions Documentation
- **Studio Admin FAQ (`/faq/admin`)**: Outlines how to claim a studio, customize the profile, manage the roster using the Secret Join Code, approve/deny claims, handle multi-studio "Pseudo-Studio" collaborations, and embed the Widget.
- **Dancer FAQ (`/faq/dancer`)**: Explains how to create a profile via award claiming, the difference between the Unique ID and Studio Code, what the colored verification badges mean, how Smart Auto-Backfill works, and privacy guarantees.
- **Global Footer Navigation**: Both FAQ pages are permanently linked in the website footer for easy accessibility from any page.
