# Most Prestigious Awards by Organization — Reference

Compiled 2026-08-25 from each organization's **official rules/awards pages** (sources and
confidence noted per org). Purpose: a durable reference for which awards are genuinely
prestigious per org — for marking `awards.is_top_award` in the vocab editor
(`/admin/orgs/:id/award-vocab`), choosing marquee/Hall-of-Fame picks, and never again
confusing adjudication score bands or size categories with real awards.

**The golden rule:** every org has *adjudication bands* (Platinum, Diamond, First Place,
5-Star…) that EVERY routine earns based on its score — these are participation tiers, never
prestigious. Prestige lives in: **national grand champions, titles, Dancer-of-the-Year,
overall high-point rankings, and championship-finale wins.** Band names collide across orgs
with different rank positions (see the cross-org warnings at the bottom) — always resolve
per-org, never globally.

---

## KAR Dance Competition (dancekar.com)

**Top awards, ranked:**
1. **National Grand Champion** — Star Showcase at National Finals: top-5 groups/lines per
   level+age re-compete; one champion per division (26 divisions) gets cash + trophy.
   *In our DB:* award_type like `Primary Mini Group National Grand Champion` (winner rows
   `place='Winner'`; runner-up rows exist too — only Winner is the champion).
2. **National Title — Mr./Miss Dance** — entrants must be regional title winners/runners-up.
   Title pattern by age: Mr./Miss **Mini** Dance (5&U), **Petite** (6-8), **Junior** (9-11),
   **Teen** (12-14), **Mr./Miss Dance** (15-19, flagship) — offered per level.
   *In our DB:* award_type like `Elite Miss Dance`, `Intermediate Miss Teen Dance`.
3. **1st Overall High Point at National Finals** (per age+level; top 3 cash in most levels).
4. **Regional Title winner** (same Mr./Miss pattern).
5. **Regional Overall High Point** — *in our DB:* the `Top <Level> <Size> <Age>` award_types
   (e.g. `Top Elite Solo 15 - 19`) with place = 1st are regional/finals overall rankings —
   1st here is a real win; 8th is depth-of-field.
- Named specials: Studio of the Year, Choreographer of the Year, Future Star, Studio Spirit
  (nationals); Studio of Excellence, All Star Dancers Invitations, KAR Convention
  Scholarship, IDA awards, Judges' Choice (regionals).

**Adjudication bands (NOT prestigious), ascending:** First Place → Top First → Elite Top
First → Elite Ultimate Performance (Elite/Super Line/Production only). Legacy: High Second.
⚠️ At KAR "First Place" is the *lowest* band — never read it as a placement.

**Division vocab:** Levels INSPIRATIONAL (special needs) / PRIMARY / SECONDARY /
INTERMEDIATE / ELITE. Ages 5&U (Mini), 6-8 (Petite), 9-11 (Junior), 12-14 (Teen), 15-19.

**Sources:** dancekar.com/rules (2027), dancekar.com/competition/rules, legacy rules blog.
**Confidence:** high.

---

## Rainbow National Dance Competition (rainbowdance.com)

**Top awards, ranked:**
1. **National Grand Champion** — Grand Finalé Showcase at National Finals; top-5 re-compete
   per division (22 divisions), winner gets cash + trophy.
   *In our DB:* award_type like `Rising Starz Petite Group National Grand Champion`.
2. **National Dancer of the Year (DOY)** — gender-neutral title, `<Level> <Age> Dancer of
   the Year`; open to regional DOY winners/finalists; winners open the Grand Finalé.
   *In our DB:* award_type like `Rising Starz Junior DOY` (place `Winner`/`Finalist`).
3. **1st Overall High Point at National Finals** (per level+age).
4. **Regional Dancer of the Year.**
5. **Regional Overall High Point** — *in our DB:* `Top <Level> <Size> <Age>` award_types.
- Named specials: Top Studio Award, Studio/Choreographer of the Year, Future Star, National
  Most Photogenic, IDA awards, Graduating Senior Scholarship; also NYC All Stars / HDE All
  Stars invitations (invitation honors, mid-prestige).

**Adjudication bands (NOT prestigious):** current (2027): First Place → Top First → Elite
Top First → Elite Ultimate Performance (same parent company as KAR, identical wording).
**Legacy (~through 2026, appears in older scraped data):** High Gold → Platinum → Double
Platinum (+ `National` prefixes at Finals).

**Division vocab:** Levels LIMITLESS STARZ (special abilities) / STARZ OF TOMORROW (novice)
/ RISING STARZ / ELITE STARZ. Ages Mini 5&U, Petite 6-8, Junior 9-11, Teen 12-14, Senior 15-19.

**Sources:** rainbowdance.com/rules (2027), blog.rainbowdance.com/rules (legacy bands).
**Confidence:** high (medium on the exact year of the band-name change).

---

## Starpower Talent Competition (starpowertalent.com) — Star Dance Alliance

**Top awards, ranked:**
1. **World Dance Championship results** (SDA-wide season finale above brand nationals; entry
   via Golden Ticket or two regional 1sts; tiers "Top 10" / "Final Five"; the SDA's supreme
   title **Miss/Mr World Dance** is won there).
2. **National Title Champion — Mr./Miss Starpower** via the "Battle of the Title" at
   Nationals. Title ladder: Mini Mr./Miss (5&U), Little Mr./Petite Miss (6-8), Junior (9-11),
   Teen (12-14), Mr./Miss Starpower (15-19); Level 2 titles carry the **Premier** prefix.
   *In our DB:* category like `Title - Teen Miss Starpower`, `Premier Title - Junior Miss
   Starpower` (award_type is blank for most Starpower rows).
3. **"Battle of the Stars"** — Starpower's nationals championship finale; Victory Cup for
   Productions/Grand Lines (11&U, 12&O).
4. **SDA Regional Champion** (highest group per age; feeds SDA Power Rankings + Golden Ticket).
5. **Overall High Score / 1st Overall** within level+genre+age.

**Adjudication bands (NOT prestigious):** "adjudicated pin" per routine; Starpower doesn't
publish names in text — sibling NexStar ladder is the best proxy (see NexStar). Secondary.

**Division vocab:** Levels Showcase (L1) / Competitive (L2) / Elite (L3) + Extraordinary
Ability. Ages Mini 5&U, Petite 6-8, Junior 9-11, Teen 12-14, Senior 15-19, 20&Over.

**Sources:** starpowertalent.com/rules (2027), 2023 addendum + 2021 rules PDFs, 2019
national title winners PDF, battleofthestarsresults page.
**Confidence:** high on titles/structure; medium on pin names (proxy).

---

## Believe Talent Competition (believetalent.com) — Star Dance Alliance

**Top awards, ranked:**
1. **World Dance Championship** (same SDA pyramid; Golden Ticket → Top 10/Final Five;
   Miss/Mr World Dance above any Believe title).
2. **National Title winner** — "Premiere and Advanced Title Showdowns" at Nationals; names
   follow `[Premiere] <Age> Miss/Mr. Believe` (Premiere = Competitive level).
   *In our DB:* category like `Title - Teen Miss Believe`, `Premier Title - Junior Miss
   Believe`. (Exact "Miss Believe" strings confirmed via secondary source; official rules
   say "Title Competition".)
3. **Nationals championship finales** — "The Championships presented by Believe" (Elite) and
   "A Premiere Championships" (Competitive); Victory Cup for Productions/Grand Lines.
4. **SDA Regional Champion** + **BLV Golden Buzzer** (Believe-specific recognition).
5. **Overall High Score / 1st Overall** within level+genre+age.

**Adjudication bands (NOT prestigious):** SDA pin system, names unpublished; NexStar ladder
is the proxy. **Division vocab:** identical to Starpower (SDA).

**Sources:** believetalent.com/rules (2027), SDA-2024 rules PDF, /nationals/, studio blog
(title strings, secondary). **Confidence:** high structure; medium title strings.

---

## Revolution Talent Competition (revolutiontalent.com) — Star Dance Alliance

**Top awards, ranked:**
1. **Miss/Mr. World Dance** (SDA apex, at WDC via Golden Ticket).
2. **National Title — Miss/Mr. Dance America** via "Title Showdown" (Level 3; + 1st/2nd
   Runners Up). Regional ladder: Mini Miss/Mr. (5&U), Petite Miss/Little Mr. (6-8), Junior
   (9-11), Teen (12-14), Miss/Mr. Dance America (15-19); Level 2 = **Premier** prefix.
   *In our DB:* category like `Title - Miss Dance America`, `Premier Title - Teen Miss
   Dance America`.
3. **Victory Cup** at "The Battle of Champions" (Championship Finals; highest combined
   group/line score per age, Level 3; Level 2 = **Premier Cup**).
4. **Battle of Champions placements** (top-5 re-compete, 1st–5th).
5. **Nationals High Score Top 10** (+ Star Dollars), then **SDA Regional Champion**, then
   regional Top 10s.

**Adjudication bands (NOT prestigious), ascending ("MEDAL system"):** Honorable Mention →
Bronze → Elite Bronze → Silver → Elite Silver → Gold → Elite Gold → Platinum →
**REVOLUTIONARY** (Level 3 only, 295-300).

**Division vocab:** Levels L1/L2/L3 + R.E.A.L. (special needs). Ages Petite 8&U, Junior
9-11, Teen 12-14, Senior 15-19, Adult 20+. Entries up to Grand Line/Production.

**Sources:** official 2024 Revolution Rules PDF (site 403-blocks fetches).
**Confidence:** high (2024 season doc).

---

## Imagine Dance Challenge (imaginedancechallenge.com) — Star Dance Alliance

**Top awards, ranked:**
1. **Miss/Mr. World Dance** (SDA apex; Golden Tickets at each Imagine regional).
2. **National Title Competition winner** per age (5&U/6-8/9-11/12-14/15-19). ⚠️ Official
   language is just "Title" — "Miss/Mr Imagine" is NOT attested on the official site, yet
   *our DB* has category strings like `Title - Miss Imagine` (likely results-page display
   naming; treat the strings as real data but the branding as unverified).
3. **Championship Finale Show** with Victory Cup (Productions/Grand Lines).
4. **Overall High Score awards** (level+genre+age; Elite only for prize money).

**Adjudication bands (NOT prestigious), ascending ("adjudicated pin"):** 4 Stars → 4¼ → 4½
→ 4¾ → 5 Star → **5 Star Elite** (Level 3 only, 295-300).

**Division vocab:** Showcase (L1) / Competitive (L2) / Elite (L3) / Extraordinary Ability.
Ages Mini 5&U, Petite 6-8, Junior 9-11, Teen 12-14, Senior 15-19, 20&Over.

**Sources:** imaginedancechallenge.com/rules (2025-26), official Scoring System PDF,
SDA-2024 rules PDF. **Confidence:** high mechanics; low on public title branding.

---

## DreamMaker Dance Competition (dreammakerdance.com) — Star Dance Alliance

**Top awards, ranked:**
1. **Title Competition winners** (Competitive + Elite soloists; ages 5&U/6-8/9-11/12-14/
   15-19). Official site does NOT use "Miss/Mr DreamMaker"; the only named title in its
   rules is the SDA crown **Miss/Mr. World Dance**. *Our DB* nonetheless has category
   strings like `Title - Teen Miss DreamMaker` — same situation as Imagine.
2. **Golden Ticket Invitations** → World Dance Championship (Top 10 / Final Five there).
3. **Overall High Score awards** (level+genre+age; soloists place once).
4. Category 1st Place per age+category.

**Adjudication bands (NOT prestigious):** "adjudicated pin"; tier names unpublished
officially; secondary sources show star tiers topping at "5 Star Elite".

**Division vocab:** Showcase (L1) / Competitive (L2) / Elite (L3) + Extraordinary Ability;
only Elite eligible for title/prize money. Ages Mini 5&U → Senior 15-19, 20&Over.

**Sources:** dreammakerdance.com/rules, stardancealliance.com; secondary press.
**Confidence:** medium (pins low).

---

## NexStar National Dance Competition (nexstarcompetition.com) — Star Dance Alliance

**Top awards, ranked:**
1. **WDC Final Five / Top 10** (Golden Tickets or 1st at 2+ regionals).
2. **Miss/Mr. World Dance** (SDA apex).
3. **"The Big Show"** at Nationals — **Victory Cup** (Elite; combined groups/lines per age +
   Grand Lines) and **Premier Cup** (Level 2).
4. **National Title Champion** via "Title Showdown" (top-5 re-compete; Champion + runners-up).
   Titles are "Title Champions" in **Miss** and **Mister** divisions. UPDATE 2026-08-25: our
   imported results DO brand them — award_type like `Elite Title - Teen Miss Nexstar`,
   `Premier Title - Petite Miss Nexstar`. Ages 5&U/6-8/9-11/12-14/15-19.
5. **National High Score** (Top 20 solos, Top 10 others; Star Dollars for Elite), then SDA
   Regional Champion, regional Top 10s, specials (Photogenic, Costume, Vocalist…).

**Adjudication bands (NOT prestigious), ascending (2023 PDF):** Honorable Mention → Bronze
→ High Bronze → Silver → High Silver → Gold → High Gold → Platinum → **Diamond** (Elite
only, 295-300). This ladder is also the best proxy for Starpower/Believe pins.

**Division vocab:** Showcase (L1) / Competitive (L2) / Elite (L3) / Extraordinary Ability
(2023 naming: Novice/Intermediate/Level 3 — treat as equivalent). Ages Mini 5&U → Senior
15-19, 20&Over; Grand Line 11&U / 12&O.

**Named specials — RECOVERED 2026-08-30.** Until the extractor fix (see
docs/major_award_policy.md §11) these 114 award types were invisible: their
results tables have no place column, so the extractor mis-filed every one of
them under whichever ranked section preceded them. They are now imported under
their real names, all with NULL place (recipients, not ranked placements).
Volume across ~305 regional events:

| award | rows | ~per event |
|---|---|---|
| Power Pak | 6,911 | 23 |
| Excellence in Choreography | 3,001 | 10 |
| Excellence in Entertainment | 2,979 | 10 |
| DancerPalooza $150 Scholarship | 965 | 3 |
| Wild One Scholarship | 928 | 3 |
| Battle on the Seas (Solo 862 / Group 439) | 1,301 | 4 |
| Cover Model | 855 | 3 |
| Discovery Spotlight | 516 | 2 |
| WDP $100 Scholarship | 493 | 2 |
| Power Pak $250 / $100 Scholarship | 800 | 3 |
| Wild About You Award | 424 | 1.4 |
| WOW! Award | 422 | 1.4 |
| People's Choice **Nominees** | 364 | 1.2 |
| Artistic Excellence Award | 240 | 0.8 |
| Golden Tickets - `<Level> <Age>` | ~150-250 each | — |

**The layout IS the classifier — NexStar's most useful structural fact.** Their
booklets are self-documenting: a **scored** award prints a `Place` column; a
**discretionary / invitation** item prints only `Routine Name | Studio`. This
is a per-award primary-source signal that does not depend on the prose rules —
which matters, because the current rulebook covers this whole population with
one catch-all sentence: *"Special awards, scholarships and other accolades will
be awarded throughout each event."* It is also exactly the distinction the
extractor bug erased, which is why the specials could not be tiered until the
fix restored it.

**Tiering (researched 2026-08-30 against the rulebooks + the booklets):**

| award | verdict | tier |
|---|---|---|
| SDA Regional Champion, Premier/Elite Title | competitive, scored | T1 (already) |
| Division tables (size + level/age) | competitive, scored | T2 (already) |
| Costume Award | named special, scored | T3 (already) |
| **Excellence in Technique Award** | competitive, scored, ~1 per age band | **T3 (added)** |
| **Artistic Excellence Award**, **WOW! Award** | judge-created, ~1/event | **T3 (added)** |
| Excellence in Choreography / Entertainment | named special but **~19/event** | choreography T3 by Q's ruling; entertainment uncounted — see caution |
| Power Pak (+ its scholarships) | **invitation to a paid intensive** | not counted |
| WDP / DancerPalooza / Wild One / Wild About You | scholarships ("given to deserving dancers") | not counted |
| Battle on the Seas, Discovery Spotlight | opportunity | not counted |
| Golden Tickets | merit-gated nationals **invitation** | not counted (Rainbow "All Stars" precedent) |
| Cover Model, People's Choice **Nominees** | **nomination only**, pre-outcome | not counted |

The load-bearing quotes: *"Power Pak **Invitations** will be given to deserving
dancers…"* (attending costs $1,000+ with a $500 deposit — an invitation to buy
a place, not a win); *"Special Award Ribbons will be **created by the judges**"*
(the umbrella over WOW!/Artistic Excellence); and, from NexStar's own social
post, *"IF YOU RECEIVED A COVER MODEL NOMINATION … **but you aren't finished
yet!**"* — nominees then mail in headshots for one national winner.

⚠ **Open question for Q — the choreography ruling's premise does not hold
here.** The ruling ("all choreography awards count; each level usually has at
most one, sometimes the whole event has one or two") was given on the
understanding that they are scarce. NexStar's rules do promise 2 per event, but
the booklets show **~19 per event**, and its identical sibling *Excellence in
Entertainment* (~19/event) is not counted. So NexStar currently counts 3,034
choreography awards while excluding an equally-sized twin. Options: keep as-is,
drop NexStar's from the choreography rule, or count both. Not decided
unilaterally — the ruling is Q's.

⚠ **Excellence in Technique is being retired** — absent from the 2026 rules;
volume collapsed from ~58 (2025) to 2 (2026). Historical rows still count.

**Level vocabulary — three renamings of ONE ladder** (confirmed against our own
rows):

| seasons | beginner | intermediate | advanced |
|---|---|---|---|
| 2021-22 | Novice | Intermediate | Advanced |
| 2023-25 | Level 1 | Level 2 | Level 3 |
| 2026 | Showcase | Competitive | Elite |

- **Shining Stars / Super Stars are NOT skill levels or studio choices** — they
  are score-determined subdivisions of **Level 2 only** (2023+): **≥287.0 →
  Shining Stars, ≤286.99 → Super Stars.** Shining Stars is the *higher* band,
  which is counterintuitive and easy to rank backwards.
- **"Inspiring Stars" is UNVERIFIED** — in no NexStar/SDA rulebook 2021-2026,
  and only 122 rows here (vs 16,140 Super Stars). It occupies the level slot,
  but do not assume it maps to Level 1.

⚠ **Name collision:** `nexstardancecomp.com` is an unrelated organization
(NexStar Dance Competition presented by Rhythm Dance Group, Morrisville NC —
Indian classical/Bollywood/folk). Never merge it into org 13.

**Known residue (59 rows, 0.05%):** a few section titles rendered side-by-side
on one PDF row still merge into one string ("Excellence in
ChoreographyExcellence in Entertainment", banner text prefixed onto a division
name). Left as-is: 20 of them lose a T2 they should have, which is below the
noise floor of this dataset and not worth a riskier extractor change.

**Sources:** nexstarcompetition.com/dance-competition-rules (2025-26), NexStar 2023 Rules
PDF. **Confidence:** high structure; medium current thresholds.

---

## Showstopper (goshowstopper.com)

**Top awards, ranked:**
1. **Top Overall routine per age division at Finals** (their nationals; Competitive Level
   top overall reportedly $500 cash + $500 gift certificate — cash figures secondary).
2. **Overall High Score Top 10** (regional + Finals; 1st trophy, 2nd-10th medals).
3. **1st Place category winners** (cash at Competitive Level only).
4. **PRODUCTIONMANIA®** (Finals showcase — recognition, not ranked).

⚠️ **Showstopper has NO title competition and NO named grand champion.** Prestige = Top
Overall at Finals. *In our DB:* Showstopper award_type is uniformly `High Score` (65,347
rows) — the prestigious subset is place=1st rows, ideally at Finals events.

**Adjudication bands (NOT prestigious), ascending:** Silver → Gold → Platinum → Double
Platinum → **Crystal** (Competitive Level only). Rising Star program: 3/4/5-Star.

**Division vocab:** Levels Rising Star / Performance / Advanced / Competitive (highest) /
Shine (special needs). Ages Little 5&U, Mini 6-8, Junior 9-11, Teen 12-14, Senior 15-19.

**Sources:** goshowstopper.com/rules (2027), /competitions/finals/, Wikipedia.
**Confidence:** high (Finals cash medium).

---

## StarQuest Dance Competition (starquestdance.com)

**Top awards, ranked:**
1. **"Quest For The Best"** (World Finals, Select level: top-5 per division re-compete
   before 3 new judges — the marquee national win); **"Classic Dance-Off"** for Classic level.
2. **Apogee Awards** (Select/Classic Apogee; Nova Apogee at World Finals; Studio of
   Excellence variants — *in our DB:* `Studio of Excellence`).
3. **Title winners** — "Elite Dancer" (Select), "Classic/Nova Emerging Artist". *In our DB:*
   award_type `Title` (3,522 rows).
4. **Top Score awards** (regional ranked overalls — *in our DB:* award_type `Overall`,
   34,186 rows; 1st place = real win).
5. Specialized Top Scores (Vocalist, Parent, Adult, Progressive, Rising Star); Odyssey
   Awards (*in our DB:* `Teen/Junior/Senior Odyssey Award`).

**Adjudication bands (NOT prestigious), ascending (2027 ranges):** Gold (228-245.99) → High
Gold → Platinum → Platinum Plus → **Ultimate Platinum** (Select only, 291-300).
⚠️ At StarQuest, "Gold" is near the BOTTOM.

**Division vocab:** Levels Nova / Classic / Select. Ages Mini 5&U, Petite 6-8, Junior 9-11,
Teen 12-14, Senior 15-18, Progressive 19-24. Nationals = "World Finals".

**Sources:** starquestdance.com/2027-awards, /2027-rules, /rules. **Confidence:** high.

---

## NYCDA — New York City Dance Alliance (nycdance.com)

**Top awards, ranked:**
1. **National Outstanding Dancer Award** (2 per age division: National Mini/Junior/Teen/
   Senior Outstanding Dancer; composite score across gala solo + classes + audition;
   Senior = $1,000 + lifetime convention scholarship; Runners-Up announced).
2. **Regional Outstanding Dancer Award** (2-3 per division per city; feeds Nationals).
   *In our DB:* award_type `Outstanding Dancer` (10,307 rows) — winner vs runner-up vs
   finalist distinction lives in place/category.
3. **National Critics' Choice** ($2,500/division; regional Critics' Choice = one
   group/line/production per division). *In our DB:* `Critics' Choice Winner`.
4. **Overall High Score awards** (top solo + group per division). *In our DB:* `Overall`
   (441 rows) — the genuinely top subset of the generic `High Score` mass (30,417 rows).

**Adjudication bands (NOT prestigious), ascending:** Bronze → Silver → High Silver → Gold →
High Gold → Platinum. (NYCDA's "Platinum" is a band, not an award.)

**Division vocab:** Mini 7-10, Junior 11-12, Teen 13-15, Senior 16-19; Regionals →
National Season Finale.

**Sources:** nycdance.com outstanding-dancer + competition-guidelines pages (regional +
national). **Confidence:** high.

---

## Spotlight Dance Cup (spotlightevents.com)

**Top awards, ranked:**
1. **Spotlight Title Winner** — one gender-inclusive winner per age category (Future Gems +
   Elite Gems soloists; score + on-stage interview; no Miss/Mr naming; nationals = "The SDC
   Title Experience"). *In our DB:* category strings ending `~ Title` (e.g. `Future Gems ~
   Petite ~ Title`) — note performance_name on title rows is often the DANCER's name.
2. **Overall (High Point) Awards** ranked 1-20 per division/group size. *In our DB:*
   award_type `Overall` (12,664 rows); place values are gem words (DIAMOND etc.) on
   adjudication rows — the Overall rows with numeric ranks are the real ranking.
3. **Dance Down winners** (elimination improv; Future Gems / Junior 12&U / Senior 13-19).
4. **Spotlight Awards** (judges' specialty: Showmanship, Technical Skill, "A Cut Above"…).

**Adjudication bands (NOT prestigious), ascending:** Sapphire → Emerald → Ruby → **Diamond**
(gems are score bands — a "Diamond" is not a win).

**Division vocab:** Levels Novice/Future/Elite/Flawless Gems; ages Petite 8&U, Junior 9-11,
Teen 12-14, Senior 15-19.

**Sources:** spotlightevents.com/rules, /nationals. **Confidence:** high (nationals names medium).

---

## Youth America Grand Prix — YAGP (yagp.org)

**Top awards, ranked:**
1. **Grand Prix Award** ($10,000; Senior division; jury consensus across Classical +
   Contemporary — must compete both).
2. **Youth Grand Prix Award** (Junior division).
3. **Hope Award** ($1,500; Pre-Competitive division).
4. **1st/2nd/3rd Place** per age division per category (Classical / Contemporary; Pas de
   Deux, Ensembles). *In our DB:* place values like `1ST PLACE (TIE)`; award_type
   `Ballet`/`Contemporary`; category `CLASSICAL DANCE CATEGORY - WOMEN` etc. — "Pas de
   Deux" is a CATEGORY, and the award is the placement within it.
5. **Top 12** (and Top 24 in results) — genuine finalist tiers: ⚠️ YAGP has NO adjudication
   bands, so "Top 12" is prestigious here, unlike tier names elsewhere.
6. Named specials at Finals: Makarova Award for Artistry, Shelley King Award, Outstanding
   Choreographer, Outstanding School.

**Division vocab:** Pre-Competitive 9-11, Junior 12-14, Senior 15-20; Regional Semi-Finals
→ NYC Finals.

**Sources:** yagp.org rules-and-regulations, 2023 rules PDF, 2026 Finals cash awards PDF.
**Confidence:** high.

---

## Encore (encoreperformingarts.com) — identity VERIFIED 2026-08-25

**Status (2026-08-25):** 63 studio-bearing events (2023–2026, 24,988 awards) are IMPORTED on
local + prod; the 8 studio-less events (2022 era) are held pending attribution from Encore. The queue at `tobeprocessed/pdf/oncore/` (note the
"oncore" spelling — the downloader's slug, vs. the org row's slug `encore`; the future
importer must bridge that) holds **71 results PDFs, 2022–2026, sourced from DanceBug S3**,
and every sampled PDF's own header reads **"Encore Performing Arts Showcase, Inc."** with
Division 1/2/3 + Mini/Petite/… vocabulary matching this rulebook. The org row's website is
correct. Two OTHER US "Encore" competitions exist and must never be conflated:
- **Encore DCS** (encoredcs.com) — East-coast tour; Elite-only "Mic Drop" top award; Grand
  Finals in Sevierville TN; "Encore Extreme" convention arm.
- **Encore Talent Productions** (encoretalentproductions.com) — Circleville OH, ~4 regionals
  (OH/WV) + Cincinnati nationals; bands Gold → High Gold → Platinum → Double Platinum →
  "Encore Star"; titles "Miss/Mr National Encore".

**Top awards (Encore Performing Arts), ranked:** 1. Grand Champion (National Finals, per age
category per Division). 2. Best of Show (National Finals, one per Division + Production).
3. Performer of the Year (per age level). 4. National Title: **Miss/Mr Encore** (Mini,
Petite, Junior, Teen, Senior). 5. National (Overall) Top Scoring Studio. 6. Regional:
Overall High Score, Division Champion, Top Scoring Studio, Photogenic/Cover Model.

**Adjudication bands (NOT prestigious), ascending:** High Gold → Ultra High Gold → Platinum
→ **"Can I Get an Encore!"** (292.50-300). ⚠️ "High Gold" is Encore's LOWEST band.

**Division vocab:** Division 1/2/3 (+ Dance without Boundaries); ages Mini 6&U → Senior 16-19.

**Sources:** encoreperformingarts.com /info/rules/, /titleawards/, 2026 national finals
results. **Confidence:** high (award precedence medium).

---

## Epic Dance (epicdanceinc.com)

Regional-only tour. **No nationals, no titles, no grand champion, no named adjudication
bands** (verified absences in the full rules text).

**Top awards, ranked:** 1. Studio Overall (cash; highest-scoring Advanced group routines of
the weekend). 2. Overall/High Score Awards (top 1/3/5/10 scaled by entries). 3. Scholarship
Awards. 4. Specialty (Performance, Curtain Call, Costume, Choreography, Technique, Photo).

**Division vocab:** Novice/Intermediate/Advanced; Mini 8&U, Junior 9-12, Teen 13-15,
Senior 16-19. **Sources:** epicdanceinc.com/rules. **Confidence:** high.

---

# Cross-org warnings (the traps)

1. **Band names collide with different ranks.** "Platinum" = 2nd-highest at Encore,
   mid-ladder at NexStar/Revolution, top band at NYCDA, 3rd of 5 at StarQuest, 3rd of 5 at
   Showstopper. "High Gold" = Encore's lowest but NexStar's 3rd-highest. "Gold" = near-bottom
   at StarQuest. "Diamond" = Spotlight score band AND NexStar top pin. Resolve per org.
2. **"First Place" is KAR/Rainbow's LOWEST adjudication band** — but a genuine placement
   everywhere else (and in KAR/Rainbow's own "Top X" overall rankings). Context decides.
3. **Size/format categories are not awards:** Grand Lines, Line, Production, Pas de Deux,
   Small/Large Group — these name the entry type. "Grand Lines" burned us once already.
4. **Every Star Dance Alliance brand** (Starpower, Believe, Revolution, Imagine, DreamMaker,
   NexStar) shares: Title Showdowns (Miss/Mr <Brand>-style or generic "Title Champion"),
   Victory Cup / Premier Cup finales, Golden Tickets → World Dance Championship (Top 10 /
   Final Five), Miss/Mr World Dance as the shared apex, Star Dollars, SDA Power Rankings.
   WDC awards can surface in any SDA brand's results.
5. **KAR and Rainbow share a parent company** — identical rules language; Rainbow's DOY =
   KAR's Mr./Miss Dance titles structurally; both crown National Grand Champions via a
   top-5 re-compete showcase.
6. **Title rows may carry a dancer's name in the routine field** (seen at Spotlight; watch
   for it elsewhere) — don't surface those as "routine titles" in marketing.
7. **Prestige shorthand per org** (what to mark `is_top_award` first):
   KAR/Rainbow → `% National Grand Champion` winners + national titles/DOY winners.
   SDA brands → `Title - %` / `Premier Title - %` winners + Victory Cup + WDC results.
   Showstopper → 1st-place Top Overall at Finals events.
   StarQuest → Quest For The Best; `Title` winners; Apogee.
   NYCDA → `Outstanding Dancer` (national first), `Critics' Choice Winner`, `Overall`.
   Spotlight → `% ~ Title` winners; Overall rank-1.
   YAGP → Grand Prix / Youth Grand Prix / Hope; 1st places; Top 12.
   Encore → Grand Champion, Best of Show, Miss/Mr Encore (after identity check).
   Epic → Studio Overall; Overall 1st places.

## ADC IBC (Youth International Ballet Competition — adcibc.com)
- **Top award: ADC Grand Prix** — one per age division, FINALS ONLY. Senior (15-21) $2,000,
  Junior (12-14) $1,000, Primary (9-11) $500. Published in results as "ADC|IBC Grand Prix Recipient".
- **Finals ladder ranks the WHOLE age division** (male/female ranked separately), under
  "ST. PETERSBURG FINALS / TOP PLACEMENTS": `GOLD MEDAL` → `SILVER MEDAL` → `BRONZE MEDAL`
  → `4TH PLACE` → `5TH PLACE` → flat honorable-mention band `TOP 25` (female) / `TOP 10`
  (smaller male divisions).
- ⚠️ **ADC medals are RANK, not score bands**: Gold = 1st, Silver = 2nd, Bronze = 3rd — one
  each per division. (Contrast UBC below, where Gold is the *third* tier and unbounded.)
  No score-threshold table is published; the only sharing clause is discretionary ("The Jury
  reserves the right … to divide any award between more than one competitor").
- Ensemble divisions rank `1ST`–`5TH PLACE` in CLASSICAL PAS DE DEUX / DUET|TRIO / LARGE ENSEMBLE.
- **Semi-finals are an audition tour**, not a ranking of the division: placements are per
  category (classical vs contemporary, scored separately); ~15-30 soloists per city advance.
- Special awards (finals, all discretionary): Top Scoring Ensemble Division ($1,000), Round I
  Jury Award, Traditional Excellence, Avant Garde, Jury Encouragement, Outstanding International
  Dancer, Outstanding Choreographer, Outstanding Coach, Outstanding School, and the
  **Fernando Bujones Living Memorial Award** (package >$1,000 + direct finals entry next year).
  2026 results also show a SMACK Arts Photographer Award (not a dancer award).
- Site publishes World Finals only; ~10 regional semi-finals per season unpublished — the outreach ask.
- **Sources:** adcibc.com/awards-prizes, /rules-regulations-2027, /semi-finals-format,
  /finals-format, /how-to-join, /2026-winners (verified 2026-08-30).
- **Confidence:** high. Not verified: numeric score thresholds (none published), the full
  semi-final award schedule, whether Top 25/Top 10 band size is fixed by rule or entry count.

---

## Universal Ballet Competition (UBC — universalballetcompetition.com)
- **Top award: "The Grand UBC Award"** — one Junior + one Senior per event, judge-selected,
  "deemed to have surpassed all other dancers in their division in both classical ballet and
  contemporary dance categories"; a dancer must enter BOTH a classical and a contemporary solo
  to qualify. ⚠️ **Correction (2026-08-30):** this file previously said "Top award: Grand Prix
  Finals 1st place". Wrong — **"Grand Prix" is the NAME OF THE FINALS EVENT**, not an award.
- ⚠️ **UBC medals are SCORE THRESHOLDS, not ranks.** "Each competitor will receive a medal for
  their adjudicated scores" — every dancer gets one and unlimited dancers share a tier.
  Out of 300, cutoffs differ by level (Intermediate / Competitive):
  UBC Platinum 276-300 / 282-300 · High Gold 265-275 / 270-281 · Gold 255-264 / 260-269 ·
  High Silver 244-254 / 250-259 · Silver 228-243 / 235-249. ("Bronze" is named in prose but
  has NO published row.) **A UBC "Gold" is the third tier down — NOT a first place.**
- **The ranking layer is separate:** "high score awards will be given to the top scores in each
  category within an age division" — inside category × level × age, NOT division-wide. Depth is
  unstated ("top scores"); results exports rank 15+ deep. A dancer can't take both 1st and 2nd
  in one category (highest solo counts).
- INT = Intermediate, COM = Competitive: skill LEVELS, never awards. Age divisions:
  Pre-Competitive 7-8, Primary 9-11, Junior 12-14, Senior 15-21.
- Finals gating (the two official pages disagree — flag both): /rules says "high gold or UBC
  Platinum" qualifies; /grand-prix says "Platinum or above". Intermediate soloists may not
  qualify for finals (finals solo sections are all COM).
- Named specials: **NOT FOUND** — only a discretionary list (cash, scholarships, contracts…).
  Data source: the registration backend publishes every event incl. regionals, so no outreach
  ask is needed for regional data.
- **Sources:** universalballetcompetition.com/rules/, /grand-prix/, /sponsors/, and the public
  results export api.reg.universalballetcompetition.com (verified 2026-08-30).
- **Confidence:** high on rules; medium on finals-specific awards (finals page lists none).
  Not verified: Bronze score range, whether the Grand UBC Award is given at regionals too,
  depth of "high score awards".

---

## Hollywood Vibe (hollywoodvibe.com) — verified 2026-08-30
- **Tier 1 — "Dancer of the Year"**: judge-selected per Junior/Pre-Teen/Teen/Senior convention
  level, based on workshop work AND competition performance (independents ineligible at
  regionals). At finals it becomes **National Dancer of the Year** (regional scholarship winners
  are invited; scored 33% solo / 33% class etiquette / 33% audition, then a two-round dance-off).
- **Tier 2 — "Overall High Score"** (Solo / Duo-Trio / Groups, per age division): **Top 3 awarded
  with 5+ entries, Top 5 with 10+**. Must be contested. A soloist winning Overall High Score in
  one city may not re-compete that solo in another regional.
  ⚠️ Distinct from **category trophies** (1st-3rd per age × performance category, needing 5+
  entries) — those are narrow-category placements, NOT division overalls.
- **Tier 3 — "Judges Specialty Awards"**: Outstanding Choreography, Most Entertaining, Best
  Costume, Best Direction (group routines). Scholarship track (separate audition): LA Agency
  Award, Team Hollywood Vibe, National Finals, Hollywood Vibe, Excellence, CLI Conservatory.
- ⚠️ **BANDS (exclude) — and the top one is named like an award:** **`Vibe Award` 100-97.5%**,
  Platinum 97-94.5, High Gold 94-91.5, Gold 91-88.5, High Silver 88-85.5, Silver 85-82,
  Bronze 81-79. Gold-and-higher qualifies for finals. "Medals are awarded to soloists indicating
  their score" — medals here are bands, not ranks.
- **Nationals = Hollywood Invitational** (Orlando + San Diego): National Dancer of the Year,
  **Battle of the Stars** (top group per age division; winner $2,500), LA Agency Award final,
  Pathways in Motion, Film Festival, Spotlight Battle, Closing Night Gala.
- Age divisions: Mini 5-7, Junior 8-10, PreTeen 11-12, Teen 13-14, Senior 15-18, Pro-Am 19+.
- **Sources:** hollywoodvibe.com/competition/, /scholarships/, /faq/; hollywoodinvitational.com
  /pages/dancer-of-the-year, /pages/battle-of-the-stars (verified 2026-08-30).
- **Confidence:** high. Not verified: cash amounts ("may vary"), whether Judges Specialty Awards
  run at nationals under the same names (results page not yet posted).
- Platform: MyDanceRegister.

---

## DanceOne conventions — JUMP / NUVO / RADIX / 24SEVEN (verified 2026-08-30)

**One shared anatomy, four brand vocabularies.** All four publish the same
"PLACEMENT AWARDS" structure; only the names change.

- **Tier 2 — division-wide overalls (`HIGH SCORE BY AGE` in our data):** "a competitive 1st,
  2nd or 3rd Place award … to the highest scoring Solo, Duo/Trio, Group, Line, Extended Line
  and Production, in each of the [youngest], Mini, Junior, Teen, Senior, and Open age
  categories." Solos are published **10 deep**; groups 3 deep. Top-10 soloists are recognized
  on stage.
- **Narrower style tier (`HIGH SCORE BY PERFORMANCE`):** same 1st/2nd/3rd but per style
  (Jazz, Ballet, Tap, …) within an age division — a category ranking, not a division overall.
  RADIX combines ages here (Rookie, Mini/Junior, Teen/Senior).
- **Judges'-choice routine award (Tier 3):** JUMP **Best of JUMP** · NUVO **Best Nu Group**
  (their own page also writes "Best of Nu Group" — inconsistent) · RADIX **Best of RADIX** ·
  24SEVEN **11 O'Clock Number**. All "most technical AND entertaining", by judge consensus.
- **Per-studio award (Tier 3):** Best in Studio / Studio Pick / Studio Standout / Studio
  Showcase (+ 24SEVEN's **Well-Rounded Studio Award**). Needs ≥15 entries (≥7 groups); may or
  may not be the studio's highest score.
- ⚠️ **ADJUDICATION BANDS — NEVER awards, and they read like awards:**
  **YOU ROCKED JUMP!** (JUMP) · **DJ'S PICK!!** (NUVO) · **ON THE EDGE!** (RADIX) ·
  **STOP THE CLOCK!** (24SEVEN) — each is simply the 291-300 band. Below them:
  Palladium 282-290 (new this season, all four), High Gold 273-281, Gold 264-272,
  High Silver 255-263. Anything matching these names is a score tier every entry receives.
- ⚠️ **The huge `SCHOLARSHIP` row counts are NOT routine awards** (JUMP 50,636; 24SEVEN 42,975).
  They are class/workshop scholarships attaching to dancers: VIP (JUMP), Breakout Artist
  (NUVO), Non-Stop Dancer (24SEVEN), Protégé (RADIX), plus Class/Rockstar/StandOut/Die Hard/
  Cutting Edge/Choice Artist/High 5/Weekend Warrior. **No Mr./Miss titles exist at JUMP, NUVO
  or 24SEVEN** — the top scholarship tier is the qualifying path to a title elsewhere.
- **Season enders differ:** JUMP, NUVO and 24SEVEN end at **The Dance Awards** (their
  Winner/Runner-Up scholarship holders qualify for Best Dancer). **RADIX ends at its own
  THE ONE Nationals** (theonenationals.com) with **Elite Protégé** 1st-4th, **THE FINAL CUT
  (Top 6)**, **Top 15**, **BEST IN SHOW**, **BEST OF RADIX** by division, and
  **[Age] NATIONAL TOP SOLOIST**.
- Solo lockout (all four): a soloist taking 1st Place in one city may not compete that solo at
  another city of the same brand that season — relevant to any repeat-placement weighting.
- **Sources:** jumptour.com/competition-info/ + /scholarship-info/ + /results/?id=2306;
  gonuvo.com/competition-info/ + /scholarship-info/; radixdance.com/competition-info/ +
  /protege-info/ + /scholarship-info/ + /2025-nationals-winners/;
  24sevendance.com/competition-info/ + /scholarship-info/ (verified 2026-08-30).
- **Confidence:** high for regionals. Medium for RADIX Nationals (names taken from a results
  page; the rulebook lives on theonenationals.com). NUVO/24SEVEN results labels unverified
  (JS-loaded index).

---

## Inspire National Dance Competition (inspirendc.com) — verified 2026-08-30
- **Tier 1 — "Title Competition"** (Miss/Mr): open to all levels, males judged separately;
  regional winners get Trophy + Tiara (Miss) / Crown (Mr) + scholarships. Scored On-Stage
  Introduction 30% + Solo 70%. Winners AND runners-up qualify for the **National Title**
  (Audition 30% + Solo 70%). Labels in results: `Title`, `Title Runner-Up` — no branded
  "Miss Inspire" string exists. "The Title competition… does not impact overall scores."
- **Tier 2 — "Overall Awards"**: top-scoring entries per level × age × entry type. **Depth is
  the director's call by entry count — Top 20, 18, 15, 12, 10, 8, 5, 3, or 1st only.** Only a
  dancer's top-scoring solo may place. Inspiring GEMS (adaptive) and Pro/Am are excluded from
  overalls; Vocal has its own.
- **Tier 3:** Judge's Choice & Choreography Awards; **Top Performers by Age & Genre** (8 named
  `Top <Genre> Performance` awards, 5+ entries); Top Score of the Session; **Golden Egg Award**
  (+ Wild Cards); Inspire All-Stars; Photogenic / Face of Inspire; Costume Award. Studio awards:
  Studio of Excellence, Most Entertaining Studio, Studio Spirit, Studio Sportsmanship.
- ⚠️ **BANDS (exclude) — Inspire's own prose calls them "awards"**, and `Flawless Gem` reads
  like an honor: Flawless Gem / Crystal Diamond / Diamond / Sapphire / Emerald / Ruby, with
  different score ranges per level (out of 300; e.g. Comp Elite Flawless Gem 295-300, Crystal
  Diamond 282-294.9). Crystal Diamond/Diamond/Sapphire qualifies a routine for Nationals.
- **Levels:** Recreational / Competition / Competition Elite (+ Inspiring GEMS, Pro/Am) —
  levels, not awards. Ages: Mini 6&U, Petite 7-8, Junior 9-11, Teen 12-14, Senior 15-19, Adult 20+.
- **Nationals-only:** National Title; **Crystal Showcase** + Championship (top 3-6 solos, 2-4
  duo/trios, 3-5 groups invited back); Top Score of the Showcase; **Golden Ticket** (+ Wild
  Cards) — the nationals analogue of the regional Golden Egg; Inspire Improv; All-Star classes.
- **Sources:** inspirendc.com/rules/, /nationals/, /all-stars/, /face-of-inspire/ (verified
  2026-08-30; site 403s generic fetchers — use a browser user-agent). Platform: DanceCompGenie.
- **Confidence:** high. Not verified: which Title age groups carry scholarships; cash amounts;
  per-event overall depth (director's determination, not a fixed table).

---

## Tremaine Dance Conventions & Competitions (tremainedance.com)
- **Top awards (both FINALS ONLY):**
  1. **Dancers of the Year (D.O.T.Y.)** — 10 titles per year at National Finals across five
     TITLE age divisions (Junior 7-10, Pre-Teen 11-13, Teen 14-15, Senior 16-18, Pre-Pro 18-21;
     these differ from competition divisions). Won by audition + cuts + personal interview,
     NOT by competition score. Prerequisite: qualified at a Semi-Final or named MVP Dancer.
  2. **Tremaine Performance of the Year** — top 15 highest-scoring routines from different
     studios perform at the Gala; celebrity honorees pick the winner.
- ⚠️ **"1st Place" at Tremaine is a SCORE BAND, not a rank**: 1st 97-100, 2nd 93-96.99,
  3rd 89-92.99, 4th 85-88.99 (100 pts/judge: 40 technique, 25 choreography/musicality,
  10 costuming, 25 overall). Many 1st Places exist per event.
- **Placements are per NARROW category** — Age Division × Category Size × Dance Style — so they
  are NOT division-wide overalls. The division-wide honors are **High Score** and **Judges
  Ovation** plaques (per age division × category size, style-agnostic).
- **National Finals adds a true rank ladder:** GOLD / SILVER / BRONZE National High Score
  (highest / 2nd / 3rd scoring number per age division — 1 solo, 1 duo/trio, 1 group-line-production),
  with monetary prizes; Gold soloists perform in the Faculty Show.
- Other named awards: Teacher of the Year (T.O.T.Y.), Entertainer of the Year + Legendary
  Entertainer of the Year, National Judge's Choice Ovation, Shining Star Award (studio etiquette),
  National Freestyler of the Year; scholarships (MVP National, Freestyle Face-Off, Tap, Hip Hop,
  Mini Room, Parent Forum, Convention, Year-Long Convention).
- **Three separate competitions**: Semi-Finals (Oct-May; 1st-4th trophies, High Score, Judges
  Ovation; qualifying = place 1st-4th, or High Score/Judges Ovation, or score ≥96.0),
  Summer Competitions (June-July; trophies + registration credits, explicitly a dead end —
  "Winners do not qualify for any other competition"), and National Finals (Orlando, July).
- Importer note: the rules page lists FOUR competition age divisions (Junior, Pre-Teen, Teen,
  Senior); a winners page lists three — the rules page is authoritative, the winners page stale.
- **Sources:** tremainedance.com/registration-info/competition-information/, /national_finals/,
  /winners/how-to-audition/, /scholarship-info/, /winners/toty/, /winners/entertainers-of-the-year/
  (verified 2026-08-30).
- **Confidence:** high. Not verified: the 2026 finals winners PDF is image-only (couldn't confirm
  how names render in published results); monetary amounts never stated.

---

## The Dance Awards (thedanceawards.com) — verified 2026-08-30
Break The Floor's season-ending championship; the finals for JUMP / NUVO / 24SEVEN (NOT RADIX).
- **Tier 1 — "Best Dancer"** (called "the National Best Dancer Title"). Entry requires a
  qualifying convention scholarship (JUMP VIP, NUVO Breakout, 24SEVEN Non-Stop, winner or
  runner-up). Rounds: Top 10 per age division per gender → Best Dancer Dance-Off → Top 3 →
  Solo Dance-Off. Results publish **Winner / 1st Runner-Up / 2nd Runner-Up** per
  Senior/Teen/Junior/Mini × Female/Male. Also **Studio of the Year** ($25,000, **Las Vegas
  only**): 12 nominated routines, top-5 studios re-compete in a Dance-Off.
- **Tier 2 — overalls, and TDA does use the word:** "**Overall** PeeWee, Mini, Junior, Teen,
  Senior & Open High Scores will receive a competitive **1st, 2nd, 3rd, 4th or 5th place**
  award" (by age division). A separate by-performance-division table ranks per style 1st-5th
  (solos/duo-trios excluded; Open not eligible).
- **Tier 3 — specialty awards:** Best Performance Awards/Nominees (top five overall high scores
  among Group/Line/Extended Line/Production per age), PeeWee & Open Best Performance,
  Outstanding Technical Achievement, Most Professional Studio, Best Choreographer (Teen/Senior
  winner becomes a Capezio A.C.E. finalist), Best {genre} Performance, Best Production
  Performance, Outstanding Achievement in Costume Design, People's Choice, Studio Encore,
  and per-genre **Studio Awards** ("Best Tap Studio", "Best Jazz Studio", … min combined 870).
- ⚠️ **Bands (exclude):** Judge's Pick 291-300, Palladium 282-290.5, High Gold 273-281,
  Gold 264-272, High Silver 255-263, Silver 231-245, Bronze 216-230. Four judges, lowest dropped.
  A video-only **Pre-Qualifying Competition** awards bands only.
- **Sources:** thedanceawards.com/content/pages/{competition-info,awards-and-categories,
  best-dancer,studio-awards,studio-of-the-year}.html (verified 2026-08-30).
- **Confidence:** medium-high on names/structure. Prize amounts unreadable (Angular bindings);
  the awards page carries stale year references (2018/2019) — treat non-structural details as dated.


---

## Ultra Dance Tour (ultradancetour.com) — verified 2026-08-30 (first research on file)
KAR-family: routines at Ultra regionals are eligible for **any KAR National Finals**.
- **Tier 1 — "Icon of the Year"** (title): open to all levels; regional Finalists get a
  commemorative gift, the highest-scoring Finalist the award. Results render per level × age:
  `Competitive Mini Icon of the Year`, `Competitive Plus Teen Icon of the Year`, with placements
  `Winner` / `Finalist`. **Finalists qualify to compete for Title at any KAR National Finals.**
- **Tier 2 — "Overall High Point Awards"**, ranked across categories within level × entry-type ×
  age: results headings are `Top Competitive Solo 9 - 11`, `Top Ultra Competitive Large Group
  12 - 14`, `Top Ultra Competitive Production`, rows `1st`/`2nd`/`3rd`… **Observed depth: solos
  10, duet/trios 5, groups 3** (scaled down in small divisions; depth is not published in rules).
  Rules: "Ties will not be broken during the General Placement Awards. Ties will however be
  broken for the Overall High Point Awards."
- **Tier 3:** Supercharged Performance Award (highest-scoring group per level; feeds the
  season-end Supercharged Performance of the Season), Dancer Headshot Award, Ultra's Ultimate
  Improv Challenge (`12 & Under` / `13 & Above Ultimate Improv Champion`), Hollywood Dance
  Experience "All Star Dancers" (top 5 soloists per division per level → $500 scholarship).
  Observed in results but NOT in the rules: `IDA People's Choice Award`, `IDA Outstanding
  Performance Winners` (Best Jazz/Hip Hop/Tap/Lyrical/Ballet/Novelty Performance),
  `Competitive Power Performance`, `<Level> Powerhouse Studio`.
- ⚠️⚠️ **BANDS (exclude) — the KAR trap, verbatim in Ultra's rules:** "**Elite Platinum, Elite
  Top First Place, Top First Place, and First Place** awards will be decided by the judges based
  on a predetermined range of points… **There may be multiple** Elite Platinum, Elite Top First
  Place, Top First Place, and First Place awards in each age group and category."
  So `First Place` at Ultra is the LOWEST band, and `Top First Place` is also a band — never a rank.
- **Levels:** Competitive, Competitive+, Ultra Competitive. **Ultra Battlegrounds** ("Super
  Regional") adds Amped Award, Electrifying Performer Award, Powerhouse Educator Award.
  No nationals of its own.
- **Sources:** ultradancetour.com/competition/rules, /competition/results/2026/100, /about.
- **Confidence:** high. Not verified: published overall depth (inferred from results), what
  "IDA" stands for, band score ranges. (Ultra serves its own results — no DanceBug evidence.)

---

## Refresh Dance Competition (refreshdance.com) — verified 2026-08-30 (first research on file)
KAR-family, confirmed verbatim: "If you already have a KAR Productions account… log in using
your existing KAR credentials"; routines are eligible for **KAR or Rainbow National Finals**.
Rules text is near-identical to Ultra's, sentence for sentence.
- **Tier 1 — "SQUAD"** (title): "Refresh's exclusive title competition… evaluated using a
  separate score sheet in addition to their regular solo adjudication." Open to all levels;
  highest-scoring Finalist gets the SQUAD jacket; **Finalists qualify for Title at any KAR
  National Finals.** Results: `kind: "TITLE"`, divisions `Foundation Mini` … `Elite Senior`,
  placements `<Level> <Age> SQUAD` (winner) and `Finalist`.
- **Tier 2 — "Overall High Point Awards"**, with depth PUBLISHED: **Top 10 solos per age
  division and level (Top 15 where a division has 40+ entries), Top 5 duet/trios, Top 5 groups.**
  Elite level groups its youngest as 8 & under (Petite). Results feed: `kind: "OVERALL"`,
  `name: "Overall High Point"`, `ranked: true`, divisions `Top Foundation Solo 9 - 11`,
  `Top Elite Production`, placements `1st`…`10th`.
- **Tier 3:** Spirit of Refresh Award ($1,000 studio), Legacy Award (educator, 20+ years),
  Refresh Visual Impact Award (photogenic), Choreography Awards ($500/age division),
  Technical Excellence Awards (Elite only), Studio Technical Excellence, Choreography
  Excellence, Performance / Artistic Merit / Teacher Recognition awards. No cash at Foundation.
- ⚠️ **BANDS: NOT PUBLISHED.** Rules say only "each entry will receive an award based on their
  achievement level" — the levels are never named on the site. **Do not assume KAR/Ultra band
  names apply**; treat any band-like string in Refresh data as unverified.
- ⚠️ **Foundation / Progressive / Elite are skill LEVELS**, not bands or placements — so
  `Top Foundation Solo 9 - 11` is a genuine overall ranking.
- **Sources:** refreshdance.com/rules (React SPA — text extracted from its JS bundle),
  /cash-prizes, /awards, and the public results API /api/v1/competitions/23/awards.
- **Confidence:** high, except adjudication bands (unpublished).
