# Pivot Plan: AwardHome as a Family Memory Space

*Drafted 2026-09-02, following the decision in ideas.md §15. Companion to
`docs/mobile_app_development_plan.md` (M1–M9, all shipped), which this plan
extends rather than replaces.*

## 1. What changes and what doesn't

**The product becomes:** a private-first awards-and-milestones memory space
for students and families. Mobile app first; the web is the marketing surface
(public archive → SEO → app install) and a backup client. Dance is the
beachhead vertical, not the boundary.

**The strategy becomes bottom-up:** families get value alone on day one;
studio/club/school accounts emerge from aggregated family activity; organizers
are approached later, holding engagement evidence instead of a cold letter.

| | Old model | New model |
|---|---|---|
| First mover | Organizations (invite letters) | Families (app install) |
| Default visibility | Public pages, publish-by-default | Private memory space, share-by-choice |
| Scope | Dance competition awards | Any student award or milestone |
| Revenue | B2B: sponsor tiers, gold buttons, logo coins | B2C: family subscription + keepsakes |
| The archive's job | The product itself | Discovery engine + acquisition funnel |
| Weekly scrape's job | Data freshness | Retention engine (match → push) |

**What survives untouched:** the staging/canonical split (it IS the privacy
model), promotion rules, convergence/corroboration, the offline outbox, claims,
tokens/auth, the card design system, evidence handling, the weekly pipeline,
the patent (64/142,611 — the card system is now a premium keepsake surface).
The org-partnership features (logo coins, gold buttons, branding console) stay
built but stop being the point; they re-enter at P6.

**The two honest limits, stated up front:**
- Auto-discovery only fires where the archive has data: 14 dance orgs.
  Elsewhere the app is a well-made manual memory space until other verticals
  are scraped or partnered. Marketing must not promise discovery outside dance.
- Awards are episodic. Retention rests on the Monday-scrape push loop (P3)
  and on milestones broadening the entry stream (P2) — watch both like a hawk
  in beta metrics.

## 2. Positioning

One sentence: **"Every award your kid ever earned, in one place, forever —
and we probably already found most of them."**

- The app: private by default, "share when you choose", family-owned.
- The web: the public archive stays public (competition-published results,
  already public speech, our SEO surface). Public dancer pages grow one new
  job: an "Is this your dancer?" → app-store handoff. The claim flow already
  exists; the CTA becomes app-first.
- The name survives the pivot: AwardHome was always the home for awards, not
  "DanceAwardHome".
- Launch date: the Sept 15 public launch (old positioning) is OFF. Beta
  continues under the gate; the pivot launches when P1–P3 are real.

## 3. Milestones

### P1 — Discovery: the match-and-claim flow (the magic moment)
The single flow the pivot lives or dies on. A family enters ONE award; the
backend searches the archive (name + studio + routine + event, the convergence
normalisers reused) and returns candidate matches grouped by dancer profile:
"We found 43 awards for Emma Chen at Star Dance Academy, 2019–2026. Are these
hers?" Per-award and bulk keep/hide; "not mine" writes a rejection that
suppresses re-offering (reuse the tombstone pattern, new table —
`discovery_rejections`).

- Matching is OFFER-only. Nothing merges, nothing publishes; accepted awards
  link via the existing claim machinery (`award_dancers` status, provenance).
  A wrong "yes" is undoable (hide); a wrong auto-merge would not be. This is
  the Zixi Yu lesson as product design: the parent adjudicates identity.
- Same-name candidates surface as separate groups with routine/studio/year
  context (the disambiguation aids built for directors, re-aimed at parents).
- Serve from the mobile API (`/api/v1/mobile/discovery/search`), guest-capable
  for the preview, account required to claim — the preview is the top of the
  funnel and must be frictionless.
- Success metric: % of new accounts that accept ≥5 discovered awards in the
  first session.

### P2 — The milestone model (beyond competition awards)
`milestones` as a first-class staged type alongside award submissions: recital
roles, exams/levels (RAD, ABRSM...), team selections, academic honors, "first
en pointe" — typed but with a free-form fallback, photo/video/note attachments
riding the existing evidence pipeline. Private by default like everything
family-entered; no canonical promotion path at all initially (nothing to
corroborate against — they are family memories, not published results).
- Deliberately thin v1: type, title, date, people, attachments, story text.
  The card system renders them (new card class, same cqw grammar).
- No rankings, no leaderboards, no public surfaces. Memory first.

### P3 — The retention loop (scrape → match → push)
End of every weekly import: run discovery matching for claimed dancers over
the import delta; queue "We found a new award for Emma" pushes (extend
`utils/push.js` beyond decisions-and-questions — this is the third push class,
and the only marketing-shaped one, so it gets its own opt-out).
- Also: "one year ago today" memory resurfacing from the family's own content.
  Cheap, expected in this category, and it exercises the archive.
- Success metric: push → app-open rate; weekly active families during
  competition season vs. off-season.

### P4 — Privacy defaults flipped app-wide
Family-added content: private → household → shared-link → public, in that
order, defaulting to private. Audit every surface that renders family content
against the ladder (the sweep script pattern extends to this). Scraped
canonical data is unaffected — it was published by the competition and remains
public; the two provenances render with distinct affordances (a found award
can be hidden from your space; a family award can be deleted outright).
COPPA posture documented in one place; the §13 rule (preferences are the
account holder's declared choices, never inferred child profiling) becomes
policy for the whole app.

### P5 — Web repositioned as funnel
Homepage leads with the app and the discovery promise; rankings/leaderboards
demote to an "archive" section (they still earn SEO). Public dancer pages get
the app handoff CTA. The beta gate lifts THEN — the web's new job is to be
found. `/dance` keeps working forever: bookmarks, embeds, org demo links.

### P6 — Studios, clubs, schools as second-order accounts
When ≥N families at one studio are active, the studio surface lights up:
claim flows already exist, reviewer inbox already exists. New: a
"your families are here" outreach email driven by real aggregated activity
(suppression-list rules apply). Organizer partnership re-enters here too —
same letters, but now carrying engagement numbers. Nothing in P1–P5 blocks
on this.

### P7 — Monetization (B2C)
Free: the memory space, discovery, reasonable media limits. Premium
(family subscription): §13 memory books (video pages, generated celebration
scores, multi-contributor keepsakes), print/export, expanded storage,
multi-child households at scale. The card system patent is the premium
surface's moat. Price nothing before P3 retention data exists.

## 4. Build notes

- **Storage decision comes due at P2**, not later: milestones carry video.
  The S3-vs-R2 decision (mobile plan §9.5) should be made before P2 ships,
  and malware scanning wired before any shared-link visibility exists.
- **Discovery search needs an index**: name-folded dancer lookup across 1.5M
  awards must return in interactive time; plan a denormalised search table
  built by the weekly import (the archive_metrics pattern).
- **Flags:** `family_submissions` releases with P1 (the reviewer inbox exists;
  independents curate privately — both shipped). New flags: `discovery`,
  `milestones`, `push_marketing`.
- **The mobile app is the primary client**: every P1–P4 feature lands in the
  API + app first; web forms follow only where they earn their keep as backup.
- **Gate discipline unchanged**: `npm run gate` before every deploy; the
  adversarial sweep grows cases for milestone/discovery data states.

## 5. Open questions

1. Household model: one account per family today; do grandparents get
   read-only membership (P2) or shared-link only? Leaning shared-link first.
2. Multi-sport discovery: scrape next vertical (gymnastics? cheer? both have
   published results culture) vs. partner-first? Decide after P3 metrics.
3. What happens to `is_self_added` web-entered awards from the old model —
   migrate into the staging model or leave as canonical? (Small N; audit
   first.)
4. Does the demo org (Peacock Cup) survive the web repositioning? Probably
   yes — P6 still needs the pitch surface.
