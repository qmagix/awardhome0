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
serious.*

### A4. Per-dancer acknowledgement lines on a shared group award ("yearbook back")
One physical group award, N dancers via `award_dancers`; each junction row carries that
dancer's own acknowledgement line. The card's ack page renders all teammates' lines
with the viewing dancer's pinned first — same award, different page per viewer context.
Moderation-gated (superadmin approval) because authors are often minors. *Captured
2026-08-12. Implemented 2026-08-12 (local commit, NOT yet deployed publicly).*

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

## Next steps (when we investigate)

1. Attorney triage: A1–A5 first; confirm whether server-side-only pipelines (A1, A2)
   are undisclosed for grace-period purposes.
2. Anything in Tier A we intend to ship (A3, A4 especially): consider a **provisional
   application before deploy** — cheap, preserves worldwide rights for 12 months.
3. Separately explore a **design patent** on the award-card appearance (front +
   certificate back) and the AwardHome trade dress.
4. Keep this file current: new brainstorm ideas get an entry with a capture date and
   shipped/not-shipped status at the time of capture.
