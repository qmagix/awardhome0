# Provisional Patent Plan — filing strategy for AwardHome IP

> ## ✅ FILED — U.S. Provisional Application No. 64/142,611
> **Filed 2026-08-27 (confirm official ET date on the electronic filing receipt) (P1+P3 combined: spec w/ claims 1-21, FIGS. 1-14, SUPP. FIGS. A-G).**
> - **Conversion/PCT deadline: 2027-08-27** (non-extendable — non-provisional and/or PCT
>   claiming priority must be filed by this date; A5's independent US grace bar also
>   rides inside this window).
> - **Month-10 checkpoint: 2027-06-27** — decide convert / PCT / refile / abandon
>   (P2 trade-secret fork decision at the same checkpoint if P2 filed by then).
> - **New features shipped after the filing date are NOT covered** — anything beyond what the
>   spec enables needs a follow-on provisional (daisy-chain; a later non-provisional can
>   claim all provisionals from its trailing 12 months).
> - **Freeze list (§2) is LIFTED**: flip-book rollout, demos, and outreach may proceed;
>   "Patent Pending" may be used in marketing and org-invite letters.
> - P2 (staged-import pipeline) remains unfiled — see schedule below.

*Drafted 2026-08-27 from `maybe_patentable.md` inventory + codebase disclosure audit.
Working proposal to hand a patent attorney — NOT legal advice. Confidential: keep out
of public repos, outreach emails, and demos until filings land.*

---

## 1. Executive recommendation

> **Decision update (2026-08-27):** P1 and P3 are being filed as ONE combined
> provisional — the DancerID design matured enough during drafting (grant schema,
> pull API, audit/revocation, FIGS. 10-12) to satisfy the "paper design first"
> condition, and a provisional has no unity requirement, so combining costs nothing
> and locks both priority dates at once. Draft: `provisional_draft_P1_P3.txt`
> (spec + 21 sample claims) + `patent_figures_P1_P3.html` (FIGS. 1-14) +
> `patent_screenshots/` (SUPP. FIGS. A-G). P2 remains a separate future filing
> per the schedule below.

File **two provisional applications now**, hold a third until its design matures:

| Filing | Covers | Why now | Foreign rights |
|---|---|---|---|
| **P1 — "Moderated multi-page achievement artifact"** (omnibus) | A3 + A4 + A5 + A6 + A7 + B2 + B4 + B5 | Flip-book is implemented and *partially reachable on prod* (see §2) — every day of exposure weakens the position; outreach demos are imminent | Mostly intact **if filed before wider rollout**; A5-alone already US-only |
| **P2 — "Self-validating staged import with per-source baselining"** | A1 (+ A2 as supporting embodiment) | Server-side only, undisclosed → strongest posture; cheap to lock a date while the pipeline is actively evolving | Fully intact |
| **P3 (hold ~60–90 days) — "Guardian-mediated selective-disclosure identity"** | DancerID (ideas §8 / new A8) | Paper design only; a provisional filed on a thin sketch protects only the sketch. Flesh out the consent/token design first, then file — still well before any build | Fully intact |

Rationale for bundling rather than one-per-idea: a provisional is unexamined, has no
claim requirements, and costs the same regardless of breadth (micro-entity ≈ $65–130;
verify the current USPTO fee schedule). Its only job is to lock a priority date for
everything *enabled* in its text. At the 12-month mark you carve one or several
non-provisionals out of each omnibus. A3–A7 are one inventive ecosystem around a single
artifact (the card) — bundling them also lets you claim the *system* combinations
(flip-book + moderation gates + video + prize reveal), which are stronger post-Alice
than any piece alone.

Do **not** file on Tier C items, B1 (anti-signal claiming — pure business method), or
B3 (LLM-with-provenance-tether — file only if it ever becomes a build priority; the
tether alone won't carry §101).

---

## 2. Disclosure audit (as of 2026-08-27) — what the clock says

Dates control everything: US grace period = 12 months from first public disclosure;
most foreign rights die at first disclosure.

> **Correction (2026-08-27, per inventor):** although the site is online, no studio or
> organizer invitations have been sent and, to the inventor's knowledge, no material
> third party has viewed the beta-gated site — only the inventor and dev team. This
> substantially strengthens the "no enabling public disclosure yet" position for ALL
> items below (including A5), and likely preserves foreign rights across the board.
> The table's conservative readings stand as the attorney's worst case; the freeze
> list still applies until filings land. Draft spec: `provisional_draft_P1_P3.txt`.

| Item | Status | Assessment |
|---|---|---|
| A5 logo coin | Live on prod ~2026-08 | US clock running (file by ~2027-08); foreign rights for A5-alone claims presumed lost. Still claimable abroad *in combination* with unshipped elements (new combination = new disclosure analysis). |
| A3/A4 flip-book + acks | Code deployed; `thank_you_notes` / `award_photos` flags ship **dark** on prod | ⚠️ **`?card_design=flipbook` is an open session preview for ANY visitor** (`utils/cardDesign.js` — deliberate, per its header comment). With flags dark the photo/ack pages don't materialize, but the paged back-stack interaction and conditional-materialization behavior are observable. Mitigation: prod still runs the site-wide beta gate (`BETA_MODE`) — if the beta key went only to invited studios, an attorney can likely characterize this as limited, non-enabling access, but the key was distributed without NDAs. **Treat A3/A4 as "clock possibly started ~2026-08"** — i.e., file P1 urgently and let the attorney argue it never started, rather than the reverse. |
| A1/A2 pipeline | Running in prod since ~2026-08 / ~2026-05 | Server-side processes whose internals are not observable from output = generally **not** a disclosure ("secret use" by the inventor also doesn't bar US filing; attorney to confirm). Foreign rights intact. |
| A6 video, A7 prize reveal, B2 photo-consent | Not built | Clean. File before building. |
| DancerID (A8) | Concept only (2026-08-27) | Clean. |

### Pre-filing freeze list (do these until P1 is filed)
1. **Do not flip `thank_you_notes` / `award_photos` to `beta` or `on` on prod.**
2. **Consider gating the `?card_design=` preview behind admin/`early_access` on prod**
   — product call (it may be in active outreach use), but every anonymous preview
   deepens the disclosure argument.
3. No demo videos, screenshots, or descriptions of the flip-book/acks/video/prize
   mechanics in outreach emails, org video scripts, or public docs. If a partner demo
   is unavoidable, use a one-page mutual NDA first.
4. Repo stays private (it is); `maybe_patentable.md` and this file never ship in any
   public artifact.

---

## 3. P1 — Moderated multi-page achievement artifact (the crown jewel)

**Working title:** *"System and method for rendering, moderating, and derivatively
publishing a multi-page verified-achievement artifact."*

**The inventive spine** (what an examiner would have to find prior art for *in
combination*):

1. An achievement record imported from a third-party source (with provenance) is
   rendered as a card object: front face + flip + a **back-stack of pages that are
   conditionally materialized** — a page exists only when its content item has passed
   an approval gate (`award_acknowledgements` / photo moderation states). Absent
   content = absent page, so the artifact is *always publish-complete by construction*.
2. **Per-viewer composition of a shared artifact**: one group award, N junction rows,
   each carrying that dancer's acknowledgement line; the ack page reorders per viewing
   context (viewer's line pinned). Same artifact, different lawful rendering per viewer.
3. **Single-surface WYSIWYG**: the owner's editor renders the same card object with
   gated pages materialized as inline-editable placeholders (edit-mode-only); the
   display artifact *is* the editing surface.
4. **Role-partitioned brand-mark fitting** (A5): third-party mark enters a fixed
   circular silhouette; position/rotation are operator-only controls, size/opacity are
   owner controls, public display bit is operator-only, default OFF.
5. **Derivative publication without human review of the derivative** (A6): a video/
   share-image generator whose every frame source is an already-moderated page
   composition, so the pipeline is publish-safe by construction; org colophon as
   enforced end-card; per-viewer video variants from (2).
6. **Provenance-scoped variable reward** (A7): a server-side prize roll bound to the
   flip interaction on a *verified* award; eligibility derived from the award's own
   org/event provenance; guardian-routed redemption; rate-seeded rolls so repeat
   flipping can't farm outcomes.
7. Guardian consent + moderation workflow for minor-generated content feeding (1)–(6)
   (B2), and sponsor attribution that persists through share rendering (B4/B5) as
   dependent material.

**Sample independent claim skeletons** (for the attorney to refine — a provisional
needs none, but writing them disciplines the spec):

- *System:* "A system comprising: a datastore associating an imported achievement
  record with one or more member identities via junction records, each junction record
  storing member-specific annotation content having a moderation state; and a rendering
  engine configured to render the record as an artifact having a front face and an
  ordered stack of back pages, wherein each back page is materialized only when its
  associated content satisfies a moderation-state condition, and wherein a page
  rendering the member-specific annotations is composed responsive to the identity of
  the requesting viewer…"
- *Method (A6):* "…generating a video asset by sequencing rasterized compositions of
  said pages, wherein each composition included in the video is verified to reference
  only content whose moderation state is 'approved' at generation time, and appending
  a terminal frame derived from an organization branding record having an
  operator-approval flag…"
- *Method (A7):* "…responsive to a flip interaction on an artifact bound to a verified
  achievement record, executing a server-side probabilistic selection over reward pools
  filtered by the record's source-organization provenance, the selection seeded per
  user-period such that repeated interactions within the period are deterministic…"

**Examiner's-eye prior-art landscape** (be ready for these; distinguish in the spec):
- Paged/flip UIs: flashcard apps, Apple Wallet passes, Instagram Stories, e-greeting
  cards. *Distinguish:* moderation-state-driven page existence; verified-record binding.
- Group message boards: **Kudoboard / group cards** are the closest art for A4.
  *Distinguish:* junction-row annotations on an imported *verified* award; per-viewer
  pinned recomposition; minor-moderation gate.
- Auto-video: Google Photos Memories, Spotify Wrapped, Animoto. *Distinguish:*
  publish-safety by construction from per-face moderation states — claim the gate, not
  the video.
- Loot/lottery mechanics: mobile loot boxes, McDonald's Monopoly digital. *Distinguish:*
  provenance-scoped eligibility inside a verified-achievement artifact; guardian-routed
  redemption; anti-farming seeding.

**§101 (Alice) posture:** claims must live in the rendering/moderation *mechanism* —
conditional DOM materialization, moderation-state gating of a generation pipeline,
seeded server-side rolls — framed as improvements to content-publication safety and
rendering (cf. specification language about container-query scaling, per-face raster
sources). Avoid claiming "showing thank-you notes" or "running a sweepstakes."

**Enablement checklist for the spec** (a provisional protects only what it teaches):
- Architecture diagram: record → junction rows → moderation states → page
  materialization → render/share/video/prize consumers.
- Schema excerpts: `award_dancers`, `award_acknowledgements`, moderation states,
  `feature_flags`, `organizations.custom_icons`, prize tables (from ideas §6 sketch).
- Flowcharts: moderation pipeline (manual/assisted/auto tiers), video frame assembly,
  prize roll + guardian redemption, WYSIWYG edit-vs-public render paths.
- Screenshots/wireframes of each page type incl. edit mode (drawings can be informal).
- **Alternative embodiments** (broadens coverage): non-dance achievements (sports,
  academics), non-card artifacts (certificates, badges), client- or server-side
  rendering, image instead of video derivatives, non-circular brand silhouettes.

---

## 4. P2 — Self-validating staged import with per-source historical baselining

**Working title:** *"Anomaly-gated autonomous promotion of third-party-sourced data
using per-source historical baselines."*

**Inventive spine:** snapshot live datastore → run full ingest against a staged copy
(environment-swapped `DB_PATH`) → score the staged-vs-live delta **against the same
source's own historical import distribution** (not global thresholds) → green
auto-promotes by **deterministic cache replay** against live; amber/red holds with a
machine-generated review report and human console. Supporting embodiments: idempotency
scoring as a first-class validation dimension; scrape-log-driven incremental refetch;
A2's identity-resolution steps (name+studio matching, junction-mapped group awards,
pseudo-studio collaboration rows, overflow-name reconstruction) described as the ingest
stage the validator protects.

**Prior-art landscape:** data-quality CI (Great Expectations, dbt tests), blue-green /
canary deploys, ETL anomaly detection. *Distinguish:* per-source self-history
baselining as the promotion gate + deterministic replay promotion (not a dataset swap)
+ idempotency-break scoring. **A2 alone is NOT worth its own filing** — entity
resolution is a crowded patent field (LiveRamp, Palantir, credit bureaus) and our
methods, while effective, are heuristic combinations an examiner will assemble from
prior art. Include A2 as embodiment text (free priority date if the attorney later
finds a claim), but budget zero expectation on it.

**Trade-secret alternative (decision needed):** A1/A2 internals are invisible from
outside — trade secret is a legitimate route and costs nothing. Deciding factor: a
provisional that is **never converted is never published** by the USPTO, so filing P2
loses no secrecy while buying a 12-month option; conversion at month 12 → publication
at month 18 is the real secrecy fork. Recommendation: file P2, decide at month 10.

**§101 posture:** strongest of the three — claims a concrete data-integrity pipeline
improving database reliability (Enfish/McRO-style "improvement to computer
functionality" framing). Keep claims off "validating data" in the abstract; anchor in
snapshot/staging/replay mechanics.

**Enablement:** pipeline flowchart (weekly_update → staging → validate_import scoring
dimensions → promote/hold paths), scoring-metric list with the per-org baseline math,
`PENDING_REVIEW.json` example, cache-replay promotion sequence, schema of `scrape_log`.

---

## 5. P3 — DancerID guardian-mediated selective disclosure (hold, then file)

**Why hold:** nothing is built and the consent/token design is one paragraph. File
after a 1–2 week paper-design pass produces: grant schema (`id_grants`: scope JSON,
grantee, expiry, revocation), token issuance/verification flow (HMAC per existing
invite patterns), guardian-verification step (COPPA-grade verifiable consent), audit
trail, field-level scoping, and the organizer pull API. That design doc *is* the
provisional spec.

**Why it may be the strongest §101 survivor:** consent-scoped authentication/disclosure
protocols with token mechanics and revocation fare relatively well post-Alice
(specific, technical, security-flavored). The guardian-mediation layer for minors +
scoping grants to a *verifiable competitive-history record* is a genuinely uncrowded
combination.

**Deadline logic:** no disclosure exists, so no clock runs — but ideas §8 is now in a
private repo shared with no one; keep it that way. File before any pilot conversation
with an organizer (that pitch is a disclosure unless NDA'd).

---

## 6. Filing logistics

- **Entity status:** likely **micro-entity** (gross income < ~3× median household
  income, <5 prior applications, no assignment obligation to a non-micro entity —
  verify all three; if AwardHome revenue or a day-job salary breaks the income test,
  small-entity is ~2× the fee, still cheap).
- **Fees:** provisional filing ≈ $65 (micro) / $130 (small) each at the last schedule I
  know; confirm at uspto.gov/learning-and-resources/fees — fees adjusted January 2025
  and may have again.
- **How:** USPTO Patent Center, provisional cover sheet (SB/16), spec + drawings as
  PDF. No claims, no oath, no IDS required. Inventor: Q Huang. If an LLC will own
  AwardHome, execute an assignment at conversion time (or now, if the LLC exists).
- **DIY vs. attorney:** P1 carries the commercial weight — spend on 2–4 hours of
  attorney review of a self-drafted spec (~$1.5–3k) rather than full drafting (~$5k+).
  P2 is defensible self-drafted (the pipeline docs are already 80% of a spec). P3:
  attorney review recommended because COPPA counsel is needed anyway — same touchpoint,
  as flagged in ideas §6/§8.
- **The 12-month docket (set reminders the day you file):**
  - Month 10: conversion decision per filing — non-provisional (US), PCT (worldwide
    option, ~$4–5k), both, refile-if-still-secret, or abandon (P2 trade-secret fork).
  - A provisional CANNOT be extended. Anything shipped publicly in the meantime is
    covered only if the provisional's text enabled it — **new features added after
    filing get follow-on provisionals** (they daisy-chain; each non-provisional can
    claim multiple provisionals from its trailing 12 months).
  - A5's independent US bar date: ~2027-08 regardless of the above.
- **Design patent track (separate, cheap, unexamined-in-practice):** the card's visual
  design (trophy front + champagne certificate back, coin silhouette) — file within
  6 months of first public disclosure… which has likely passed for the classic card;
  ask the attorney whether the *flip-book* appearance (not yet fully public) still
  qualifies. Trade dress accrues through use — just document consistent visual identity.
- **Marking:** after filing you may say "patent pending" in outreach — a credibility
  asset for the organizer pitch ("patent-pending branded award cards").

## 7. Proposed sequence

1. **Week of 2026-08-31:** freeze list (§2) in effect; draft P1 spec from features.md
   §3b/§3c + this doc's checklist (target 15–25 pp + 8–12 figures). Verify micro-entity.
2. **By ~2026-09-11:** attorney review pass on P1 (includes the A3/A4 disclosure-date
   question and the beta-gate characterization). File P1.
3. **By ~2026-09-18:** self-draft P2 from docs/db_operations.md + weekly_update/
   validate_import internals; file P2.
4. **Sept–Oct:** DancerID paper-design pass → P3 spec → file (attorney/COPPA combined
   review).
5. **After P1 files:** resume flip-book rollout (`beta` cohort), demos, and outreach
   with "patent pending."
6. **2027-06 (month 10):** conversion/PCT decisions; A5 US bar ~2027-08 rides with P1.

---

*Cross-refs: `maybe_patentable.md` (inventory + capture dates), `ideas.md` §3–§8,
`features.md` §3b–3c, `docs/db_operations.md`. Keep both patent files updated when
any Tier A/B feature's shipped status changes — the dates are the whole game.*
