# Maybe Patentable — idea inventory for later IP review

Purpose: a running inventory of AwardHome ideas that *might* be protectable, so we can
later have a patent attorney triage a subset. Not legal advice. Two facts that make
dates matter:

- **US grace period**: a public disclosure (deploying a feature on the live site counts)
  starts a 1-year clock for filing in the US, and kills patentability in most other
  countries immediately. Features already live are US-only candidates at best.
- **Post-Alice reality**: pure UI/business-method claims are hard; claims tied to a
  concrete technical pipeline (data validation, identity resolution, staged promotion)
  age much better. Design patents / trade dress are the realistic route for the card's
  *look*.

Legend: **Public since** = already disclosed on the live site (clock running). Blank = not yet shipped/public — strongest position; consider a provisional *before* shipping.

---

## Tier A — most promising (technical pipeline or genuinely unusual mechanism)

### A1. Staged self-validating import with per-org historical-delta scoring
Weekly pipeline snapshots the live DB, runs the full scrape/import against a staging
copy (`DB_PATH` swap), then `validate_import.js` scores the delta **against each org's
own historical import pattern** (not a global threshold). Green auto-promotes via
deterministic cache replay against live; amber/red holds with a review report + email.
Claim shape: anomaly-gated autonomous promotion of third-party-scraped data using
per-source historical baselines. *Captured 2026-08-12. Public since: pipeline runs in
prod (~2026-08) but internals aren't visible publicly — attorney should assess whether
server-side-only processes count as disclosure (generally no).*

### A2. Cross-competition identity resolution for a unified trophy case
Aggregating ~900k awards from 14+ competitions into per-dancer profiles: name+studio
matching (never name alone), junction-table group-award mapping, pseudo-studio
collaboration rows, overflow-name reconstruction on messy sources. The *specific
matching/repair method* is the claimable part, not the idea of aggregation.
*Captured 2026-08-12. Live since ~2026-05 (method server-side).*

### A3. Multi-page "flip-book" award card with audience-sequenced reveal (NEW — not shipped)
Award card as a paged object: front = award; flip reveals a swipeable back-stack —
certificate ("Presented to…") → dancer photo → acknowledgements → organizer colophon —
where pages are **conditionally materialized** (absent content = page doesn't exist)
and each page is independently shareable as an image. Combination claim: flip-then-page
interaction + role-gated page content (owner-uploaded photo, per-dancer acks,
organizer-purchased colophon) + per-page share rendering. Additional wrinkle
(2026-08-13): **in-artifact WYSIWYG editing** — the owner's editor renders the same
card object with the gated pages materialized as inline-editable placeholders,
edit-mode-only (public render never materializes empty pages); one editing surface
= the display artifact. *Captured 2026-08-12. Implemented 2026-08-12/13 (local
commits, NOT yet deployed publicly) — file provisional before deploying if we're
serious.* **Variant added 2026-08-27 (NOT built):** multi-face continuous-flip
presentation — each flip advances to the next materialized face of a virtual
multi-faced solid with wrap-around and per-transition rotation-axis variation;
same conditional-materialization page set, presentation mode as a design-registry
parameter. Covered in `provisional_draft_P1_P3.txt` ¶[0014a], claims 16–18, FIG. 13.

### A4. Per-dancer acknowledgement lines on a shared group award ("yearbook back")
One physical group award, N dancers via `award_dancers`; each junction row carries that
dancer's own acknowledgement line. The card's ack page renders all teammates' lines
with the viewing dancer's pinned first — same award, different page per viewer context.
Moderation-gated (superadmin approval) because authors are often minors. *Captured
2026-08-12. Implemented 2026-08-12 (local commit, NOT yet deployed publicly).*
**Extension 2026-08-27 (NOT built):** composition policy keyed to viewing-context
TYPE — participant context pins own line; the STUDIO's rendering of the same group
card aggregates the full roster (team-plaque view, paginating across back-stack
pages); optional organization-authored "director's note" as aggregate header (new
(award, organization) annotation granularity). Covered in `provisional_draft_P1_P3.txt`
¶[0018a], claims 19–20; product sketch in ideas.md §9.

### A5. Concierge-gated organizer logo "coin" on user-generated share media
Third-party brand marks appear on shareable award cards only after a platform operator
hand-fits the mark into a fixed circular silhouette (position/rotation superadmin-only;
size/opacity owner-adjustable) and flips an approval bit; default OFF. Keeps mixed-org
grids to one silhouette and makes brand presence a sold concierge service.
*Captured 2026-08-12. **Public since ~2026-08** (live) — US clock likely running.*

### A6. Auto-generated social video shorts from moderated card faces (NEW — not built)
Deterministic generation of a vertical short-form video by sequencing a card's existing
faces (award → certificate → photo → acknowledgements → organizer colophon) with flip
animations and audio cues. The claimable combination: every video frame source is a
**pre-moderated composition** (each face independently approval-gated), so an automated
pipeline can render publish-safe video without human review of the video itself;
organizer branding (colophon) as the enforced end-card; per-dancer personalization of
the same group award's video via the viewer-pinned ack page. Pairs with A3/A4 as a
system claim. *Captured 2026-08-12. NOT built — strongest position if filed before
shipping.*

### A7. Sponsored surprise-reveal page inside a flip-card award artifact (NEW — not built)
A probabilistic "golden ticket" page that occasionally appears in a flip-book award
card's page stack: server-side prize roll bound to the flip interaction on a specific
verified award, drawing from organizer/sponsor-funded pools scoped to the award's own
competition history (e.g. free entry to the org whose event produced the award). The
claimable combination: variable-reward mechanics embedded in a **verified achievement
artifact** rather than a generic app surface; prize eligibility derived from the
award's provenance (org/event linkage); guardian-routed redemption for minors; roll
server-side + rate-seeded per user so repeated flipping cannot farm outcomes. Pairs
with A3 as a system claim. *Captured 2026-08-19. NOT built — sweepstakes/minors legal
review required before any launch; strongest IP position if filed before shipping.*

### A8. Guardian-mediated selective-disclosure registration identity ("DancerID")
Lifetime portable dancer ID (`dancers.unique_id`) + consent grants: a guardian scopes
which profile fields (DOB, contacts, waivers, competitive history) a specific organizer
may pull, until an expiry, revocable, fully audited; organizer access via token API.
The claimable combination: guardian-mediated field-level disclosure scoping for a
minor's identity, tied to a *verifiable competitive-history record* (division/level
anti-sandbagging proof no generic ID provider holds). Likely the strongest §101
survivor in the inventory (consent/auth protocol mechanics). *Captured 2026-08-27.
NOT built — paper design first, then provisional (see plan P3).*

### A9. Scoped delegated cast-entry via emailed capability link ("class-mom flow") (SHIPPED 2026-08-30 — PUBLIC DISCLOSURE DATE)
**Q consciously shipped without filing (decision 2026-08-30).** US grace
period: any US provisional/non-provisional covering A9 must be filed by
**2027-08-30**. Foreign (absolute-novelty) rights: largely forfeited as of
disclosure. If A9 matter goes into the P2 filing, note this disclosure date
in the application record.
Studio director emails a single-use link that authorizes a NON-ACCOUNT-HOLDER to
edit exactly one group routine's cast — optionally per event (the per-event cast
scoping shipped 2026-08-29 gives the substrate: casts differ by event via subs/
absences, and the delegate is often the only person who remembers which). The
capability is the token: scope = (studio, routine, year[, events]), expiry,
revocable, no account creation; every delegate submission lands as a REVERTIBLE
staged changeset (provenance source='delegate', batch id) that the director
reviews/undoes as a unit, with tombstones honored. Novelty angle: fine-grained,
record-scoped, delegable write-capability over a shared public artifact with
staged provenance-tracked revertible edits — contrast with page-level share
links (Google Docs) and role-based CMS grants; combines capability-URL + field/
row-scope + moderation-queue changeset. Prior art risk: capability URLs are
old (Waymo-style signed links, Doodle, Google Forms); the row-scoped +
event-scoped + revertible-changeset combination on a competition-results graph
is the claimable surface. Do NOT ship before this is filed or consciously
waived (new matter vs 64/142,611).

### A10. Award-as-memory-book: heterogeneous, multi-contributor media pages (NEW — not built, captured 2026-08-30)
Q's framing: **each award IS a book.** The award card is the cover; inside is an
open-ended, page-by-page set of memory pages — performance photos, VIDEO of the
routine, an AI-GENERATED celebration score composed from the award's own
content, VOICE messages, thank-you notes, and congratulations from teammates,
family, teachers, and the wider community.
Extends A3 from a fixed 4-page back-stack (certificate → photo → acks →
colophon) to an unbounded, media-typed book whose pages come from MULTIPLE
contributors, not just the owner.

**Likely covered by 64/142,611** (filed 2026-08-27): the paged/flip mechanics,
conditional page materialization (absent content = no page), per-page share
rendering, role-gated content, multi-face continuous flip (claims 16–18).
**Likely NEW MATTER — the claimable delta:**
- **Time-based media inside the artifact**: video and audio pages (routine
  video, the generated score, spoken voice messages) in a paged award
  object — playback state vs. page-turn/flip state is a real mechanism
  question (autoplay on page arrival, pause on flip-away, per-page seek
  position preserved across turns, audio continuing under a page turn as a
  "soundtrack" for the whole book).
- **Multi-contributor page sourcing with per-page provenance + moderation**:
  congratulations solicited from many people (teammates, family, coaches,
  spectators) each becoming its own page, with contributor identity,
  invitation/capability scoping (cf. A9's delegated entry), and per-page
  approval before public display — i.e., a crowd-composed keepsake bound to a
  verified competition record.
- **Generative celebration score conditioned on the achievement record**
  (Q's clarification 2026-08-30 — explicitly NOT the routine's licensed track):
  audio synthesized from the book's own structured content — placement and
  award tier, category/age division, routine title, organization, the sentiment
  of thank-you notes and congratulations, photo/ack counts, even a season's arc
  across several awards — parameterized by celebration MOOD (triumphant,
  tender, funny, nostalgic) and adapted to the learned preferences of the owner
  and returning viewers. Claimable mechanism: the mapping pipeline (verified
  award metadata + moderated page content → generation parameters → score)
  bound to the paged artifact, with mood/preference feedback that re-renders
  the score for the same award. Sidesteps third-party music licensing
  entirely — a commercial advantage, not merely a legal one.
- **Page-type registry / heterogeneous page grammar**: pages of different media
  types composing one flippable artifact with type-specific rendering, sizing
  (the cqw system), and share behavior.

**Prior art to expect:** digital photo books / flipbook viewers (Issuu, Blurb),
memory-book and tribute-page products (ForeverMissed, Kudoboard, Tribute),
video-message compilations (VidDay, Tribute.co), yearbook signing apps.
Kudoboard/Tribute in particular are close on "many people contribute
congratulations to one page." For the generated score: Suno/Udio/MusicGen/AIVA
(parameter- or text-conditioned music generation) and — closest — Apple Photos
"Memories" and Google Photos, which auto-assemble montages with mood-matched
soundtracks; those SELECT from licensed catalogs rather than GENERATE from the
record's own data, which is the distinction to press." **The defensible combination is the binding to a
VERIFIED, imported competition award** — the book is the back of an
authenticated achievement record, with moderation and role gating — not a
free-standing greeting artifact.

**Build cautions (not IP):**
- **Generated-audio caveats** (the routine's own licensed track stays OUT —
  that would be copyright exposure, not a feature): check the generator's
  commercial-use and output-ownership terms; label AI-generated audio as such
  (consumer trust + FTC disclosure norms); budget cost/latency and cache per
  award rather than per view; keep generated output inside the same moderation
  gate as photos and acks.
- **Video costs**: storage/bandwidth/transcoding dwarf photos; needs a plan
  before it ships (and Litestream/S3 backup implications).
- **Child-safety surface**: video + voice of minors raises the consent bar
  above the existing photo-consent checkbox; COPPA review with counsel.
- **Preference learning on minors is its own COPPA question**: behavioral
  profiling of children to personalize output is a sensitive category. Safer
  design — learn from the ACCOUNT HOLDER's explicit choices (a parent or studio
  picking a mood, thumbs-up on a rendered score) stored as declared settings,
  never from a child's inferred interaction stream.

**Action:** bundle into the P2/follow-on provisional (with A9) rather than a
standalone filing — it is an embodiment cluster on the same artifact family as
64/142,611. Per the queue rule, file or consciously waive BEFORE shipping.

### A11. Incentive-compatible private weighting that yields a public classification signal (DEPLOYED 2026-08-30 — PUBLIC DISCLOSURE DATE)
**Disclosed 2026-08-30 by the push+deploy of commit `a0b8f44`, without a
pre-filing decision having been made.** The item was flagged "file or
consciously waive before deploying" and that gate was not closed first — the
deploy carried it. Two independent disclosures happened in the same push:
the running feature at awardhome.com, and this file's own description of the
claimable shape (the repo `qmagix/awardhome0` is **PUBLIC**). US grace period:
any US filing covering A11 must be made by **2027-08-30**. Foreign
(absolute-novelty) rights: largely forfeited as of that date. Same posture Q
accepted deliberately for [A9] — the difference is that this one was not a
decision, so it is worth deciding now whether A11 goes into the P2 filing
before the deadline rather than by default.

⚠ **Standing hazard this exposed:** `maybe_patentable.md` lives in a PUBLIC
repo, so every entry in it is published the moment it is pushed — this file
is a disclosure channel, not a private drawer. Anything intended to stay
unpublished until filing must not be committed here.

Q's design. Each studio owner privately weights the award types in their own
history (Not notable / Normal / Notable / Headline). Three properties make the
combination interesting:
1. **The weighting cannot move any public number.** The public "Major Awards"
   figure stays the platform-wide rule (utils/majorAward.js); weights drive
   only a private "Your Highlights" count.
2. **The owner gets real private value** — the weighting steers the
   AI-generated award summary (what to lead with, what to skip), which is the
   visible payoff that makes the effort worthwhile.
3. **Therefore the aggregate is credible.** Because inflating weights buys no
   public advantage, and accuracy buys a better generated narrative, the
   pooled weights across studios are a *truthful* crowd signal of what the
   field considers prestigious — fed back into canonical classification
   (docs/org_top_awards.md, admin award vocab) that the platform previously
   had to guess with keyword heuristics.
Claimable shape: eliciting domain expertise via a per-tenant private
control whose payoff is generative-output steering rather than public score
adjustment, and aggregating those elicitations into a canonical classification
for a shared verified-record corpus — i.e., an incentive-compatible labelling
loop embedded in a product feature, not a survey.
**Prior art to expect:** collaborative filtering / preference elicitation,
crowdsourced labelling (reCAPTCHA-style dual-purpose work), personalization
weights in recommenders, RLHF-ish preference collection. The distinguishing
combination is the *separation* — private weighting + fixed public statistic +
generative-steering payoff + aggregation into canonical classification of a
verified achievement corpus — which is what removes the incentive to lie that
plagues ordinary crowd rating.
**Caution:** the value depends on keeping the public figure genuinely
unmovable; if weights ever leak into public numbers, the aggregate stops being
credible AND the integrity promise breaks. Keep that boundary in code and in
the UI copy.

## Tier B — plausible but weaker (business method or heavy prior art risk)

### B1. Dark-launch claiming via private single-use tokens (no public unclaimed state)
Org pages never show a claim button (an unclaimed state would advertise non-partners);
claiming happens only through emailed single-use 30-day HMAC tokens. Anti-signal
design as a mechanism. *Captured 2026-08-12. Public-facing absence is live; token
mechanics server-side.*

### B2. Photo consent/approval workflow for minors on shareable award media
Upload by studio/dancer owner → guardian-consent capture → approval gate → only then
renderable on share images. Process claim; COPPA-adjacent compliance workflow.
*Captured 2026-08-12. NOT built.*

### B3. AI marketing summaries constrained to platform-verified award data (ideas.md #1)
LLM "brag sheet" generation where the input corpus is restricted to verified awards
(provenance chain: scrape log → validated import → verified flag). The verification
tether is the only novel hook; "LLM writes marketing copy" alone is unpatentable.
*Captured pre-2026-08 in ideas.md. NOT built.*

### B4. Sponsor attribution that travels with shared award media (trophy_plan.md Tier 2/3)
**⚠️ NOT in filed provisional 64/142,611** (checked 2026-08-27: spec teaches the
ORGANIZER colophon only; generic claims 1/4 give arguable-but-weak cover). The
"sponsor credit page" ("made possible by X") is item 1 on the follow-on queue in
provisional_patent_plan.md — file before shipping any sponsor-page feature.
"1st Place Solo sponsored by Capezio" baked into the card and persisting through
social-share image rendering, with organizer-tier gating. Advertising method — weak
alone; possibly claimable as part of the A3 page system (colophon page).
*Captured pre-2026-08. NOT built.*

### B5. Share-image generation with re-acquisition overlay (phone_app_design.md)
Off-screen render of a card to an image with QR/sticker overlay driving app installs.
Heavy prior art (Spotify Wrapped et al.). Keep only as dependent claim material.
*NOT built.*

## Tier C — capture for completeness; likely unpatentable (prior art / pure technique)

- **C1. Container-query `cqw` card design system** — cards scale like images because all
  internal sizes are container-relative. Standard web tech; protect the *visual design*
  via design patent / trade dress instead. *Live.*
- **C2. Superadmin dynamic AI model switcher** (ideas.md #2) — runtime LLM model
  selection from an admin panel. Abundant prior art. *NOT built.*
- **C3. Stale-while-revalidate in-process cache** — textbook technique. *Live.*
- **C4. Featured-studio auto-rotation** (verified-action weighting + decay + tenure/
  cooldown, leaderboards stay unpaid) — ranking formulas are hard to protect; the
  "featured is earned, never sold" policy is marketing, not IP. *Live.*

---

## Next steps

**✅ FILED 2026-08-27: U.S. Provisional No. 64/142,611** covers A3, A4 (+studio-aggregate
extension), A5, A6, A7, A8 and B2/B4/B5 as embodiments (spec ¶ map in
`provisional_draft_P1_P3.txt`). Conversion/PCT deadline 2027-08-27. A1/A2 (P2)
still unfiled. Post-filing features need follow-on provisionals to be covered.

**Filing strategy now lives in `provisional_patent_plan.md` (2026-08-27):** three
provisionals — P1 omnibus card-artifact system (A3–A7 + B2/B4/B5, urgent: `?card_design=`
preview is publicly reachable on prod), P2 staged-import pipeline (A1, A2 as embodiment
text; trade-secret fork at month 10), P3 DancerID (A8, after paper-design pass). Design
patent + trade dress tracked there too. Pre-filing freeze list in plan §2.

Keep this file current: new brainstorm ideas get an entry with a capture date and
shipped/not-shipped status at the time of capture; status changes update the plan's
disclosure audit — the dates are the whole game.
