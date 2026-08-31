# What counts as a Major Award — policy & per-competition recommendation

*Drafted 2026-08-30. Companion to `docs/org_top_awards.md` (the per-org rule
research). This document answers: who decides, why the current statistic is
wrong, and what each competition's rule should be.*

---

## 1. Who decides?

**The competition decides.** Every organization publishes its own award
structure, and the same words mean different things across them. Our job is to
*encode* each org's published hierarchy — never to infer prestige from wording
that happens to look impressive.

The clearest proof is already in our research: **at KAR, "First Place" is the
LOWEST adjudication band** (First Place → Top First → Elite Top First → Elite
Ultimate Performance). A rule that treats "1st"-sounding text as an achievement
gets KAR exactly backwards.

So the decision chain is:

1. **The org's published rules** (docs/org_top_awards.md, with sources +
   confidence per org) define the hierarchy.
2. **A superadmin encodes it** against real award vocabulary via the existing
   award-vocab tool (`/admin/orgs/:id/award-vocab`), which sets
   `awards.is_top_award`.
3. **Studio owners' private emphasis** (`studio_award_weights`, 2026-08-30)
   supplies the field's own judgment in aggregate (`/admin/award-emphasis`) —
   a check on our reading of the rules, credible because those weights can
   never move a public number.

---

## 2. What's wrong today

The public "Major Awards" figure comes from a **cross-org keyword heuristic**
(`utils/majorAward.js`): a first place whose text contains a prestige word
(title/scholarship/invite/photogenic/DOY) at a national/finals/grand/title
"stage". It ignores `is_top_award` entirely. Measured on the live corpus:

| org | awards | curated `is_top_award` | heuristic "major" | curated but MISSED | heuristic-only |
|---|---:|---:|---:|---:|---:|
| kar | 162,799 | 1,138 | **2** | 1,138 | 2 |
| starpower | 156,076 | 1,824 | 3,253 | 1,824 | 3,253 |
| nexstar | 123,114 | 0 | 2,489 | 0 | 2,489 |
| revolution | 98,519 | 0 | 2,380 | 0 | 2,380 |
| imagine | 97,755 | 1,005 | 2,021 | 1,005 | 2,021 |
| believe | 62,630 | 241 | 1,532 | 241 | 1,532 |
| nycda | 48,078 | 1,721 | **0** | 1,721 | 0 |
| starquest | 42,851 | 1,834 | 438 | 1,834 | 438 |
| spotlight | 34,575 | 0 | 773 | 0 | 773 |

Read the last two columns: **the overlap between curated truth and the
heuristic is essentially zero.** Where a human encoded the org's real top
awards, the heuristic finds different rows. Only 6 of 26 orgs are curated at
all.

Two concrete failure modes:

- **Invitations counted as wins.** `invite` is a prestige term, so Starpower's
  16,219 "Power Pak Invites" and similar rows are eligible for "major". An
  invitation to a future event is not a competitive achievement.
- **Overall placements ignored.** The heuristic requires prestige wording, so
  the genuinely competitive rankings — StarQuest's 34,186 `Overall` rows,
  Showstopper's/NYCDA's `High Score`, KAR's `Top Elite Solo 15 - 19` — cannot
  qualify at all.

---

## 3. The recommended model (three tiers)

Grounded in what actually distinguishes achievements at these events (Q's
experience, 2026-08-30, and consistent with the org rules on file):

**Tier 1 — Headline.** The pinnacle of the event: national/finals grand
champions, Mr./Miss titles, Grand Prix, Dancer of the Year, Best Dancer.
*Always major.*

**Tier 2 — Competitive overall placements, 1st–3rd.** Rankings ACROSS a whole
division (age × size × level), not inside one narrow category. This is the tier
the current heuristic misses entirely, and per Q the one families most consider
a "real" win. Depth beyond 3rd is depth-of-field, not a headline.

**Tier 3 — Named special / judges' awards.** Org-specific honors for
outstanding work from a particular perspective (Odyssey Awards, Best of JUMP,
Critics' Choice, Fernando Bujones Memorial Award). Major *only* where the org's
rules present them as distinctions — not participation or invitation rows.

**Never major:**
- adjudication bands (Platinum/High Gold/Gold; KAR's First Place → Elite
  Ultimate Performance ladder) — these are score tiers every entry receives;
- category placements inside a narrow style bracket (1st in Teen Lyrical Solo);
- invitations, scholarships-to-attend, and audition callbacks — opportunities,
  not placements (a scholarship *awarded as an honor* at Tier 3 is different;
  judge by the org's own framing);
- 4th place and deeper in any ranking.

---

## 4. Per-competition recommendation

Status: **encoded** = `is_top_award` already set for those rows; **ready** =
rules documented with high confidence, needs encoding; **verify** = awaiting
website confirmation (research in flight 2026-08-30).

| Competition | Tier 1 (headline) | Tier 2 (overall placements) | Tier 3 (special) | Status |
|---|---|---|---|---|
| **KAR** | National Grand Champion (`place='Winner'` only); National/Regional Title — Mr./Miss Dance (Mini/Petite/Junior/Teen/flagship) | `Top <Level> <Size> <Age>` with place 1st–3rd (regional & finals high point) | Studio of the Year, Choreographer of the Year, Future Star, Judges' Choice | encoded (1,138) |
| **Rainbow** | National title winners | `Top <Level> Starz <Size> <Age>` 1st–3rd | Judges' Choice | ready |
| **Starpower** | Mr./Miss titles; national champions | Division tables (`<age> Level <n> Solos`) 1st–3rd | named specials per rules | encoded (1,824) — **exclude Power Pak Invites** |
| **Believe / Revolution / Imagine / DreamMaker** (Star Dance Alliance siblings) | titles; national champions | `Level <n> <age> Solo` division tables 1st–3rd | named specials | Believe/Imagine partly encoded; **exclude Discovery Spotlight & Power Pak Invites** |
| **NexStar** | Premier/Elite Title — Mr./Miss Nexstar (branded titles) | `SDA Regional Champion — …` / Grand Lines & Production champions | Costume Award etc. only if rules frame them as honors | **not encoded** (heuristic currently claims 2,489) |
| **Showstopper** | national titles | `High Score` 1st–3rd | — | verify |
| **StarQuest** | `Title` rows | `Overall` rows 1st–3rd (34,186 rows — the core competitive stat) | Odyssey Awards (Teen/Junior/Senior) | encoded (1,834) |
| **NYCDA** | `Outstanding Dancer` (+ Runner-Up as Tier 2) | `High Score` 1st–3rd | `Critics' Choice Winner` | encoded (1,721) |
| **Spotlight** | national titles | `Overall` 1st–3rd | — | verify |
| **YAGP** | Grand Prix; top-3 per age division | classical/contemporary placements 1st–3rd | Outstanding Choreographer/Teacher/School | ready |
| **Encore** | "Mic Drop" (Elite) + Grand champions | overall placements 1st–3rd | named specials | ready |
| **ADC\|IBC** | **Grand Prix Recipient** (per age division) | Gold/Silver/Bronze medals — **confirm whether by rank or score threshold** | Fernando Bujones Memorial, Traditional Excellence, Outstanding International Dancer | verify |
| **UBC** | Grand Prix Finals 1st place | division 1st–3rd (INT/COM are levels, not awards) | Rising Star, Aspire, Legacy | verify |
| **Hollywood Vibe** | — | **OVERALL tables (1ST–3RD OVERALL)** — outrank category placements | Specialty judge awards; scholarships incl. Dancer of the Year | verify |
| **JUMP / NUVO / RADIX / 24SEVEN** (DanceOne) | Best of JUMP / Best NU Group / equivalents per age division | HIGH SCORE by age & performance, 1st–3rd | Best in Studio; **treat the 50k+ `SCHOLARSHIP` rows as opportunities, not placements** | verify |
| **Inspire** | `TITLE` — Title Winner (Miss/Mr) | overall placements 1st–3rd | — | verify |
| **Tremaine** | **D.O.T.Y. — Dancer of the Year** | overall placements 1st–3rd | — | verify |
| **The Dance Awards** | **Best Dancer** (winner/2nd/3rd + Top-N finalists); Studio of the Year | High Score by age/performance 1st–3rd | Specialty awards | verify |
| **Ultra / Refresh** (KAR family, DanceBug) | titles if any | KAR-style `Top …` division tables 1st–3rd | — | **no rules research on file** — verify |

---

## 5. Implementation recommendation

1. **Make curation authoritative.** `isMajorAward()` becomes: if the award's
   org has any curation, use `is_top_award`; only fall back to the keyword
   heuristic for uncurated orgs, and label that figure "provisional" in the
   owner-facing explainer until the org is encoded.
2. **Encode Tier 1–3 per org** from §4 using the award-vocab tool, biggest
   corpora first (KAR, Starpower, NexStar, Rainbow, Revolution).
3. **Stop counting invitations** (`Power Pak Invites`, `Discovery Spotlight`,
   convention scholarships) — remove `invite`/`scholarship` from the fallback
   prestige terms once orgs are encoded.
4. **Add overall placements** as a first-class concept: they're Tier 2 and
   currently unrepresentable in the heuristic.
5. **Watch the aggregate** at `/admin/award-emphasis`: if studios collectively
   mark something Headline that we classify as routine, re-read that org's
   rules — that's the field telling us our encoding is wrong.

**Public-number impact:** moving from heuristic to curation will change public
Major Award counts materially (both directions, per §2). Recommend encoding
the top orgs first, comparing before/after per studio, and announcing the
change — the counts are on public studio pages.
