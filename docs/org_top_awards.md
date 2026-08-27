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
- **Top award: ADC|IBC Grand Prix Recipient** (one per age division — Primary/Junior/Senior — highest-scoring gold medalist; imported as place='GRAND PRIX RECIPIENT', is_first_place=1).
- Solo ladder per gender×division: Gold Medal > Silver > Bronze > 4th > 5th, then Top 25 (female) / Top 10 (senior male) — Top-N are placements-of-honor, NOT podium.
- Ensemble division (Classical Pas de Deux / Duet|Trio / Large Ensemble): 1st-5th Place; routine names preserved in performance_name, dancers via award_dancers.
- Special awards: jury awards, Traditional Excellence, Outstanding International Dancer, Fernando Bujones Memorial Award (prestigious honoree) imported; Outstanding School = studio-level award; choreographer/coach/photographer awards not imported (not dancer awards).
- Site publishes World Finals only (St. Petersburg FL); ~10 regional semi-finals per season unpublished — that's the outreach ask. Archives back to 2006 on the site.

## Universal Ballet Competition (UBC — universalballetcompetition.com)
- **Top award: Grand Prix Finals 1st place** per division; regional 1st places qualify dancers to the Finals (season ends with GRAND PRIX FINALS each May).
- Placement ladder is numeric (1..12) inside each division×level×genre section, e.g. "SENIOR COM CLASSICAL", "JUNIOR INT CONTEMPORARY". **INT = Intermediate, COM = Competitive** — these are skill levels, NOT awards; PRE-COMPETITIVE is the entry level.
- Group sections: DUO/TRIO, PDD (Pas de Deux), ENSEMBLE. Ensembles are studio-level (no dancer names published); duo/trio/PDD list every dancer.
- "Additional Awards" per event: Rising Star / Aspire / Legacy (dancer honors), Outstanding Choreographer / Classical Coach / Contemporary Coach (people-and-school honors, imported at studio level).
- Data source: the registration backend (api.reg.universalballetcompetition.com/public/results.cfm?event_id=N) publishes EVERY event including regionals — unlike ADC IBC, no outreach ask needed for regional data. Dates come from scripts/seed/ubc_events.json (site + Wayback index snapshots). Archive reaches 2019 (ids 8-28) if we want more history.

## Hollywood Vibe (hollywoodvibe.com)
- **Top awards: the OVERALL tables** ("1ST OVERALL".."5TH OVERALL") — these rank across styles within an age×size group and outrank a category placement. Imported with award_type='OVERALL'; 1ST OVERALL is marked is_first_place.
- Category placements ("1st".."10th") sit in very narrow categories (age × style × size, e.g. "MINI CONTEMPORARY SOLO"), and a category awards **1, 3 or 5 places** depending on entry count — so a lone 1st is the norm, not a data error. Some events publish a second table further down for 6th-10th.
- **SPECIALTY judge awards**: Most Entertaining, Best Costume, Outstanding Choreography, Best Direction, plus per-judge "Specialty Award" (award_type='SPECIALTY').
- **Scholarships carry dancer names** (award_type='SCHOLARSHIP') — Excellence, Hollywood Vibe, Team Hollywood Vibe, Millennium, Grand Prize, Dancer of the Year, CLI Summer Intensive / Conservatory, LA Agency Finalists, Studio Excellence. These are the only Hollywood Vibe rows with dancers; competition results publish routine + studio only.
- Levels appear in the category string: INTERMEDIATE / COMPETITIVE are skill levels, NOT awards. Published typos exist in the source (INTERMEDAITE, JUNOIR, DUO/TIRO, PRODUCITON) and are handled at import.

## JUMP Dance Convention (jumptour.com)
- JUMP is a **convention**, so its published results mix competition placements with a very large scholarship programme — and roughly three quarters of its rows name a dancer, which is unusually rich for us.
- **Top awards: SPECIAL AWARDS** — "Best of JUMP" (per age division) is the headline honour, alongside "Best in Studio". Imported with award_type='SPECIAL', the award name in `place`.
- **Placements**: HIGH SCORE BY AGE and HIGH SCORE BY PERFORMANCE, 1st..10th, in categories shaped "Age : Type" (e.g. "Teen : Solo", "JUMPstart : Jazz"). Solo rows name the dancer; group rows are studio-level. JUMPstart is JUMP's youngest division, not an award.
- **Scholarships** (award_type='SCHOLARSHIP'): "<Age> JUMP VIP" plus per-class scholarships (TAP / BALLET / HIP-HOP & JAZZ FUNK / JAZZ, CONTEMP. & LYRICAL). Places are **WINNER** and **RUNNER-UP** — these are scholarship outcomes, NOT competition placements, so they should not be ranked against 1st/2nd/3rd.
- Source is clean HTML tables at jumptour.com/results/?id=N; the event index at /past-seasons/ lists every season at once (its ?season= parameter is ignored server-side). Seasons reach back to 2019-2020 if we ever want more history.

## NUVO Dance Convention (gonuvo.com)
- DanceOne sibling of JUMP — identical results anatomy and award vocabulary. **Top awards: SPECIAL AWARDS** — "Best NU Group" per age division (their Best-of-JUMP analogue), plus "Studio Pick"; **NUbie is the youngest age division** (their JUMPstart), not an award.
- Placements: HIGH SCORE BY AGE / BY PERFORMANCE, 1st..10th, categories "Age : Type". Scholarships: "<Age> NUVO" honors + per-class scholarships (incl. BALLROOM — a class JUMP doesn't run); places are WINNER / RUNNER-UP (scholarship outcomes, not competition placements). Class-scholarship tables add a Faculty column (the presenting teacher — not imported).
- Shared tooling: scripts/lib/danceone.js + danceone_import.js drive both brands (and future DanceOne siblings like 24SEVEN); per-org scripts are thin configs. Seasons reach 2019-2020 on the site.

## RADIX Dance Convention (radixdance.com)
- Third DanceOne sibling (JUMP/NUVO) — identical anatomy via the shared libs. **Youngest age division: Rookie** (their JUMPstart/NUbie). Top awards: SPECIAL AWARDS per age division + Studio Pick; scholarships WINNER / RUNNER-UP are scholarship outcomes, not placements.
- NOTE the DanceOne brands share one results backend — each brand's site will serve ANY event id, so scrapers must only fetch ids listed on that brand's own /past-seasons/ index (the shared loadIndex does this; the three indexes were verified disjoint: 0 id overlap).

## 24SEVEN Dance Convention (24sevendance.com)
- Fourth DanceOne sibling — identical anatomy via the shared libs. **Youngest age division: Sidekick** (their JUMPstart/NUbie/Rookie). Top awards: "Best of 24SEVEN"-style SPECIAL AWARDS per age division; scholarship places WINNER / RUNNER-UP are scholarship outcomes, not placements. Org slug is 'twentyfourseven' (slugs must not start with a digit for URL hygiene).
