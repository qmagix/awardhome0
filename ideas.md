# Product Ideas & Monetization Workflows

## 1. AI-Powered Studio Marketing Summaries
**Concept:** Instead of just providing a raw list of historical awards, the platform uses AI (OpenAI/LLMs) to transform a studio's historical data into highly inspiring, concise, and professional marketing copy. This copy is optimized for social media (Instagram, Facebook), newsletters, and press releases.

**Value Proposition:** Studio owners spend hours trying to write compelling marketing copy that highlights their students' achievements without sounding overly boastful or reciting a boring spreadsheet. This feature instantly generates "brag sheets" and engaging stories based on their verified data.

**Monetization Strategy:**
- **Freemium Hook:** Offer one "Free AI Marketing Summary" per year as an incentive for a studio owner to *claim* their studio profile and verify/improve their award data. This drives user acquisition and data integrity.
- **Premium Feature:** Unlimited AI summaries, customizable tones (e.g., "Professional Press Release", "Enthusiastic Instagram Post"), and cross-organization summaries are locked behind a SaaS subscription tier for paying customers.

**Technical Execution:**
1. The user selects a subset of their awards via the History Checklist UI.
2. The selected data is sent to an OpenAI backend endpoint.
3. A strict system prompt commands the AI to synthesize the raw awards into an inspiring narrative, highlighting major podium placements and ensemble victories.

## 2. Multi-Page "Flip-Book" Award Card (brainstormed 2026-08-12)
**Concept:** Extend the two-face flip card (trophy front / certificate back) into a paged mini-book on the back: certificate → dancer photo → acknowledgements → organizer colophon. Tap flips the card; swiping (or dot/edge-tap) pages through the back-stack. Pages with no content simply don't exist — the guaranteed faces (front + certificate) never depend on user uploads.

**Key elements:**
- **Photo page:** upload by studio owner or dancer owner; approval/consent-gated (minors) and default-off, mirroring the logo-coin concierge pattern. When present, also inset a small portrait medallion on the certificate page.
- **Acknowledgements page:** "With thanks to…" (teachers, teammates, parents). This is the viral page — a dancer thanking Mom and a named teacher is exactly what parents and studios re-share. For **group routines each dancer gets their own ack line** (stored per `award_dancers` row), rendered like a signed yearbook page with the viewing dancer's line pinned first. Owner-moderated before public display.
- **Organizer colophon (last page):** big logo, event name, optional organizer message/sponsor credit — the natural home for trophy_plan.md's premium sponsor tagging, sold as part of the organizer tier.
- Each page independently shareable as an image (share button per page).

**Monetization ties:** photo + ack pages drive dancer/parent engagement and claims; colophon page is an organizer-tier upsell; sponsor line fits Tier 2/3 of the Digital Trophy plan.

Patent-candidate details tracked in `maybe_patentable.md` (A3, A4).

**Status:** SHIPPED 2026-08-12 as the "flipbook" design behind the A/B card-design switch (see features.md §3b).

## 3. Auto-Generated Social Video Shorts from Card Faces (brainstormed 2026-08-12)
**Concept:** Automatically generate a short vertical video (Instagram Reels / TikTok / YouTube Shorts format) from a flip-book award card: the card flips face to face — award front → certificate → dancer photo → thank-you notes → organizer colophon — with flip/page-turn animations and appropriate audio (whoosh/chime per flip, optional music bed, possibly TTS reading the placement or the thank-you line).

**Why the flip-book structure matters:** each card face is already a complete, approval-gated composition. The video generator is then just a deterministic sequencer over existing faces — no per-video design work, and everything shown has already passed moderation.

**Value Proposition:** dancers/parents get a share-ready highlight clip in one tap ("Share as video"); studios get recap reels ("Our weekend at Nationals" — a montage across dancers' cards); organizers get branded reach (their colophon closes every clip — extends "your brand on every card" to "your brand closing every video").

**Monetization:** free watermark-light clips for dancers (growth loop); studio-level montages and organizer-branded end-cards as premium; per-event recap videos as an organizer-tier deliverable.

**Technical sketch:** server-side render of card faces to frames (headless Chromium screenshotting the existing EJS/CSS at fixed size), ffmpeg to compose flips/transitions + audio; or client-side via canvas/WebCodecs for instant no-server sharing. Prerequisite: per-page share-image rendering (see TODOS).

Patent-candidate details tracked in `maybe_patentable.md` (A6).

## 4. Superadmin Dynamic AI Model Switcher
**Concept:** A centralized "System Settings" dashboard for Superadmins that allows dynamic, zero-downtime switching of the underlying LLM model (e.g., from `gpt-4o-mini` to `gpt-4o` or `gpt-3.5-turbo`) used across the platform.

**Value Proposition:** AI costs and capabilities fluctuate rapidly. By exposing the model selection to the Superadmin interface instead of hardcoding it in the codebase or requiring a `.env` server restart, the platform operator can instantly optimize for cost during high-traffic periods, or switch to a higher-intelligence model for premium users or special use cases without any technical friction.

## 5. Social Reactions ("Cheers") on Award Cards (brainstormed 2026-08-19)
**Concept:** Friends and family can tap a lightweight reaction (👏 cheer / ❤️ love) on individual awards in a dancer's trophy case. Counts render on the card (and mini-card grid), giving dancers social proof and giving relatives a one-tap way to participate without accounts-heavy friction.

**Value Proposition:** turns the trophy case from a read-only archive into a shareable social object — "grandma loved your solo" is the retention loop that brings dancers back between competition seasons, and reaction counts are organic content for the share/video surfaces (ideas §3).

**Backend design (agreed direction):** separate `reactions.sqlite` following the `utils/sessionStore.js` precedent (own connection, WAL, busy_timeout) — not for query speed (counts are trivially indexable) but for **write isolation**: reactions are the first tap-frequency write path in the app, and a separate file keeps them from contending with app-data writes and from inflating Litestream WAL replication churn on the main DB. Schema: `reactions (award_id, reactor_key, type, created_at, UNIQUE(award_id, reactor_key, type))` + per-award counts computed by indexed GROUP BY (denormalize later only if needed). Counts merge in app code (no cross-DB JOIN needed; ATTACH available as fallback). Reactor identity: logged-in user id, else signed anonymous cookie key; per-IP rate limit + toggle-off (re-tap removes) for abuse control. Ship behind a `reactions` feature flag to the beta cohort.

## 6. Award-Flip Surprise Reveals — Sponsored Prize Lottery (brainstormed 2026-08-19)
**Concept:** Occasionally, flipping an award card reveals a surprise "golden ticket" page: a real prize — free entry to a specific competition (funded by the event organizer) or a gift/discount from a dancewear sponsor. The flip gesture that already delights (certificate easter egg) becomes a variable-reward moment.

**Value Proposition:** three-sided flywheel — dancers get a lottery-ticket thrill on every visit; organizers get a *conversion* channel ("free entry" converts a dancer to their next event, more compelling than logo placement); sponsors get performance-marketing placement inside the most emotionally-charged surface in the product. Strong carrot for org outreach: "fund surprise entries for dancers who won at YOUR events."

**Monetization:** organizers/sponsors fund prize pools (flat placement fee or per-redemption); platform controls odds/pacing. Later: tiered pools (bigger prizes for verified/claimed profiles → drives claims). **Outreach integration (2026-08-20):** the partner pledge (a few free entries per season; named "Season One Partner" as of 2026-08-27 — season-scoped to avoid permanent-title expectation debt) is the commitment device in org invites — see org_invite_draft.md v3 strategy section; until the legal review clears chance mechanics, pledged entries are awarded editorially (merit, not chance).

**⚠️ Legal gate before ANY launch:** this is a sweepstakes aimed largely at **minors** — needs attorney review (no-consideration structure, official rules, state sweepstakes law, COPPA/guardian consent, prize redemption routed to parent/guardian, tax reporting ≥$600). Same attorney touchpoint as the patent triage.

**Technical sketch:** `prize_pools` (sponsor, prize, inventory, odds, window, redemption terms) + `prize_reveals` (dancer/user, award, pool, revealed_at, redeemed_at, code); server-side roll on flip event (never client-side), seeded/rate-limited per user+day so re-flip farming is useless; win → guardian-email claim flow with single-use redemption code (reuse org-claim token pattern); superadmin pool console; `surprise_reveals` feature flag. Prerequisite: partnered orgs/sponsors exist — sequence AFTER beta claims land.

Patent-candidate details tracked in `maybe_patentable.md` (A7).

## 7. Upcoming Events Directory — "Plan Your Season" (brainstormed 2026-08-26)
**Concept:** Aggregate every organizer's upcoming tour dates (city, venue, dates, registration link) into a searchable directory — filter by state/region, month, and organizer — plus an "Upcoming Events" section on each org's public page. Sourced by scraping organizer tour pages (many share registration platforms like DanceBug, so one scraper covers several orgs); claimed organizers manage their own listings in the dashboard, which overrides scraped data.

**Value Proposition (three-sided):**
- *Studios*: Q ran a studio — every year studio owners hand-compile nearby-competition spreadsheets (location, venue, dates) to plan the season. A trusted aggregated calendar removes real annual toil and creates a second visit season (planning/booking in fall, results in spring) → year-round traffic instead of post-results spikes.
- *Organizers*: reaches studios at the exact moment they decide where to compete — filling next season's ballroom is worth more to an org than flattering last season. Registration-link clicks become per-org demand telemetry (stronger outreach ammunition than card clicks).
- *Platform stickiness / objection defense*: an org that wants off the results archive would also drop off the directory studios use to book — leaving costs them forward-looking bookings, not just archival vanity. Listing management is also a fresh claim incentive ("your dates, under your control").

**Risks/cautions:** stale dates actively harm (studios plan trips) — needs weekly refresh, "last updated" stamps, season rollover cleanup, and an "always confirm with the organizer" line linking the official page; scraped ≠ authoritative, so owner-entered data must always win.

**Technical sketch:** `org_upcoming_events` (org_id, name, city, state, venue, start_date, end_date, registration_url, source 'scraped'|'owner', last_seen_at, status) — idempotent scrape keyed org+city+start_date; owner rows never overwritten. Phase 1: schema + owner/superadmin manual entry + org-page section + public directory page with state/month filters (seed the 17 orgs by hand — validates UX before any scraper). Phase 2: scrapers for platform-hosted tour lists + weekly pipeline slot. Phase 3: studio tools — near-me, shortlist, ICS calendar export, season-planning email digest.

## 8. Portable Dancer ID — universal registration identity (brainstormed 2026-08-27)
**Concept:** One lifetime dancer ID usable across competitions, conventions, studio class registration, and clubs. A dancer gives an organizer her ID; the organizer pulls her registration profile (name, DOB, studio, level, guardian contact, waivers) from the ID service with her/guardian's consent — no re-typing at every event, fewer roster errors. Precedents: ORCID (researchers), USA Gymnastics athlete numbers, AAU membership IDs.

**Value Proposition:** dancers/studios save the same data-entry toil every event weekend; organizers get clean rosters AND — the AwardHome-only differentiator — *verifiable competitive history* for division/level placement (anti-sandbagging), which no generic identity provider can offer. Strong org-outreach carrot: "claim your org, get error-free pre-filled registrations."

**Verdict (agreed direction): module-first, not an independent project yet.** Build it as a bounded "DancerID" module inside AwardHome with clean seams (stable IDs, consent-scoped profile API, organizer API tokens); extract to a standalone service only when a *second real consumer* exists (e.g. a reg-platform pilot). Reasons: (1) AwardHome's ~900k awards attach mostly to unclaimed scraped profiles — those are *records*, not *identities*; only claimed accounts can carry a portable ID, so "sync existing users" means the claimed set, not the archive. (2) Registration data (DOB, address, guardian contact, waivers) is data AwardHome doesn't hold — the service is a new data-collection product, not an API over existing data. (3) Adoption, not code, is the moat: most orgs register through platforms (DanceBug, DanceComp Genie et al.), so the real integration target may be the platform, and AwardHome's org-outreach channel is the only wedge we have — spinning out early orphans the idea from its distribution.

**⚠️ Legal gate:** the profile is PII of mostly-minors shared with third parties — COPPA + state privacy law, verifiable guardian consent per disclosure, data-processing agreements with each organizer. Same attorney touchpoint as ideas §6. The guardian-mediated selective-disclosure consent model may itself be the patentable piece → triage in `maybe_patentable.md`.

**Cheap moves now (preserve the option):** (a) treat `dancers.unique_id` (`DNC-…`) as the future portable ID — document a stability contract: never recycled, never re-slugged on rename/merge; (b) paper-design the consent scoping (guardian grants organizer X access to fields Y until date Z, revocable); (c) pilot shape: ONE partnered organizer pre-fills its registration form from an AwardHome profile via consent link — validates demand with zero new infrastructure.

**Technical sketch (module):** `id_grants` (dancer_id, grantee_org_id, scope JSON, granted_by_user_id, expires_at, revoked_at) + organizer API tokens (reuse claim-token/HMAC patterns from `utils/invites.js`); `GET /api/id/:unique_id/profile` returns only granted fields; audit log per pull. Registration-profile fields (DOB, guardian contact, waivers) added to claimed dancer accounts as opt-in "registration wallet" — never scraped, never public.

## 9. Studio-Aggregated Acknowledgements on Group Cards (brainstormed 2026-08-27)
**Concept:** extend the "yearbook back" to a third viewing context. Today a group award's ack page composes per *dancer* (own line pinned first). On the *studio's* rendering of the same group card, the ack page aggregates every teammate's approved line — the team plaque / gratitude wall — turning per-viewer pinning into a general **composition policy keyed by viewing-context type**: participant → pin own line; affiliated studio → full roster aggregate; neutral/public → alphabetical. Optional adjacent extension: a **director's note** — the claimed studio owner authors one line ("So proud of this team — Miss Amy") rendered as the aggregated page's header (needs `author_role`/nullable `dancer_id` on `award_acknowledgements` or a sibling table; same moderation queue; owner-only privilege that enhances, never gates).

**Value Proposition:** completes the metaphor (dancer card = personal yearbook page, studio card = team plaque) and creates a studio-side engagement loop: a dashboard nudge ("8 of 12 dancers have added their line") makes studio owners the distribution channel pushing families to fill cards — a claiming carrot that costs nothing.

**Reality check:** zero schema change for the aggregate itself (all lines already live per (award, dancer)); the real lift is that studio pages don't render flipbook cards at all yet — the feature rides on bringing the card partial to studio group-award surfaces. **Space (decided 2026-08-27): the multi-face cycle solves it structurally — each ack gets its own face, the viewer flips through the roster one inscription at a time, cycle length grows with the roster.** No scrolling inside pages (would break the cards-scale-like-images property). **Ordering (decided): chronological by creation time** — the plaque accretes as inscriptions arrive. Privacy: no new content (every line already shows on all members' public cards, post-moderation), only concentration; moderation gates unchanged. Sequence after flipbook beta AND after P1 provisional filing (freeze list) — spec coverage 2026-08-27 (¶[0018a], claims 19–21).

## 10. News / Community Stories — contribution & sponsorship phases (brainstormed 2026-08-27)
**Shipped (phase 1):** public /news, founder-authored, articles as git-versioned EJS
partials + registry in routes/news.js (publish = commit + deploy; no CMS until
contributors are real). Seeded with the origin story + the Sept 15 launch announcement.

**Phase 2 (post-launch, drawer):** community stories — parents/studios/organizers
contribute (studio anniversaries, comeback stories, teacher tributes). Needs: submission
flow (reuse partner_inquiries pattern or email), editorial review (all-minors rules:
guardian consent for named minors, same moderation spirit as card content), a
news_posts table + tiny admin CRUD once volume justifies it.

**Phase 3 (revenue, drawer):** sponsored articles — FTC-compliant "Sponsored" labeling
mandatory, same dignity principles as docs/partner_pitch.md (credit lines not ads,
nothing that reads as exploiting kids' moments), editorial standards doc BEFORE the
first sold post. Not mentioned publicly until real (same lesson as the partner page).

## 11. Teacher & Choreographer Accounts (brainstormed 2026-08-28, post-launch)
**Concept:** a third constituency: teachers/choreographers get claimable profiles;
dancers (or studio directors) link them to award cards — "Choreography: Marina
Petrova" as a structured credit, not just a thank-you-note mention. A teacher's
profile becomes a career portfolio: every routine they taught/choreographed and
what it won, across studios and seasons — a resume for guest-teaching,
convention faculty, and adjudication gigs.

**Why it's strong:** (a) teachers share too — every credited card is reach into
their networks; (b) the data half-exists (ack notes name teachers; The Dance
Awards import carries choreographer names in notes); (c) completes the graph:
dancer ↔ studio ↔ organizer ↔ teacher; (d) teacher pride is a claim driver for
studios ("your staff's work, credited").

**Design guards (from the flagging/credit-dispute lessons):**
- Credits are ADDED by dancer/studio owner but display only after the teacher
  ACCEPTS (two-sided confirmation) — prevents false-credit griefing and
  choreography-attribution beefs; same moderation spirit as card content.
- Junction: award_credits(award_id, teacher_id, role 'teacher'|'choreographer',
  added_by, status pending/accepted/declined) — same-routine propagation applies.
- Teachers are usually adults → lighter consent path than dancers, but staff
  churn means credits outlive employment: credit binds to the PERSON, not the
  studio.
- IP note: structured per-role credits on cards = new annotation granularity
  beyond the filed spec's (award, participant) + (award, organization) — add to
  the follow-on provisional queue BEFORE building (provisional_patent_plan.md).

**Sequencing:** post-launch, behind a flag; needs studio staff roster UI first.

## 12. Class-mom delegated cast entry (brainstormed 2026-08-29)
Directors rarely know every group routine's lineup; a "class mom" does — often
including who missed which event and who subbed. Let the director email a
scoped link from a routine card: the recipient (no account needed) opens a
single-purpose page for THAT routine (optionally specific events), sees the
award context, enters/corrects the cast per event, and submits. Submissions are
staged as a revertible changeset the director approves/undoes in one click from
the group-dancers page (and Action History). Extends: per-event cast scoping
(shipped 2026-08-29), award_dancer_removals tombstones, provenance chips.
IP: maybe_patentable.md §A9 — file or waive BEFORE shipping.

## 13. Award as a memory book (brainstormed 2026-08-30)
Each award is a book: the card is the cover, and inside are pages you flip
through — performance photos, video of the routine, voice messages, thank-you
notes, congratulations from teammates, family, and teachers, and an
AI-generated celebration score composed from the award's own content (placement,
category, routine title, the notes themselves) in a chosen mood — triumphant,
tender, funny, nostalgic — that learns the family's taste over time. Generating
the music rather than using the routine's licensed track sidesteps song
licensing entirely. Extends the shipped flip-book back-stack from four fixed pages to an
open-ended, multi-contributor keepsake bound to a verified award. Natural
companions: A9's scoped invitation links (how you'd collect congratulations
without accounts), the existing moderation queue (every page approved before
public display), and studio-aggregated acks (ideas.md §9).
Before building: video storage/bandwidth, generated-audio cost/latency plus
the generator's commercial-use terms, a higher consent bar for video/voice of
minors, and — for the taste-learning — keep preferences as the ACCOUNT HOLDER's
declared choices, not inferred profiling of a child's behavior (COPPA).
IP: maybe_patentable.md §A10 — file or waive BEFORE shipping.

## 14. Owner emphasis -> platform classification signal (built 2026-08-30)
Studio owners privately mark what each award type is really worth at their
studio (Not notable / Normal / Notable / Headline). It never touches public
figures, it powers a private "Your Highlights" count, and — the reason anyone
bothers — it tells the AI summary writer what to lead with. Because inflation
buys nothing public and accuracy buys a better summary, the pooled marks are an
honest signal of what the field values, feeding canonical award classification
that we otherwise guess with keyword rules. IP: maybe_patentable.md §A11.

## 15. THE PIVOT: family memory space, mobile-first (decided in principle 2026-09-02)
Organizer outreach went quiet, and the read is that the top-down model —
partner with orgs, then reach families through them — has the incentives
backwards: orgs' scarce resource is attention, and we asked for it while
holding data we took from their sites. Invert it. AwardHome becomes a
**private-first awards-and-milestones memory space for students and
families**, mobile app first, web as marketing surface and backup. Not
dance-only: any student award or milestone. Dance is the beachhead because it
is where the archive lives.

**The magic moment — auto-discovery.** A family enters one award (event,
routine, studio, dancer name); the backend matches against the 1.5M-award
archive and answers with the child's entire competitive history: "we found 43
more from 2019–2026 — are these yours?" Yes/no, keep/hide, per award. No
competitor can copy this without the archive and the weekly pipeline that
keeps it current. Architecturally it turns our hardest data problem —
same-name identity resolution, adjudicated by hand for Zixi Yu — into a
user-facing question answered by the one person who actually knows.
Parent-adjudicated identity beats any auto-merge heuristic.

**The retention engine — the Monday scrape becomes push.** Awards are
episodic (4–8 weekends/year); memory apps die of infrequency. But every
weekly import that matches a claimed dancer is a push notification the family
did nothing to earn: "We found a new award for Emma from this weekend." The
pipeline built for data freshness doubles as the re-engagement loop.

**Privacy inversion.** Scraped data was published by the competition — it is
already public and stays so (and remains the SEO/acquisition funnel: a parent
googling their kid finds the trophy case, the trophy case sells the app).
Family-added content is private until the family chooses to share — which is
literally the shipped staging/canonical split. Private-first is also the
defensible posture for a product substantially about minors.

**Studios/clubs/schools become a second-order effect**: accounts created and
data aggregated from family activity, approached later holding engagement
evidence instead of a cold letter (the org_card_clicks instrument, one level
up). Strava/Slack shape: individual utility first, org accounts follow.

**Sequencing note:** M1–M9 already built most of this — family submission
staging, private independents, corroboration, offline outbox, claims, the app
itself. The pivot is ~70% positioning, ~30% code. Monetization moves from B2B
sponsorship to B2C family subscription (memory space, keepsakes — §13 becomes
a premium feature, not a side idea). Full plan: docs/pivot_plan.md.
