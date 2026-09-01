# AwardHome Mobile App — Development Plan

**Status:** Proposed plan, implementation not started
**Date:** 2026-08-31
**Design source:** `docs/mobile_family_app_design_v2.md`
**Audience:** Engineering execution

This is the build plan, not the design. It sequences the work into milestones
that are each **independently shippable and gate-clean**, so value lands before
the app does and no milestone leaves the platform half-migrated.

---

## 1. The sequencing idea

The instinct is to scaffold the Expo app first. Don't.

**Every backend capability the app needs is also useful to the existing web
product, and can ship there first.** The submission pipeline, the event
candidates, and the studio review inbox all deliver value through EJS pages
before a single mobile screen exists. That means:

- The riskiest part (data integrity of family-entered awards) is proven with
  real users on a surface we already know how to ship.
- The mobile client, when it arrives, consumes an API that has already been
  exercised in production.
- If the app slips, the reviewer tooling and family entry still landed.

So: **backend and web-first for M1–M4, mobile client from M5.**

## 2. Constraints this codebase imposes

Non-negotiables that shape every milestone:

- **`npm run gate` before every deploy.** Smoke suite + adversarial page sweep +
  authed route audit. New surfaces need smoke coverage or the gate protects
  nothing.
- **Middleware order matters.** CSRF is global and mounted at `server.js:249–250`,
  before all routers. The mobile API authenticates with **bearer tokens, not
  session CSRF**, so `/api/v1/mobile` must mount **after `express.json()` but
  before `issueCsrfToken`**. It must also sit outside the `/dance` + `/dancer`
  beta gate.
- **CommonJS, semicolons, single quotes, two-space indent** (`AGENTS.md`). Thin
  routers, reusable logic in `utils/`. Vanilla browser JS/CSS — no frameworks
  on the web side without explicit permission.
- **Foreign keys are OFF by design.** Referential integrity is the application's
  job; every new table needs an explicit orphan story.
- **Migrations are idempotent `ALTER TABLE` in `initDb()`**, applied by
  `node database.js` and by deploy. No migration framework.
- **Reuse the existing resolvers.** `utils/resolveStudio.js`,
  `utils/resolveDancer.js`, `utils/soloPrimary.js`, `utils/claims.js`,
  `utils/studioMerge.js`. A second identity model will diverge from the first
  and re-create the duplicates the 2026-08-31 session removed.

## 3. Workstreams

| ID | Workstream | Runs across |
|---|---|---|
| **A** | Submission pipeline (staging DB, submissions, evidence) | M1–M3 |
| **B** | Event candidates and the picker | M2 |
| **C** | Reviewer tooling (studio inbox, then AwardHome queue) | M3–M4 |
| **D** | Mobile API (auth, contracts, sync) | M4–M5 |
| **E** | Expo client | M5–M7 |
| **F** | Media capture and sharing | M7 |
| **G** | Privacy, store readiness, legal | M6–M8, gate on M8 |

---

## 4. Milestones

Each milestone lists deliverables, acceptance criteria, and the gate. "Gate
clean" always means `npm run gate` passes **with new smoke coverage added**.

### M0 — Research and contract *(no production code)*

**Deliverables**
- 8–12 family interviews using their real certificates and result screenshots.
- Clickable Add-Award prototype including the **event picker** and **group size**
  steps — the two places archive integrity is won or lost.
- OpenAPI draft for the submission and read surfaces.
- Decisions closed: independent-dancer model (§16.1 of the design), event
  candidate lifecycle, reviewer split.

**Acceptance:** a family completes the prototype Add flow for a real award
without assistance, and the independent-dancer decision is written down.

> **Blocking decision.** The independent-dancer path touches existing
> invariants: `resolveDancer` requires a `studioId`, and both solo-repair
> scripts resolve ambiguity by matching dancer studio to award studio. Resolve
> this in M0 or M1 silently inherits it.

### M1 — Submission staging, web-first

**Deliverables**
- New **separate SQLite file** for staging (`DB_PATH`-style override, following
  the `staging_import.sqlite` precedent). Writers serialise in SQLite; a
  submission spike must not contend with the serving database.
- Tables: `award_submissions`, `award_submission_dancers`,
  `award_submission_evidence`, `award_provenance`.
- `utils/submissions.js` — create, validate, normalise (server-side whitespace
  and case collapse, never trusting the client), idempotency on
  `(user_id, client_submission_id)`.
- A minimal **web** submission form behind the existing auth, for a claimed
  dancer, reachable from the dancer page.
- Per-household daily rate limits (submissions, dancer links).

**Acceptance**
- A claimed family can submit an award for an existing event; it appears as
  Pending in their private view and nowhere public.
- Re-POSTing the same `client_submission_id` returns the original row, no
  duplicate.
- Group size is required and stored; a group submission records
  `cast_complete = false`.

**Gate:** smoke covers submit → pending-visible → idempotent-retry → not-public.

### M2 — Event candidates and the picker

**Deliverables**
- `event_candidates` table: org (optional), name, date, city/state, geo, photo
  key, creator, dedup cluster, promotion state.
- Picker service: geo + date lookup against `org_upcoming_events` (**1,056
  active, 1,080 geocoded**) and canonical `events` (4,214), then candidates.
- **Dedup at creation** — before the create form opens, show candidates already
  created for that date and area.
- Promotion/merge path: reviewer promotes, or auto-merge when the organizer's
  import later lands the same event.

**Acceptance**
- A family at a known event picks it in one tap.
- Creating a candidate makes it selectable by a second household immediately.
- Two families creating the same event minutes apart are offered the existing
  candidate first; if both proceed, the pair is flagged as one dedup cluster.
- No canonical `events` row is ever written by a family action.

**Gate:** smoke covers pick-existing, create-candidate, second-household-sees-it,
and no-canonical-event-created.

### M3 — Studio reviewer inbox *(the reviewer economics milestone)*

**Deliverables**
- Web inbox on the existing studio dashboard: pending submissions for **that
  studio's dancers only**, with confirm / correct / reject and the evidence
  alongside.
- Promotion service: on confirm, write the canonical award via the existing
  conventions — **solos double-write `awards.dancer_id` + junction; groups use
  the junction only** (`utils/soloPrimary.js`), record `award_provenance`, and
  respect `award_dancer_removals` tombstones.
- Verification level `studio_confirmed`.
- Scope guard: a studio owner can act only on their own dancers.

**Acceptance**
- A studio owner confirms a submission and the award appears correctly on the
  public studio and dancer pages, with the right primary/junction shape.
- A confirmation never resurrects a tombstoned dancer link.
- An owner cannot see or act on another studio's submissions (route audit).

**Gate:** smoke covers confirm-solo (primary + junction written), confirm-group
(junction only), tombstone respected, cross-studio access denied.

### M4 — Convergence, corroboration, and the AwardHome queue

**Deliverables**
- Convergence key `(event, routine, studio, group_size)`: a second household's
  submission for the same routine **links to the same award** rather than
  creating a new one.
- Corroboration promotion rule (unrelated households agreeing → promote).
- AwardHome reviewer queue for what studios cannot decide: independents,
  contested claims, cross-studio conflicts, anomalies.
- Correction proposals (`award_corrections`) with field-level before/after.

**Acceptance**
- Two households submitting the same group routine produce **one** award with
  two dancer links.
- The archive-integrity metrics of design §14 are queryable.
- Contested dancer claims route to AwardHome, never to a studio.

**Gate:** smoke covers convergence (one award, two links) and the contested-claim
route.

> **Checkpoint.** M1–M4 are shippable without any mobile client. If the app is
> deferred here, families can still contribute through the web and studios can
> still review. Decide at this point whether the mobile investment is justified
> by observed submission and review throughput.

### M5 — Mobile API and auth

**Deliverables**
- `/api/v1/mobile` router mounted **after `express.json()`, before
  `issueCsrfToken`**, and outside the beta gate.
- Opaque bearer auth: short-lived access token + rotating refresh token, only
  hashes stored. `mobile_sessions`, `push_devices`. Rate-limited code requests;
  revoke-all on security change.
- Read endpoints: dancer search, trophy case, submission status, activity —
  cursor pagination and `updated_since` sync.
- Write endpoints: claim, submit, correct, upload grant.
- OpenAPI published; TypeScript client generated from it.
- Object storage (S3/R2) with short-lived grants, MIME sniffing, size limits,
  malware scanning, re-encoding, EXIF strip.

**Acceptance**
- A token-authenticated client completes claim → submit → status without a
  session cookie or CSRF token.
- Revoking a device invalidates its refresh token immediately.
- The authed route audit covers the new API surface.

**Gate:** gate clean **plus** a new API test file against a throwaway database.

### M6 — Expo client: read, recover, claim

**Deliverables**
- `mobile/` Expo app, TypeScript strict, Expo Router typed routes.
- Guest search and trophy-case viewing; email-code sign-in.
- Household dashboard, profile claiming, affiliation resolution.
- `expo-secure-store` for refresh token; access token in memory.
- Universal links from `awardhome.com/dancer/<id>`.
- Internal builds; invited cohort.

**Acceptance:** an invited family installs, finds their dancer, claims, and sees
the trophy case — with no submission capability yet.

### M7 — Expo client: submission and media

**Deliverables**
- Offline drafts and outbox (`expo-sqlite`), server-issued event sessions.
- Add flow: dancer → event picker/create → routine → **group size** → placement
  → teacher/choreographer → evidence → confirm.
- **Photo and thank-you-note attachment as a first-class action** — the
  patent-pending multi-page card content, and the only part of the record
  organizers never supply.
- Push for decisions and questions only.
- Server-generated share images; native share sheet. **Evidence is never share
  media.**

**Acceptance:** a parent adds a weekend of results offline at a venue; all
submissions arrive exactly once and batch under one event session.

### M8 — Store readiness *(release gate, not cleanup)*

**Deliverables**
- In-app account deletion; external web deletion path for Google Play.
- Data export; evidence deletion; notification controls.
- Privacy policy, age rating, consent language.
- Deletion semantics documented: credentials/sessions/tokens/drafts/evidence vs
  published competition records (correction/takedown path, not silent erasure).
- Legal review of the adult/teen model, COPPA and state youth-privacy.

**Acceptance:** attorney sign-off recorded before beta widens beyond invited
families.

---

## 5. API surface (first cut)

```
POST   /api/v1/mobile/auth/request-code
POST   /api/v1/mobile/auth/verify           -> access + refresh
POST   /api/v1/mobile/auth/refresh
POST   /api/v1/mobile/auth/revoke

GET    /api/v1/mobile/dancers/search
GET    /api/v1/mobile/dancers/:id/awards     (cursor, updated_since)
POST   /api/v1/mobile/dancers/:id/claim

GET    /api/v1/mobile/events/nearby          (lat,lng,date)
POST   /api/v1/mobile/events/candidates      (dedup check first)

POST   /api/v1/mobile/submissions            (idempotency key)
GET    /api/v1/mobile/submissions            (status feed)
POST   /api/v1/mobile/submissions/:id/evidence   -> upload grant
POST   /api/v1/mobile/corrections

GET    /api/v1/mobile/activity
POST   /api/v1/mobile/devices                (push registration)
```

Read endpoints must work unauthenticated where the web equivalent is public,
so guest browsing needs no account.

## 6. Data migrations

All idempotent `CREATE TABLE IF NOT EXISTS` / try-catch `ALTER TABLE` in
`initDb()`, consistent with the existing schema approach.

| Milestone | Change |
|---|---|
| M1 | Staging DB file; `award_submissions`, `award_submission_dancers`, `award_submission_evidence`, `award_provenance` |
| M2 | `event_candidates` (+ dedup cluster) |
| M3 | Submission status/verification columns; provenance writes on promotion |
| M4 | `award_corrections`; convergence index on `(event, routine, studio, group_size)` |
| M5 | `mobile_sessions`, `push_devices` |
| M7 | Card media linkage reusing existing `award_card_photos` / acknowledgements |

Every new table needs an orphan story, since foreign keys are off.

## 7. Testing strategy

- **Smoke (`test/smoke.js`)** stays the integration suite; each milestone adds
  cases. The pattern established on 2026-08-31 holds: assert on a **targetable
  anchor** (e.g. `data-award-id`), not a character window — a brittle assertion
  produced a false failure that cost a debugging cycle.
- **API tests** against a throwaway database from M5, run in the gate.
- **Guardrail queries** from design §14 (new studios per 100 submissions,
  duplicate awards created, single-dancer group awards) run weekly beside the
  existing pipeline, alerting on regression — these catch silent archive decay
  that no unit test will.
- **Repair scripts are the safety net.** Existing repairs
  (`repair_collapsed_solo_dancers`, `backfill_solo_primary_dancer`,
  `merge_studio_aliases`) must stay clean after each milestone; a milestone that
  makes one of them find work has introduced a defect.

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Family entry re-creates the duplicate problem just cleaned up | High | High | Affiliation-derived studio; event candidates not canonical; convergence key; weekly guardrail metrics |
| Reviewer throughput becomes the ceiling | High | High | Studio inbox at M3, not Phase 4; corroboration promotion at M4; beta sized to reviewer capacity |
| Service extraction destabilises the web app | Medium | High | Extract only what each milestone needs; web routes call the same service; gate every step |
| SQLite write contention under submission load | Medium | Medium | Separate staging DB file from M1; named Postgres trigger (p95 write latency) rather than an open question |
| Independent-dancer path breaks resolver invariants | Medium | Medium | Blocking decision in M0 |
| Credit graph ships ahead of its IP filing | Medium | High | M7/Phase 4 gated on the provisional; see below |
| Store rejection over minors/UGC | Medium | High | M8 as a gate; legal review before beta widens |

## 9. Decision and compliance gates

1. **M0 — independent-dancer model.** Blocking; touches `resolveDancer` and both
   solo-repair scripts.
2. **M0 — event candidate lifecycle.** Visibility radius, date window, promotion
   authority, auto-merge on organizer import.
3. **M2 — reviewer split.** What only AwardHome may decide.
4. **M4 — go/no-go on the mobile client**, based on observed web submission and
   review throughput.
5. **M5 — storage choice and evidence retention.**
6. **Before any credit-graph work — close the IP gate.** `TODOS_and_DONE.md`
   records: *"Teacher & choreographer accounts + card credits (two-sided
   accept). IP: add credit-granularity embodiment to the follow-on provisional
   queue before building."* Capturing teacher/choreographer **names as award
   metadata** (M7) is outside that gate; the **credit graph and two-sided
   accept** are inside it. A11 was publicly disclosed on 2026-08-30 by a deploy
   that shipped ahead of exactly this kind of gate — do not repeat that.
7. **M8 — legal sign-off** before beta widens beyond invited families.

## 10. Sequencing notes

- M1–M4 are **web-only** and independently valuable. Ship and learn there.
- M5 is the only milestone that touches `server.js` middleware order; do it in
  isolation with the route audit as the check.
- M6 and M7 can overlap with M4 once the API contract is frozen.
- Nothing in M1–M5 requires the Expo toolchain, so backend and client work can
  be staffed independently once the OpenAPI contract exists.
- Beta capacity is set by **reviewer throughput**, never by download targets.

---

**First code to write:** the M1 staging schema and `utils/submissions.js`, with
the web submission form as its first consumer. **First artifact overall:** the
M0 clickable Add-Award prototype in front of real families — with the event
picker and group size in it, because those two steps decide whether the archive
stays clean.
