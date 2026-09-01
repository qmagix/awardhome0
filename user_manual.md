# Studio Admin Portal User Manual

Welcome to the Studio Admin Portal documentation. This manual provides instructions on how to use the various data importation scripts designed to pull competition results from the web into your local database.

Currently, the system is designed to support 8 major competitions. The importation scripts are split into two major architectures based on how the respective competitions publish their results.

## 1. The DanceBug Importer (5 Competitions)
Five of our supported competitions utilize DanceBug for their results hosting. We have built a unified, dynamic batch import script (`batch_import.js`) that handles all of these simultaneously.

**Supported Competitions:**
- Starpower Talent Competition (`starpower`)
- Revolution Talent Competition (`revolution`)
- Believe Talent Competition (`believe`)
- Imagine Dance Challenge (`imagine`)
- DreamMaker Dance Competition (`dreammaker`)

### How to use:
To run the importer for a specific competition, use the `batch_import.js` script followed by the competition's slug. You can optionally specify one or more years to run. If you don't specify any years, it will automatically attempt to scrape all historical data from 2026 back to 2016.

**Syntax:**
```bash
node batch_import.js <slug> [year1] [year2] ...
```

**Examples:**
```bash
# Scrape Imagine Dance Challenge for the years 2025 and 2024
node batch_import.js imagine 2025 2024

# Scrape DreamMaker for all available historical years
node batch_import.js dreammaker

# Scrape Revolution for 2026
node batch_import.js revolution 2026
```

## 2. Standalone Scrapers (KAR & Rainbow)
KAR and Rainbow host their own result platforms with unique structures, so they have dedicated scraping scripts.

### DanceKAR
KAR data is scraped using `scrape_kar_year.js` and `scrape_dancekar.js`. 
- To scrape a specific year, you can edit the bottom of `scrape_kar_year.js` to define your target year, then run:
  ```bash
  node scrape_kar_year.js
  ```

### Rainbow National Dance Competition
Rainbow data is similarly scraped using `scrape_rainbow_year.js`.
- To scrape a specific year, edit the target year at the bottom of the script, then run:
  ```bash
  node scrape_rainbow_year.js
  ```

### Mass Scraping (KAR & Rainbow)
If you want to pull down the entire historical archives for **both** KAR and Rainbow simultaneously (from 2024 back to 2016), you can run the master script:
```bash
node scrape_all_years.js
```

## 3. Youth America Grand Prix (YAGP)
YAGP results have a unique table structure (including complex Pas De Deux and Special Awards formats). Use the dedicated `scrape_yagp_year.js` script to parse individual event result pages.

**Test Mode (Dry Run)**
To safely extract and view the data as JSON without writing to the database, use the `--test` flag:
```bash
node scrape_yagp_year.js --test https://yagp.org/yagp-2025-tampa-fl-finals-winners/
```
*Note: This will output the results to the console (you can pipe it to a file like `> test.json` for review).*

**Live Database Import**
Once verified, run the script without the test flag to insert the awards, dancers, and studio linkages into the SQLite database. The script is highly idempotent and will skip duplicates safely.
```bash
node scrape_yagp_year.js https://yagp.org/yagp-2025-tampa-fl-finals-winners/
```

**Mass Scraping by Year**
To scrape an entire year's worth of YAGP results simultaneously, use the `scrape_all_yagp.js` master script. This script dynamically pulls all event URLs for a given year directly from YAGP's WordPress sitemap and processes them in bulk.
```bash
node scrape_all_yagp.js 2024
```

## 4. Offline-First HTML Caching System
To prevent rate limits and dramatically speed up subsequent imports or bug-fixing reruns, all scraper scripts (DanceBug, KAR, Rainbow, YAGP) utilize an **Offline-First HTML Caching System**.

When a script fetches an event page or event list for the first time, it automatically saves the raw HTML response to the `./raw/<org_slug>/<year>/` directory on your local machine. Any subsequent runs of the import script will automatically trigger a **[Cache Hit]** and load the local file instantly without making a network request.

### Forcing a Network Refetch
If you need to bypass the local cache and force the scraper to download fresh HTML from the internet, simply prepend the `REFETCH=true` environment variable to your command.

**Example:**
```bash
REFETCH=true ./import_all_years.sh
REFETCH=true node batch_import.js starpower 2026
```

## 5. Studio Deduplication & Normalization
YAGP frequently appends geographic codes (e.g., `, CA`, `, China`) to studio names, causing the database to spawn duplicate entries for the same studio (e.g., `Studio X` and `Studio X, CA`). 

To resolve this without deleting or destroying cross-event data, run the `dedup_studios.js` script periodically after large ingestions.
```bash
node dedup_studios.js
```
This script will:
- Scan for studios containing a comma.
- Extract the base name and check if it already exists in the database.
- Seamlessly re-link all dancers to the base name.
- Store the longer, comma-appended name in the base studio's new `aka` field to preserve the alias.
- Delete the duplicate studio record.

## 6. Downloading Legacy PDFs
For older years (typically pre-2022), DanceBug competitions often published their results as static PDF files rather than HTML pages. These cannot be automatically parsed into the database. 

However, you can automatically bulk-download all of these legacy PDFs to your local machine for offline archiving using the `download_legacy_pdfs.js` script.

**How to run:**
```bash
node download_legacy_pdfs.js
```
This script will loop through all 5 DanceBug competitions, scan their historical archives, and download any PDF results it finds into the `/tobeprocessed/pdf/<competition_slug>/` directory, along with a handy JSON metadata file for each PDF.

## 7. Studio Contact Information Bootstrapping
You can auto-populate missing website, email, phone, and address data for studios by running the bootstrapper:
```bash
node bootstrap_studios.js
```
This script acts strictly as a gap-filler. It searches your database for studios that **do not have** a website, email, or phone number, and searches DuckDuckGo for matching contact info. It skips any studios that already have contact info stored.

## 8. Full Database Reset Workflow
If you need to completely wipe the database and perform a clean multi-year ingestion (e.g., refreshing all data from 2022-2026), follow this safe workflow to preserve your manually curated studio contact info:

1. **Backup Contacts**: Run `node export_studio_contacts.js` to create `studio_contacts_backup.json`.
2. **Wipe Database**: Delete `database.sqlite`.
3. **Initialize Schema**: Start the server briefly (`node server.js`) to auto-create the empty schema, then stop the server.
4. **Seed Organizations**: Run `node seed_orgs.js` to populate the 8 root organizations.
5. **Mass Import**: Run `./import_all_years.sh` to ingest all events and trigger the auto-backfill mapping.
6. **Restore Contacts**: Run `node import_studio_contacts.js` to restore the emails, phones, and websites.
7. **Fill Gaps**: Run `node bootstrap_studios.js` to find contact info for any brand new studios discovered during the mass import.

## Platform Documentation
To assist users in navigating the platform, two standalone FAQ pages are hosted on the application itself:
- **Studio Admin FAQ (`/faq/admin`)**: A comprehensive guide for Studio Directors on how to claim their studio, customize their public profile, embed the iframe widget, and manage their dancer roster securely using the Secret Join Code. It also details the "Pseudo-Studio" architecture for handling multi-studio collaborations (e.g. YAGP Pas De Deux).
- **Dancer FAQ (`/faq/dancer`)**: A guide for students/parents explaining how to navigate their Dancer Dashboard, use the Find Missing Awards search tool to backfill their history, claim awards via the public directory using their Studio Secret Code, reuse their Unique ID for faster claiming, and understand the platform's privacy protections.

## 9. AI Marketing Summary Generator (Studio History)
The Studio Admin dashboard features a powerful, two-step AI Marketing Summary Generator designed to automatically convert a studio's raw historical awards data into inspiring, copy-pasteable marketing copy for social media and press releases.

### How to Use:
1. Navigate to the **Studio History** page (`/manage/studio/:id/history`).
2. Next to any organization (e.g., YAGP), click the **📄 Generate Text Summary** button.
3. **Step 1 (Curate):** A modal will appear with a checklist of all awards won by the studio at that organization. 
   - *Auto-Check Logic:* The system automatically checks the boxes for major podium placements (1st, 2nd, 3rd, Hope Award, Grand Prix). "Top X" placements (e.g., Top 12) are left unchecked by default to keep the summary concise, but you can manually toggle any award.
4. **Step 2 (Generate):** 
   - **Raw Text:** Click "Generate Raw Text Summary" to produce a standard, grouped text list of the selected awards.
   - **AI Marketing Copy:** Select a tone from the dropdown ("Enthusiastic" for social media, or "Professional" for press releases) and click **✨ Generate AI Summary**.
5. **Auto-Save:** Once the text is generated, you can edit it directly in the text box. The system will silently autosave your edits to the database to help improve future AI models!

## 10. Flip-Book Award Cards: Photos, Thank-You Notes & Colophon
Award cards on public dancer pages can render in two designs (A/B): **Classic** (two-face flip) and
**Flip-book** (the back becomes a swipeable mini-book). A superadmin picks the site-wide default at
`/admin/settings` → "Award Card Design"; anyone can preview per session with `?card_design=flipbook`
(or `classic`; `default` clears the override) on a dancer page.

### For dancers / parents (Dancer Dashboard → 🎴 Card Photo & Thanks)
- **Per-award photo:** each award can carry its own photo — usually that routine's performance
  shot — shown in a rectangular frame with the routine name as caption. On group routines the
  photo is per dancer, so each family controls what appears on their own dancer's card.
- **Default card photo:** one fallback photo (circular frame) used on any card without its own
  award photo. A clear headshot or stage portrait works best.
- Uploads are PNG/JPG/WebP/GIF/AVIF, ≤5 MB, and the consent checkbox is mandatory (for award
  photos it covers everyone pictured).
- **Thank-you notes:** one short line (≤280 chars) per award. Leave the field blank and Save to
  remove a line. On group routines, each dancer writes their own line and the card shows them all.

### For studio directors
Open **Roster** and click **Card** on any active dancer's row — same page, same abilities. Useful
for adding photos/notes on behalf of families.

### For organizers
The flip-book's last page is your "Presented by" colophon: your fitted coin logo shown large plus an
optional tagline (Branding page → "Card 'Presented by' Tagline", ≤140 chars). It appears once your
logo is approved for public display (the usual concierge fitting flow).

### For superadmins
- `/admin/card-content` — review queue. Approve/reject pending photos and thank-you lines; every
  new submission or edit lands here as `pending` and is invisible publicly until approved.
- `/admin/settings` — flip the site-wide card design (instant, no restart).

## 11. Dancer Profile Claims: Studio-Code Routing & Notifications
The dancer profile claim form (public "Claim this Dancer" button) accepts an optional **Studio
Claim Code** — the same `join_code` directors already hand out for award claiming.

- **Valid code** (matches a studio the dancer is affiliated with): the claim routes to that studio
  director's **Verifications → Profile Claims to Confirm** queue, and the director gets an email.
  Their approval finalizes the claim — ownership assigned, role upgraded, no admin step. The code
  proves community membership only, so directors are asked to confirm the person belongs to that
  dancer's family before approving.
- **No code / wrong code**: the claim goes to the system-admin queue at `/admin/claims` as before.
  Wrong codes are flagged ("✗ Bad code"); valid-code claims also appear there as a backstop with a
  "✓ Code: <studio>" badge for confident one-click approval.
- **Notifications**: the claimant is emailed on approval (deep-linking to the card-extras page and
  their dashboard) and on rejection — from either review path. Approving a claim auto-rejects any
  competing pending claims for the same dancer (those claimants are emailed too).

## 12. My Dancers Dashboard (Parent/Dancer Accounts)
`/my-dancers` is the home surface for parent and dancer accounts ("My Dancers" in the nav for
`user`/`dancer_owner` roles; legacy `/my-dancer` redirects here). It lists every dancer the
account owns — parents can claim multiple kids — with buttons for the public trophy case,
profile management, and card photo/thank-you extras, plus a "Claims in Review" section showing
each pending claim's routing ("awaiting your studio director" vs "awaiting AwardHome review").
Login redirects here for any account with a claimed dancer or a claim in flight; accounts with
neither see an empty state explaining how to find and claim a dancer.

## 13. Card Extras: Same-Routine Propagation & Cross-Browser Note
- **Type it once:** when one routine wins several awards at the same competition, saving a
  thank-you note or award photo auto-fills the matching awards (same event + routine name, the
  Smart Auto-Backfill rule). Already-filled awards are never overwritten; later edits or removals
  affect only the award being edited. On the moderation side, one approve/reject settles every
  pending copy with identical content from the same dancer — the reviewer judges the content once.
- **Browser note (fixed 2026-08-13):** flip-book page content was invisible in Chrome/Firefox
  (fine in Safari) because the entry-fade animation on back-face pages never ticked while the
  card was unflipped, freezing pages at opacity 0. The fade now applies only during actual page
  turns (`tcb-entering` class), never on the resting state.

## 14. One-Time Photo Consent
Photo uploads no longer show a consent checkbox on every form. The first upload an account makes
for a given dancer asks for a single combined affirmation (parent/guardian status or family
permission, plus permission from everyone pictured in uploaded photos); it's recorded in
`card_photo_consents` (per uploader × dancer, with timestamp) and all later uploads for that
dancer skip the checkbox. The card-extras page shows "Photo permission on file (date)" once
recorded. Parents and studio owners each give their own affirmation, since each is vouching for
their own uploads.

## 15. WYSIWYG Card Editor
`/manage/dancer/:id/card` ("🎴 Edit Award Cards") now shows the dancer's actual flipbook cards
instead of a form list. Flip a card, page to the photo or thank-you page, and edit in place —
empty pages appear as placeholders ("Upload this routine's photo" / "Write your thank-you note
here") in the editor only, never on public pages. Front faces carry a progress chip (2 to add /
1 to add / ✓ Done); filter chips (All / Needs input / Partial / Done) plus incomplete-first
sorting keep big trophy cases manageable. Saves happen inline (fetch + `?json=1` on the card
endpoints) with a toast noting same-routine propagation. The one-time photo consent appears as a
checkbox bar above the grid until given. The default card photo (circular fallback) and its
consent moment moved to the Manage Profile page.

## 16. Feature Flags & Auto-Moderation
**Release console (`/admin/features`, superadmin):** every feature ships dark and goes public
here — deploy ≠ release. States: off → beta (admins + early_access users) → on; set a "scheduled
flip" datetime and the flag promotes itself to on at that moment (lazy, no cron). Flags propagate
to visitors within ~15 s. Current flags: thank_you_notes, award_photos (both seeded OFF by the
prod migration — flip them when you want the public launch), auto_moderation. Add new flags in
utils/featureFlags.js FLAG_DEFS and gate surfaces with flagOn().

**Auto-moderation (`/admin/settings` → Card Content Moderation):** requires the auto_moderation
flag. Modes: manual (queue everything), assisted (queue everything but show 🤖 machine verdicts),
auto (machine-clean notes go live instantly; flagged notes queue with the reason, e.g.
"flagged: phone number"). The pipeline: rules (links/emails/phones/handles/profanity) → trusted
authors (≥3 approved notes) → OpenAI Moderation API (free). Failures never auto-approve.
`/admin/card-content` shows a "Recently Auto-Approved" feed — Revoke pulls a note and its
identical copies off the cards. Photos are always human-reviewed.

## Upcoming Events (planning your season)
- **Studios/parents:** browse `/dance/events` for every competition's published tour dates in one place. Filter by state, month, or competition; each listing links to registration or the organizer's official site. Always confirm dates and venues with the organizer before booking travel.
  - **Near me:** tap "📍 Near me" and allow the browser location prompt — events sort by distance (miles shown) with a 100/250/500-mile radius picker. Your location is used for that page view only and never stored; declining the prompt just leaves the State filter.
  - **Shortlist:** signed in, tap the ☆ on any event to save it; "★ My Shortlist" filters to your saved events. Works for studio owners and parents alike.
  - **Calendar:** "Add to Calendar (.ics)" downloads whatever you're currently viewing (filters, near-me, or your shortlist) as an iCalendar file that imports into Google/Apple/Outlook calendars.
- **Organizers:** manage your listings in the dashboard's **Upcoming Events** tab (also reachable from the "Tour dates" link when viewing your public page). Dates you enter yourself always override anything imported. Your stops appear on your public page ("On Tour") and in the directory.

## 17. Family Award Submissions (staged)

Behind the `family_submissions` feature flag — dark by default, released at
`/admin/features` like every other flag.

**For families.** Open a claimed dancer from **My Dancers** → **Add a Missing
Award**. Pick the competition, name the routine, choose the size (solo / duet /
trio / small group / large group / line / grand line / production), and add the
placement, category, teacher and choreographer if known. The entry saves
immediately and shows as **Pending review** on that page — private to the
household, on no public page, and not yet a real award.

Things worth knowing at the counter:
- **Nobody types a studio name.** It comes from the dancer's affiliation. A
  dancer at two studios is asked which one the routine was danced for.
- **Group routines record an incomplete cast on purpose.** Enter your own
  dancer; other families fill in theirs.
- **Duplicate submits are safe.** Each form carries an idempotency key, so a
  double-click or a refresh-resend returns the original entry.
- **Limits:** 40 submissions and 10 dancer-profile claims per household per day.

**For operators.**
- Submissions live in `submissions.sqlite`, not `database.sqlite`
  (`SUBMISSIONS_DB_PATH` overrides it). Back it up alongside the main database.
- Nothing here writes a canonical award. Promotion is the reviewer inbox (M3),
  not yet built — until then, submissions accumulate and are read-only to the
  platform.
- `node scripts/check_submission_orphans.js` reports staging rows pointing at
  canonical records that no longer exist. It never deletes. The weekly Sunday
  integrity cron runs it automatically.

## 18. Independent Dancers (migration)

Some competitions publish unaffiliated entrants on one shared regional roster
(`Independent, CA`). That is unsafe: two same-name dancers on one roster can be
merged into a single person by the duplicate-profile tooling. Each independent
dancer now gets a private one-dancer studio record instead.

```bash
node scripts/migrate_independent_studios.js            # dry run — prints the plan
node scripts/migrate_independent_studios.js --apply
```

Idempotent; run the identical command on local and prod (never copy a database
between them). Writes `reports/independent_migration.json`.

What it deliberately does **not** do:
- It never splits a **same-name pair** — each is either one person entered twice
  or two different children, and only a person can tell. They are listed in the
  report; decide by hand, then re-run.
- It never moves an award with **no resolved dancer** or one shared by several
  independents. A published result is a real fact even when the person cannot
  be identified.

Detection uses a reviewed per-organization list in `utils/independents.js`, not
a pattern match on the word "independent" — `IndepenDANCE Studio` is a real
studio. Adding a competition to the list means reading the dry run's full output
first.

Independent records never appear in the studio directory, public search, the
featured rotation, the homepage leaderboards, the platform studio count, or
merge suggestions; their award cards read simply **Independent**, and their
studio URL redirects to the dancer.

## 19. Event Candidates (reviewer queue)

Part of family submissions (section 17), same `family_submissions` flag.

**For families.** In the Add-an-Award flow, tap **📍 Events near me** and allow
the location prompt — organizer tour stops within 75 miles of you on that date
appear, and one tap picks the right one. No location, or a competition we have
never heard of? Search by name, or use **Add the event**. Anything you add
becomes selectable by other families at the same event straight away, marked
"Added by a family" until a reviewer confirms it.

If someone already added something that looks like your event, you will be shown
it first — picking theirs is what makes both households' submissions land on one
event instead of two.

**For reviewers — `/admin/event-candidates` (superadmin).** Promotion authority
is AwardHome's alone: a studio owner promoting a candidate would let one studio
mint canonical events for the whole platform.

The queue groups candidates by **dedup cluster** — two families who each
insisted their event was different are one decision, not two. For each
candidate you can:

- **Merge into an existing event** — usually the right answer. Suggestions are
  ranked by name similarity plus a city bonus (canonical event names normally
  carry the city). You can also paste an event id directly.
- **Promote to a canonical event** — set the organization first; a canonical
  event cannot exist without one, so promotion refuses until you do.
- **Reject** — this does *not* delete the families' submissions. The award still
  happened; it needs a new home, and a later merge or promote gives it one.

Promoting or merging re-points every submission on that candidate at the
canonical event. Both operations are safe to repeat: a second promote returns
the same event rather than creating another.

**Auto-merge.** When an organizer's own results import lands an event that
unambiguously matches an open candidate (same organization and year, strong name
match), the candidate merges into it with no human step — the organizer's
published data outranks a family's guess by definition. This runs at the end of
every successful weekly import; run it by hand with:

```bash
node scripts/merge_event_candidates.js            # dry run
node scripts/merge_event_candidates.js --apply
```

Two plausible matches are never guessed between — that would file an award on
the wrong weekend of a tour. They are left in the queue with both options shown.

## 20. Family Submissions: the Studio Inbox

Behind the `family_submissions` flag. **Studio dashboard → Family Submissions**
(the nav entry carries a count when work is waiting).

Every award a family added for one of your dancers lands here, and nothing is
public until you say so. For each one:

- **Confirm & publish** — writes the real award onto that dancer's trophy case
  and your studio page, recorded as confirmed by you.
- **Correct it first.** The fields are editable in place. Fix a placement or a
  routine spelling and confirm in one go; you don't have to reject a real award
  over a typo. Fields you don't touch keep the family's wording.
- **Ask the family** — sends it back with your question instead of forcing a
  yes/no.
- **Reject** — for something that didn't happen, or isn't yours.

Things the system does for you:

- **Solos and groups are recorded differently**, using the size the family
  chose. A group stays a group even when only one dancer is on it, so other
  families can add themselves later.
- **A dancer you previously removed from a routine is never re-added** by
  confirming. You'll see a message instead; re-add them from Group Routine
  Dancers if that removal was a mistake.
- **Family-added competitions have to be confirmed first.** If the event itself
  came from a family, the Confirm button waits until AwardHome settles the event
  (section 19). You can still review the details.
- **You only ever see your own studio's submissions.** Independent dancers have
  no studio, so they never appear in any studio's inbox.

## 21. Card Photos: Approving for Your Studio

Behind the `award_photos` flag. Card photos on your routines now wait for
**you**, in **Pending Verifications → Card Photos to Approve** — not for the
AwardHome team.

How a photo travels:

1. A family uploads it. It is immediately visible to the families of the
   dancers **in that routine**, and to nobody else.
2. Any of those families can say *"please don't share this"*. That is enough on
   its own — no vote, no tally. A group photo shows other people's children, and
   one parent's objection should win.
3. If nobody objects, you approve it and it goes public on that dancer's trophy
   case.
4. Once public, anyone can report it. A report takes it straight down and sends
   it to AwardHome. (If AwardHome puts it back, further reports queue instead of
   taking it down again, so it can't be used as a weapon.)

If a family in the routine has objected, you'll see that on the photo and the
Approve button is gone — AwardHome decides that one. That's deliberate: you
shouldn't be put in the position of overruling one of your own families about a
picture of their child.

The dancer's **default** card photo (set on their profile, used when a card has
no photo of its own) still goes through the AwardHome team — it isn't tied to a
routine, so there's no cast to ask.
