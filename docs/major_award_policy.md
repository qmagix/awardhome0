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

## 2b. Why a cross-org rule cannot work — verified naming traps

Website research on 2026-08-30 (sources in `org_top_awards.md`) confirmed that
the most award-sounding strings in this industry are usually **score bands** —
tiers every entry receives — and that identical words carry opposite meanings
across organizations:

| String | Where | What it ACTUALLY is |
|---|---|---|
| `First Place` | **KAR**, **Ultra** | The **lowest** adjudication band. Ultra's rules: "*There may be multiple* Elite Platinum, Elite Top First Place, Top First Place, and First Place awards in each age group and category." |
| `Top First Place`, `Elite Top First Place`, `Elite Platinum` | KAR, Ultra | Higher bands — still bands, not ranks |
| `Vibe Award` | **Hollywood Vibe** | Top score band (100–97.5%), not an honor |
| `Flawless Gem`, `Crystal Diamond`, `Diamond`, `Sapphire`, `Emerald`, `Ruby` | **Inspire** | Bands — and Inspire's own prose calls them "awards" |
| `YOU ROCKED JUMP!`, `DJ'S PICK!!`, `ON THE EDGE!`, `STOP THE CLOCK!`, `Judge's Pick` | JUMP / NUVO / RADIX / 24SEVEN / TDA | Each is simply the 291–300 band |
| `Palladium`, `High Gold`, `Gold`, `High Silver` | all DanceOne + TDA | Bands |
| `1st Place` | **Tremaine** | A **score band** (97–100) — many exist per event, and placements are per narrow style category, not division overalls |
| `Gold Medal` | **ADC\|IBC** | **1st place of the whole age division** — one per division |
| `Gold` | **UBC** | The **third tier down** (below UBC Platinum and High Gold), unbounded count, awarded by score threshold |

That last pair is the whole argument in two rows: **an ADC|IBC "Gold" is the
division winner; a UBC "Gold" is a mid-tier participation medal.** No keyword
rule can tell them apart — only per-org encoding can.

Equally important, the reverse error: **huge row counts that look like awards
but are opportunities.** JUMP's 50,636 and 24SEVEN's 42,975 `SCHOLARSHIP` rows
are class/workshop scholarships (VIP, Breakout Artist, Non-Stop Dancer), not
routine placements — the qualifying path to a title elsewhere. Starpower's
16,219 `Power Pak Invites` are invitations.

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
- **title runner-ups** at commercial competitions — the title contest is
  usually a paid add-on entry, so "1st runner-up" often reflects who paid to
  compete rather than a scarce win (Q, 2026-08-30). Only the title WINNER
  counts. This does NOT extend to ranked placements: a ballet Silver or a
  2nd overall beat a field and still count;
- adjudication bands (Platinum/High Gold/Gold; KAR's First Place → Elite
  Ultimate Performance ladder) — these are score tiers every entry receives;
- category placements inside a narrow style bracket (1st in Teen Lyrical Solo);
- invitations, scholarships-to-attend, and audition callbacks — opportunities,
  not placements (a scholarship *awarded as an honor* at Tier 3 is different;
  judge by the org's own framing);
- 4th place and deeper in any ranking.

---

## 4. Per-competition recommendation

Status: **verified** = award rules read from the org's own website 2026-08-30
(✔ in the table); **encoded** = `is_top_award` already set for those rows;
**ready** = rules documented with high confidence, needs encoding; **verify** =
website confirmation still outstanding.

| Competition | Tier 1 (headline) | Tier 2 (division overalls, 1st–3rd) | Tier 3 (special) | Status |
|---|---|---|---|---|
| **KAR** | National Grand Champion (`place='Winner'`); Mr./Miss Dance titles (National & Regional) | `Top <Level> <Size> <Age>` high-point tables | Studio/Choreographer of the Year, Future Star, Judges' Choice | encoded (1,138) — bands `First Place`→`Elite Ultimate Performance` excluded |
| **Rainbow** | National titles | `Top <Level> Starz <Size> <Age>` | Judges' Choice | ready |
| **Starpower** | Mr./Miss titles; national champions | division tables (`<age> Level <n> Solos`) | named specials | encoded (1,824) — **exclude `Power Pak Invites`** |
| **Believe / Revolution / Imagine / DreamMaker** | titles; national champions | `Level <n> <age> Solo` tables | named specials | partly encoded — **exclude `Discovery Spotlight`, `Power Pak Invites`** |
| **NexStar** | Premier/Elite Title — Miss/Mr Nexstar | `SDA Regional Champion — …`, Grand Lines/Production champions | Costume Award only if rules frame it as an honor | **not encoded** (heuristic claims 2,489) |
| **Showstopper** | national titles | `High Score` | — | verify |
| **StarQuest** | `Title` | `Overall` (34,186 rows — the core competitive stat) | Odyssey Awards | encoded (1,834) |
| **NYCDA** | `Outstanding Dancer` (Runner-Up = Tier 2) | `High Score` | `Critics' Choice Winner` | encoded (1,721) |
| **Spotlight** | national titles | `Overall` | — | verify |
| **YAGP** | Grand Prix; top-3 per age division | classical/contemporary placements | Outstanding Choreographer/Teacher/School | ready |
| **Encore** | "Mic Drop" (Elite) + Grand champions | overall placements | named specials | ready |
| **ADC\|IBC** ✔ | **ADC Grand Prix** per age division (finals only) | **`GOLD`/`SILVER`/`BRONZE MEDAL` = 1st/2nd/3rd of the division** (then 4th, 5th, Top 25/Top 10 = honorable mention); ensembles 1st–5th | Fernando Bujones Living Memorial, Traditional Excellence, Avant Garde, Jury Encouragement, Outstanding International Dancer/Choreographer/Coach/School, Top Scoring Ensemble | verified — **semi-finals are an audition tour, per-category placements only** |
| **UBC** ✔ | **The Grand UBC Award** (1 Junior + 1 Senior per event; must enter classical AND contemporary) | "high score awards … top scores in each **category** within an age division" — category-level, not division-wide | none named (discretionary list only) | verified — ⚠️ **all medals are score thresholds; `Gold` ≠ 1st. Doc corrected: "Grand Prix" is the finals EVENT name, not an award** |
| **JUMP / NUVO / RADIX / 24SEVEN** ✔ | RADIX only: **Elite Protégé** (at its own THE ONE Nationals) — JUMP/NUVO/24SEVEN have **no title**; their VIP/Breakout/Non-Stop scholarships qualify dancers for Best Dancer at TDA | **`HIGH SCORE BY AGE`** 1st–3rd (solos published 10 deep) — division-wide | Best of JUMP / Best Nu Group / Best of RADIX / 11 O'Clock Number; Best in Studio / Studio Pick / Standout / Showcase | verified — **exclude the 50k+ `SCHOLARSHIP` rows and every band name** |
| **The Dance Awards** ✔ | **Best Dancer** (Winner / 1st & 2nd Runner-Up, per age × gender); **Studio of the Year** (Las Vegas only) | "**Overall** … High Scores … 1st–5th place" by age division | Best Performance (+ nominees), Outstanding Technical Achievement, Best Choreographer, Best {genre} Performance, Costume Design, People's Choice, Studio Encore, per-genre Studio Awards | verified |
| **Hollywood Vibe** ✔ | **Dancer of the Year** (regional, per convention level); **National Dancer of the Year** at Hollywood Invitational | **`Overall High Score`** Solo/Duo-Trio/Groups — Top 3 with 5+ entries, Top 5 with 10+ | Judges Specialty: Outstanding Choreography, Most Entertaining, Best Costume, Best Direction; nationals **Battle of the Stars** | verified — ⚠️ `Vibe Award` is the top BAND; category trophies are narrow-category |
| **Inspire** ✔ | **Title / Title Runner-Up** (Miss/Mr; runners-up also qualify for National Title) | **`Overall Awards`** — depth set by entry count (Top 20/18/15/12/10/8/5/3/1) | Judge's Choice, `Top <Genre> Performance` ×8, Top Score of the Session, Golden Egg (+Wild Cards), studio awards | verified — ⚠️ gemstone bands are called "awards" by Inspire |
| **Tremaine** ✔ | **D.O.T.Y.** (10/year, audition+interview, finals only); **Performance of the Year** | ⚠️ placements are per narrow style category. The division-wide honors are **High Score** and **Judges Ovation**; nationals adds **GOLD/SILVER/BRONZE National High Score** (true ranks) | T.O.T.Y., Entertainer of the Year, Judge's Choice Ovation, Shining Star, National Freestyler | verified — ⚠️ **`1st Place` is a score band (97–100)** |
| **Ultra** ✔ | **Icon of the Year** (per level × age; finalists qualify for KAR National Finals Title) | **`Overall High Point`** → `Top <Level> <Type> <Age>`; observed depth solos 10 / duet-trio 5 / groups 3 | Supercharged Performance, Ultimate Improv Champion, HDE All Stars, Headshot | verified — ⚠️⚠️ **`First Place` / `Top First Place` / `Elite Top First Place` / `Elite Platinum` are BANDS** |
| **Refresh** ✔ | **SQUAD** (title; finalists qualify for KAR National Finals Title) | **`Overall High Point`** — published depth: **Top 10 solos (Top 15 in 40+ divisions), Top 5 duet/trios, Top 5 groups** | Spirit of Refresh, Legacy, Visual Impact, Choreography, Technical Excellence, Studio awards | verified — ⚠️ bands unpublished; `Foundation/Progressive/Elite` are LEVELS |

✔ = award rules verified against the organization's own website on 2026-08-30.

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


---

## 6. Encoding log & the "what counts as major" decision (2026-08-30)

**KAR and Starpower encoded** via `scripts/encode_top_awards.js` (idempotent;
resets an org before applying its rules, so editing a rule can only produce
exactly what the rules say). A new `awards.top_award_tier` column records
WHICH tier each row is, so the platform can change what counts as "major"
later without re-encoding.

| | heuristic (today) | T1 headline | T2 division overalls 1st-3rd | T3 specials |
|---|---:|---:|---:|---:|
| KAR | 2 | 7,074 | 57,592 | 1,692 |
| Starpower | 3,253 | 6,845 | 29,346 | — |

Corrections made while encoding — both found by checking the data against the
published rules, and both a warning that existing curation is not automatically
trustworthy:
- **584 KAR rows flagged `is_top_award` were `Elite Ultimate Performance`** —
  which our own research says is the TOP ADJUDICATION BAND, not an award. A
  previous curation pass had marked the band as a top award. Unflagged.
- **Starpower title rows carry the whole contest**: place `1` is the title
  winner, `2`/`3` are runner-ups. The first pass counted runner-ups as title
  winners (7,857 → 3,242 after the fix).

**Per-studio effect** (KAR + Starpower awards only):

| studio | awards | heuristic | T1 | T2 | T3 |
|---|---:|---:|---:|---:|---:|
| Triple Threat Performing Arts | 1,708 | 10 | 114 | 611 | 26 |
| Karen's School of Dance | 1,414 | **0** | 52 | 522 | 29 |
| Studio L Hoboken | 1,144 | 48 | 154 | 202 | 1 |

**DECIDED 2026-08-30 (Q):** Major Awards = **T1 + T2 + T3** — overall
placements are genuinely competitive, so they count. And the public pairing is
**"first places" + "other major awards"**, not "first places + major": an
overall 1st IS the regional or national champion, so it belongs in the
first-place figure, and calling a number "major" while excluding it reads
wrong. "Other major awards" then adds titles, grand champions, named specials
and 2nd/3rd overalls — **nothing is double-counted**. The owner's Organization
History page additionally breaks out **Division Placements** (T2) and labels
uncurated orgs' figures "provisional".

Original options considered:

- **T1 + T3 only** (~80-155 per big studio): "major" keeps its headline meaning
  — grand champions, titles, named honors. **Recommended.**
- **T1 + T2 + T3** (~350-750 per big studio): matches the view that overall
  placements are the truly competitive results, but makes a third to a half of
  a studio's awards "major", which dilutes the word.
- **Suggested resolution:** publish BOTH — "Major Awards" = T1+T3, and a
  separate "Division placements" figure = T2. That honors the fact that
  overalls are where the real competition happens without making "major" mean
  "roughly everything". The tier column makes this purely a display choice.

Nothing user-visible has changed yet: `utils/majorAward.js` still drives the
public figure, and it does not read `is_top_award`. Switching it is the next
step, after the T1/T2/T3 display decision.


---

## 7. Batch 2 encoded — NexStar, Rainbow, Revolution, StarQuest, NYCDA (2026-08-30)

**9 of 26 orgs now encoded, covering 59% of all awards.** The remaining 17 orgs
still use the labelled-provisional keyword fallback.

| org | T1 headline | T2 division overalls | T3 specials |
|---|---:|---:|---:|
| NexStar | 6,273 | 24,890 | 570 |
| Rainbow | 2,407 | 24,945 | 5,748 |
| Revolution | 8,905 | 21,808 | 3,923 |
| StarQuest | 1,429 | 16,975 | 2,547 |
| NYCDA | — | 11,494 | 3,333 |

**The recurring trap in this batch:** a `champion` / `title` / `DOY`
award_type names the whole CONTEST — winner, runner-ups and often the entire
finalist field share the type, separated only by `place`. Each rule was
checked against real rows first:

- **NexStar** — champion rows with `place='1'` carry a routine name and are the
  real champions (~12/event); the 15,758 NULL-place rows (~52/event) are the
  qualifier list. Only place 1/Winner encoded.
- **Rainbow** — 14,537 DOY rows have `place='Finalist'`. The winner repeats the
  award name in `place` (the KAR title pattern). Only those encoded. `Rising
  Starz … NYC All Stars` rows are invitations — excluded.
- **Revolution** — `place='Winner'` spans real specials (Choreography,
  Entertainment) AND opportunities (`Discovery Spotlight` callbacks,
  `Dancer Palooza $150 Voucher`). Only the specials encoded.
- **StarQuest** — title runner-up places carry tab damage (`"1st\tRunner Up"`);
  `place='1'` is the winner.
- **NYCDA** — `award_type = 'Outstanding Dancer'` is a SECTION HEADER, not the
  award: the real name is in `category`. The section mixes the convention
  honour itself (`<Age> Outstanding Dancers`, ~13/event — Q confirms this is a
  genuine convention placement and a well-regarded honour) with summer-intensive
  SCHOLARSHIPS (Tap, Ballet, Hip-Hop, Future Star, Steps…), which are
  opportunities and stay out. Encoded as T3: Outstanding Dancers + Outstanding
  Artist + Rising Star Award = 1,552 rows.
  Still out, pending a decision: 4,829 `Runner-Up` rows (`<Age> Runners-Up`) —
  the named second tier of the same honour. Say the word to include them.
  Also note these rows carry **no dancer links** (0 distinct dancer_id), a
  separate data-completeness gap worth a look.

**Prior human curation was preserved, not overwritten**: it was inspected first
(NYCDA `Critics' Choice` + `Overall 1st`, StarQuest Odyssey/Apogee, Believe and
Imagine SDA Champions) and found consistent with this model, so the new rules
were written to re-cover it — NYCDA's 441 `Overall` rows re-encoded with zero
changes, confirming the match.

**Per-studio effect** (all orgs, public pairing):

| studio | awards | first places | other major (was) | division placements |
|---|---:|---:|---:|---:|
| Encore Dance Academy | 5,458 | 1,272 | 586 (146) | 903 |
| The Element Dance Center | 3,900 | 464 | 718 (7) | 921 |
| Studio 19 Dance Complex | 4,689 | 1,054 | 394 (124) | 622 |
| Club Dance Studio | 4,693 | 680 | 71 (0) | 84 |


---

## 8. Batch 3 + a data bug (2026-08-30)

**15 of 26 orgs encoded — 81% of all awards.**

**Convention dancer titles are majors (Q).** At the DanceOne conventions the
title lives under `award_type='SCHOLARSHIP'` with `place='WINNER'` and the name
in `category` (`Mini Non-Stop Dancer`, `… VIP`, `… Breakout Artist`,
`… Protege`). My earlier blanket "the 50k SCHOLARSHIP rows aren't awards" was
too broad: the class scholarships ("High Five in Jazz/Ballet/Hip-Hop") are
opportunities, but winning the convention's dancer title is a headline win.
Encoded T1: JUMP 4,671 · NUVO 4,766 · RADIX 3,415 · 24SEVEN 4,902.
Their high-score placements 1st-3rd are T2 (Q: a 2nd in Solo at a convention is
"very competitive"), and SPECIAL judges' awards (Best of JUMP etc.) are T3.

**Ballet is judged on a different scale (Q).** ADC|IBC and YAGP run a single
elite level per age band against a national field, so the whole published
ladder is prestigious — "very hard to get into top 25 nationally".
- **ADC|IBC**: T1 = Gold/Silver/Bronze medal + 1st-3rd (123); T2 = the rest of
  the finals ladder — 4th, 5th, Top 10/15/25 (360). All 483 awards count.
- **YAGP**: T1 = 1st/2nd/3rd incl. ties (7,369); T2 = Top 3 / Top 6 / Top 12
  (17,906) — Top 24 sits below the community's bar per Q; T3 = Outstanding
  Choreographer/Teacher/School (634).

**Runner-ups: DECIDED 2026-08-30 (Q) — title runner-ups do NOT count.**
"Often a paid participation honour, especially in regionals; only first place
(winner) counts in the cases of titles in commercial dance competitions."
Verified: zero runner-up rows are flagged anywhere, including NYCDA's 4,959
`Runner-Up` rows.

⚠️ **This applies to TITLES at commercial competitions, not to competitive
placements.** A ballet 2nd or 3rd is a ranked result against a national field,
not a paid title honour, so ADC|IBC's Silver/Bronze and YAGP's 2nd/3rd remain
counted (5,344 rows). The distinction to preserve in any future rule: a title
runner-up is a purchased entry into a title contest; a placement runner-up beat
everyone else but one.

### The "no dancer name" bug — not the scraper

Reported: 24SEVEN 2023 Santa Clara, Mini Solo 5th, "Fierce And Free" showed no
dancer. The award **did** carry `dancer_id = 348123` — but that dancer row no
longer exists. A **stale pointer** is worse than an uncredited award: the award
looks credited, so it never appears in Check Routine Dancers and nobody is
prompted to fix it.

`scripts/repair_stale_dancer_pointers.js --apply` cleared **51** such pointers
(10 deleted dancer ids) across RADIX 20, JUMP 11, 24SEVEN 9, NUVO 6, UBC 4,
The Dance Awards 1. Those routines now show honestly as missing dancers and can
be filled by an owner — or by re-running the org's importer, since the source
files still hold the names. Cause: historic delete paths that didn't repoint
the legacy column (today's merge tools all do — fixed 2026-08-30).


---

## 9. Star Dance Alliance family + choreography (2026-08-30)

**A systemic bug, found from one report.** Q: "under Believe, 1st overall
should be counted as major, currently not." Cause: Believe had 241 legacy
flagged rows (SDA Champions only). Since **any** curation makes an org
"curated", the keyword fallback stopped applying to it — so everything
unencoded silently vanished from its numbers. Partial curation was worse than
none. The encoder now prints a **⚠️ CURATED BUT NOT ENCODED HERE** warning for
any org with flagged rows but no rules, so this can't recur silently.

Fixed by unifying the five Star Dance Alliance siblings (Starpower, Revolution,
Believe, Imagine, DreamMaker) onto ONE generated rule set — they share an
anatomy, and encoding them separately is exactly how the gap appeared.

**Division tables are now matched by SHAPE, not by the word "level":** these
orgs also name a level "Competitive" (`Competitive 15-19 Solo`) and some size
groups carry no level word at all (`12 & Over Grand Lines`). The rule is now
"place 1-3 + a size word (solo/duet/trio/group/line/production), minus
champions, titles, costumes, outstanding-genre, invitations and vouchers".

| org | T1 | T2 | T3 |
|---|---:|---:|---:|
| Starpower | 8,181 | 43,538 | 11,490 |
| Believe | 3,726 | 20,093 | 4,090 |
| Imagine | 7,699 | 28,975 | 5,457 |
| DreamMaker | 1,322 | 5,838 | ~1,000 |

**Choreography awards are now a UNIVERSAL rule** applied to every encoded org
(Q: "very rare — each level usually at most one, sometimes the whole event only
has one or two"). Platform-wide there are 11,158 such rows across ~4,200
events (≈2.7 per event), which matches that description. They count regardless
of how an org files the `place` (`Winner`, blank, `1`, `–`, or the award name
itself) — Rainbow alone had 633 rows of which only 27 were counted before.

**Coverage: 16 of 26 orgs, 83% of all awards.**
Platform tiers: T1 72,262 · T2 361,412 · T3 55,239.


---

## 10. Named dancer honours at the conventions (2026-08-30)

Q: "Rock Star Dancer in JUMP should be a major as well."

Looking at it revealed that each DanceOne convention has exactly ONE scarce
named dancer honour sitting beside its qualifying title, and all four were
uncounted:

| org | honour | volume | qualifying title (already T1) |
|---|---|---|---|
| JUMP | **Rock Star Dancer** | 1,210 (~8.5/event) | JUMP VIP |
| NUVO | **Die Hard Dancer** | 1,483 (~10.7/event) | BreakOut Artist |
| RADIX | **Choice Artist** | 1,202 (~10.5/event) | Protégé |
| 24SEVEN | **Weekend Warrior** | 1,273 (~9.9/event) | Non-Stop Dancer |

All four now count as T3. The ruling was applied to the exact siblings of the
award Q named, since the four conventions share one anatomy.

**The distinguishing shape — genre vs. person.** These honours live in the same
`award_type='SCHOLARSHIP'` bucket as the class scholarships, but the two are
told apart by how they're named:
- **Genre-named = class scholarship, excluded**: "StandOut in Tap", "Cutting
  Edge in Jazz & Contemporary", "High Five in Ballet", "JAZZ, CONTEMP. &
  LYRICAL", "BALLROOM". Volume 20-77 per event.
- **Person-named = honour, counted**: Rock Star Dancer, Die Hard Dancer,
  Choice Artist, Weekend Warrior. Volume 8-11 per event.

Verified after encoding: 0 genre class scholarships are counted.

---

## 11. The NexStar extraction defect — 21% of an org was mis-labelled (2026-08-30)

Q, reading the April 12 2025 San Jose results: *"nexstar has serious parsing
errors … 'SDA Regional Champion - Level 3 12 & Over Grand Lines' only has one
entry first place, after it in the PDF is Artistic Excellence Award, then
Battle on the Seas - Group, etc, but the latter ones all wrong classified into
'SDA Regional Champion' category."*

Confirmed and fixed. It was an **extraction** bug, not an import bug — the
corruption was already present in the reviewed txt files.

**Root cause.** `scripts/extract_nexstar_pdfs.js` recognised a results table
only when the header row began with `Place`. NexStar's named-special tables
award recipients rather than ranking them, so their header is just
`Routine Name | Studio` — no place column at all. Those headers were never
recognised, with two consequences:

1. The header line itself parsed as a **data row**, importing 412 awards whose
   routine was literally "Routine Name" and studio "Studio".
2. `currentSection` only advances when a header is recognised, so every real
   winner underneath **inherited the previous section's title**. On event 3253
   that put 57 unrelated awards under one Grand Lines champion heading.

**Scale.** 5,502 header artifacts and 25,981 mis-labelled awards — 21% of the
123k NexStar rows. 114 award types had never appeared in the database at all:
Artistic Excellence Award, Battle on the Seas, Cover Model, Excellence in
Choreography / Entertainment, Power Pak, Golden Tickets, and the DancerPalooza
/ WDP / Wild One scholarships.

**The repair** (`scripts/reconcile_nexstar_awards.js`) corrects award types
**in place** rather than delete-and-reinsert, so award ids and everything
hanging off them survive. Applied: 25,981 types corrected, 714 stale artifact
rows deleted (0 carried user data), 3,873 recovered awards inserted. The
reconciler now reports a fully clean, idempotent state.

**Why this section belongs in the award-policy doc.** The corrupted data had
already been written *into this policy*. The NexStar encoding rule carried the
comment *"the 15,758 NULL-place rows (~52/event) are the qualifier list, not
winners"* — a conclusion drawn from reading the corrupt rows. The real figure
is **64**. There was never a qualifier list; those rows were the named-special
awards, mis-filed. A curation decision that reads bad data inherits the bad
data's shape, and nothing downstream flags it.

**Second bug found while re-encoding.** The T2 division rule matched on the
word `level`, but NexStar names half its divisions by skill word ("Solos -
Advanced Senior (15-19)") or brand tier ("Super Stars Solos - …", "… -
Inspiring Stars"). That silently missed **13,785 division placements**, 36% of
the true total — the same keyword-vs-shape trap already fixed for the other
orgs. Now matched by routine-size shape; all 193 newly-included types were
reviewed as genuine division tables.

NexStar major awards after both fixes: **48,410** (was 31,726).

**What the fix made knowable.** The bug had erased the single most useful
signal NexStar publishes. Their booklets are self-classifying: a **scored**
award prints a `Place` column, a **discretionary or invitation** item prints
only `Routine Name | Studio`. That is a per-award primary-source classifier
that does not depend on prose rules — which matters, since the current rulebook
disposes of this entire population with one sentence ("Special awards,
scholarships and other accolades will be awarded throughout each event").
Restoring the layout restored the evidence, and the specials could then be
tiered from NexStar's own words rather than from their names:

- **Counted (T3):** Excellence in Technique Award (scored, ~1 per age band);
  Artistic Excellence Award and WOW! Award (~1/event, covered by the rulebook's
  *"Special Award Ribbons will be created by the judges"*).
- **Not counted — invitations:** Power Pak is *"Power Pak **Invitations** will
  be given to deserving dancers"*, and attending costs $1,000+ with a $500
  deposit. At ~23/event it is the least selective item in the org. Golden
  Tickets is a merit-gated nationals invitation — the Rainbow "NYC All Stars"
  ruling already settled that invitations are opportunities, not placements.
  Same for the WDP / DancerPalooza / Wild One / Wild About You scholarships
  (*"WILD Scholarships will be given to deserving dancers"*), Battle on the
  Seas, and Discovery Spotlight.
- **Not counted — nominations:** Cover Model and People's Choice **Nominees**.
  NexStar's own post: *"IF YOU RECEIVED A COVER MODEL NOMINATION … but you
  aren't finished yet!"* — nominees mail in headshots for one national winner.
  A nominee is pre-outcome by definition.

NexStar majors after tiering the specials: **49,537** (T1 6,270 / T2 38,530 /
T3 4,737).

**A ruling revised on evidence — NexStar choreography removed (Q, 2026-08-30).**
"All choreography awards count as major" was given because they are rare —
*"each level usually at most has one only, sometimes the whole event only has
one or two."* True at the orgs it was drawn from. NexStar's rules do promise 2
per event, but its booklets award **~19** (3,034 rows), while its structurally
identical sibling *Excellence in Entertainment* (~19/event) was never counted —
so NexStar was counting one twin and not the other. Shown the volume, Q:
*"nexstar choreography is not as significant then… let's remove that from
top_award."*

Implemented as a per-org opt-out on the common rule (`skipOrgs: ['nexstar']`)
rather than an UNFLAG in NexStar's own array — common rules run LAST, so an
UNFLAG there would simply be re-flagged. NexStar majors 49,537 → **46,503**
(T3 4,737 → 1,703). Every other org is untouched: 11,039 choreography awards
still count platform-wide, and the SDA siblings (Starpower, Revolution,
Believe, Imagine, DreamMaker) keep counting choreography AND entertainment
together through their own rule, which is internally consistent.

**The transferable lesson:** a rule can be right in general and wrong at one
org, and the tell is volume-per-event, not the award's name. Before applying
this rule to a newly-encoded org, check its per-event count — that is now
written into the rule's own comment.
