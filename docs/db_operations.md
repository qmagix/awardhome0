# Database Operations

## Connection model

The app uses **one shared SQLite connection per process** (`database.js`
caches the connection promise). The `sqlite3` driver serializes statements
on a connection, so in-process writes never contend. Cross-process
contention (server + import script + `sqlite3` CLI) is handled by:

- **WAL journal mode** — readers never block while a write is in progress.
  WAL is persistent: once set, the DB stays in WAL mode. SQLite maintains
  `database.sqlite-wal` / `-shm` sidecar files; never delete them while a
  process has the DB open.
- **`busy_timeout = 5000`** — a writer that hits a lock waits up to 5s
  instead of failing with `SQLITE_BUSY`.
- **`synchronous = NORMAL`** — the recommended durability setting with WAL
  (full fsync per transaction is unnecessary; WAL guarantees consistency).

`sessions.sqlite` (session store) uses the same pragmas.

## Foreign keys — intentionally OFF

`PRAGMA foreign_keys` is **not** enabled: the live data currently has
~150 orphaned `awards.dancer_id` references (dancers deleted by old merge
tooling). Enabling enforcement would make unrelated writes start failing.
Before turning it on: fix orphans (see `scripts/recover_orphans.js` /
`scripts/fix_duplicate_dancers.js`), verify `PRAGMA foreign_key_check`
returns empty, then add `PRAGMA foreign_keys = ON` to `database.js`.

## Backups

Two layers:

1. **Litestream (primary, production)** — continuous streaming replication
   of every WAL frame to AWS S3. Config: `litestream.yml`; installed and
   run as a systemd service by `deploy/setup_server.sh` (see
   `docs/deployment.md`). Credentials come from the EC2 instance's IAM
   role — no keys to manage. Recovery loses at most seconds of writes.
2. **Nightly file copy (fallback)** — the in-app cron
   (`ENABLE_NIGHTLY_BACKUPS=true`) copies the DB to `backups/`, keeping 7.
   Note: a plain file copy of a WAL database is only safe when taken while
   no write is in flight; Litestream is the authoritative backup.

### Restore drill

```bash
litestream restore -config litestream.yml -o /tmp/restored.sqlite database.sqlite
sqlite3 /tmp/restored.sqlite "PRAGMA integrity_check; SELECT COUNT(*) FROM awards;"
```

Run this once after setting up replication, and occasionally thereafter.

## Organizer-submitted database files

The organizer upload (`/manage/org/:id/upload`) accepts SQL dumps,
SQLite/Access files, and ZIPs alongside CSV/Excel/PDF. Files land in
`tobeprocessed/org_uploads/` and are **never** parsed or executed by the
app — processing is manual. When working with a submitted dump:

- **Never** run a submitted `.sql` file against the live database or any
  database that matters. Restore it into a throwaway DB and export from
  there, e.g.:

  ```bash
  # SQLite dump or file
  sqlite3 /tmp/org_scratch.sqlite < upload.sql
  # MySQL dump: use a disposable local instance/container, never prod creds
  ```

- Expect variety: MySQL and PostgreSQL dumps, raw `.sqlite`/`.db` files,
  occasionally Access (`.mdb`/`.accdb` — `mdbtools` converts to CSV).
- Treat contents as untrusted data. A dump can contain arbitrary DDL and
  triggers; a scratch database contains the blast radius.
- Once exported to CSV, feed it through the normal manual-import path.

## When to revisit (Postgres triggers)

Migrate only on a real signal: a second app server, `SQLITE_BUSY` in logs
despite WAL, need for managed point-in-time recovery/replicas, or heavy
analytics competing with production traffic.

## Legacy dancer-link backfill (2026-08-29)

`node scripts/backfill_legacy_dancer_links.js [--apply]` promotes legacy solo
links (`awards.dancer_id`, the importers' solo convention) into the canonical
`award_dancers` junction table (`source='backfill'`), so junction-only queries
count solos correctly. Idempotent; dry-run by default; honors `DB_PATH`. Also
runs weekly (scripts/weekly_update.js, before run_backfill, against staging).

Skips, by design:
- director-denied pairs (`award_dancer_removals` — never resurrected);
- pointers to deleted dancers (stale from pre-fix merges; FKs are OFF);
- pointers whose award already has a same-named OTHER profile junction-linked
  (duplicate-profile signal — promoting would double-list the dancer and
  restyle the solo card as a group; merge the profiles instead, the merge
  tools now repoint `awards.dancer_id` too).

Each run first sweeps its own earlier rows that later became orphaned or
double-listing (self-healing). Run on prod once after deploying: same script,
same flags (data parity by identical script runs).

## Solo primary-dancer backfill (2026-08-30) — the MIRROR direction

`node scripts/backfill_solo_primary_dancer.js [--apply]` promotes a SOLO's
junction link into the legacy primary column (`award_dancers` ->
`awards.dancer_id`). This is the mirror of the backfill above, which only ever
ran legacy -> junction; nothing ran the reverse, so **79,181 solos had a
junction row and no primary dancer**.

**Symptom** (reported by Q on `/manage/studio/842/awards`): those dancers
appeared under "Group Dancers" instead of "Primary Dancer", because the two
columns read two different tables. Not merely cosmetic — public queries that
join `a.dancer_id` (Hall of Fame, card surfaces) rendered a blank dancer for
them. Solo/title awards with a linked dancer but blank `dancer_name` went from
79,538 to 357.

**Cause was NOT owner editing** (only 6 of 67,574 rows carried
`source='studio_owner'`). Five importers wrote the junction only and never the
legacy column: `import_showstopper_txt.js`, `import_starpower_awards.js`,
`import_nycda_txt.js`, `import_revolution_awards.js`, and
`import_dancebug_awards.js` (the shared DanceBug importer behind Imagine,
Believe, DreamMaker and Rainbow). All five now call `setSoloPrimary()` from
`utils/soloPrimary.js` once per award, after linking its cast.

**The safety rule — read this before widening the script.** Identification is
POSITIVE: the award's own label (`award_type` + `category`, never
`performance_name`) must say solo or title, and must contain no
duo/duet/trio/group/line/production/ensemble/team/quartet wording. It is NEVER
inferred from "there happens to be exactly one linked dancer", because 1,874
group-worded awards also have exactly one link — a group whose cast is only
partly entered. Promoting those would silently turn real groups into solos,
which is worse than the bug being fixed. Verified after the run: zero
group-worded awards gained a primary (the single pre-existing "Rising Starz
Solo & Duet/Trio & ... HDE All Stars" row was untouched, byte-identical).

Also skipped: director-denied pairs (`award_dancer_removals`) and links to
deleted dancers. Idempotent, dry-run by default, honors `DB_PATH`, and runs
weekly in `scripts/weekly_update.js` so a regression or a newly-added org
cannot accumulate silently.

**232 rows need human review, and the script will never touch them:** awards
whose label says solo but which have 2+ DIFFERENT dancers linked — e.g.
"Fabulous" -> Kenzie Sagerman | Olivia Altieri. These are real data errors
(mis-attached dancer, or two same-titled solos collapsed into one row), not a
missing primary. Re-run the script's dry mode to list the current count.

## Two parser bugs behind the multi-dancer "solos" (2026-08-30)

Q asked why 232 solo-labelled awards carried 2-4 dancers. Investigating from
the source showed it was **two unrelated bugs**, not one.

### Bug A -- collapsed awards (191 rows), `import_dancebug_awards.js`

Its Choice-award dedupe keyed on `(event, category, routine, place)` and
omitted `studio_id` and `performance_number`. Two studios routinely enter
same-titled routines at one event. Believe Louisville 2022, verified in the raw
HTML:

    entry 259  "Burlesque"  Aubrey Sears   Dance Designs Dance Complex
    entry 330  "Burlesque"  Laney Wheeler  All About Dance Studio

The second collapsed into the first, so both dancers hung off Dance Designs'
award -- and All About Dance's own "Burlesque" placement (7th) was left with NO
dancer. `backfill_utils.js` then propagated the bad pair across the event,
because it keys on `(performance_name, studio_id)`, which is NOT unique for a
performance.

Fixed at the source (dedupe now includes studio + entry number; the backfill
refuses to propagate a multi-dancer set onto a solo-labelled award). Repaired by
`scripts/repair_collapsed_solo_dancers.js`, which resolves by the dancer's own
studio, then REATTACHES the displaced dancer to her own empty placement.

> The reattach phase is restricted to the cross-studio case
> (`a2.studio_id <> a.studio_id`). Dropped, the same rule matches 1,128 empty
> awards and starts asserting links from thin evidence -- the very over-reach
> that caused the bug. It is 141 with the restriction.

### Bug B -- the Showstopper apostrophe, and ~340 fake dancers

`extract_showstopper_pdfs.js`. A typographic apostrophe inside a studio name
decodes as control char **U+0019**, which pdf2json emits as its own text object.
The phantom column shifted every column after it, and the parser took dancers
*positionally* (`routineColIndex + 2`) while its own comment said "everything
after the score". Raw PDF row:

    col[2] "Glimpse of Us - Chassé"  col[3] "\u0019"
    col[4] "s Dance Company - Theodore, Al"  col[5] " 112.45"

So the studio was truncated to "Chassé" and the studio tail, the STATE CODE and
the SCORE all became dancer names. Result: **5 phantom studios** (America,
Bianca, Chassé, Dan, GG) holding 65 awards, and **80 fake dancer profiles** --
71 of them with public `unique_id` URLs. Real people they were not.

Fixed by merging the phantom column back into an apostrophe. Repaired by
`scripts/repair_showstopper_apostrophe.js`: reconstructs the true studio from
the corruption's own signature (phantom + `'` + tail), renames or merges the 5
studios, and deletes the fakes.

> Scoping caution kept in the script: a 2-letter name is only junk when it sits
> on an award that also carries a tail fragment -- **"Wu" is a real dancer**.
> Purely numeric names are swept globally, since no person is named "112.45".

### What is deliberately NOT auto-fixed

**109 awards remain** with several linked dancers who genuinely share the
award's studio (mostly KAR, e.g. "Paquita" / "Fairy Doll" ballet variations with
3 linked dancers). The source cannot disambiguate these by studio, so they are
reported and left alone. Re-run either repair script's dry mode for the live
list.

## StarQuest notes-dancer repair (2026-08-29)

The original StarQuest importer stashed published dancer names in awards.notes
("(Dancer: Faye Gu)") without creating/linking dancers — 17,952 awards.
`node scripts/repair_starquest_notes_dancers.js [--apply]` promotes them into
real links: name+studio match with routine tie-break
(utils/resolveDancer.js; ambiguous cases create a new profile the roster
duplicates widget surfaces), then awards.dancer_id + junction row. Idempotent;
honors tombstones; DB_PATH honored. Local run: 10,452 matched existing,
7,500 new profiles. Run ONCE on prod after deploy. The importer now resolves
dancers at import time (and heals link-less rows on re-import), so future
StarQuest events arrive linked.

## Routine-title whitespace normalization (2026-08-29)

PDF extraction left tabs/multi-spaces inside routine titles (32,942 awards,
mostly StarQuest) — visually identical routines grouped separately on every
routine-keyed surface. `node scripts/normalize_performance_whitespace.js
[--apply]` collapses whitespace (pure collapse — normalizeName's word-glue is
for category headers and would corrupt titles). Idempotent; run once on prod
after deploying. The StarQuest importer now collapses routine + dancer fields
at import. Routine grouping (group-dancers, All Routines, sidebar count,
routineAwardIds) is also CASE-INSENSITIVE now: orgs capitalize the same
routine differently ("Tides Of/of Reunion"); display shows one variant.

## Canonical routine keys, phase 1 (2026-08-29)

`awards.performance_name_key` = machine-canonical routine key
(utils/routineKey.js: NFKC, curly quotes/apostrophes → straight, en/em-dash →
hyphen, nbsp, whitespace collapse, lowercase), indexed on
(studio_id, performance_name_key). DERIVED ONLY — performance_name is never
rewritten (it's the source-of-record and every importer's idempotency anchor).
Filled by `node scripts/sweep_routine_keys.js --apply` (chunked, idempotent;
weekly pipeline runs it after imports; run once on prod at deploy). Readers
fall back to LOWER(TRIM()) for unswept rows. All routine-keyed matching uses
the key: group-dancers grouping/casts/events, paste/sync/remove targeting,
All Routines, sidebar count, resolveDancer routine tie-break. Local sweep:
1,275,953 keys filled; 247 studio-routine spelling variants unified.
Phase 2 (not built): per-studio alias table for owner-specified merges of
true misspellings ("Kongfu"/"Kungfu") + display-spelling choice.

## Dancer profile convergence (2026-08-30)

Two scripts, both idempotent, both in the weekly pipeline after the routine-key
sweep; run once on prod after deploy:
- `node scripts/normalize_dancer_whitespace.js --apply` — whitespace collapse
  in dancers.name (194 repaired locally; pure collapse, never word-glue).
- `node scripts/auto_merge_dancer_profiles.js --apply` — merges duplicate
  dancer profiles on strong evidence: same clean name + same studio + >=1
  shared canonical routine in the same year (Q's rule — name+routine+studio+
  year collisions are vanishingly rare). Single-pass in-memory design (~2.5s
  for 1.5M awards): full-table reads grouped in JS, no per-group queries.
  Rails: components with >1 claimed profile skipped; dups owning family
  content (claims/acks/photos) never deleted; primary = claimed > most
  awards > oldest. Local run: 1,070 dups merged (e.g. 4x "Ina Su" -> 1).
  This is the convergence mechanism for repair-created per-routine profiles.

## Family submissions: a second SQLite file (2026-08-31)

Family-entered awards stage in **`submissions.sqlite`**, not `database.sqlite`.
`SUBMISSIONS_DB_PATH` overrides the file, the same way `DB_PATH` does for the
canonical database; the smoke suite and `npm run gate` both point it at a
throwaway copy.

Why a second file: SQLite serialises writers. A submission spike — a Saturday
at a big competition, dozens of families entering placements — must not queue
behind, or hold up, the database that renders every public page. A long write
transaction was already observed against production during the 2026-08-31
studio merge. It also keeps the Postgres question answerable with a real number
(p95 write latency on this file) rather than a guess; see "When to revisit"
above.

Schema lives in `utils/submissionsDb.js` and is applied on first connection
(`CREATE TABLE IF NOT EXISTS`), not by `node database.js` — so there is never a
window where a deploy has the code but not the table.

**What stays in the canonical database.** `award_provenance` does, deliberately:
it is a property of an award, read wherever awards are read, and promotion
writes it in the same transaction as the award itself — impossible across two
SQLite files. Provenance writes happen at review-promotion rate, not submission
rate, so they do not reintroduce the contention the split exists to avoid.

**Orphans.** Staging rows carry canonical ids (user, dancer, studio, event)
across a database boundary, so `PRAGMA foreign_key_check` cannot see them at
all. `scripts/check_submission_orphans.js` reports them — run by the weekly
Sunday integrity cron, and safe to run by hand. It never deletes: a family's
submission is their record of their own child's award, and silent erasure is
worse than a dangling row. Read paths already drop rows whose canonical event
has vanished, and promotion re-resolves every id at decision time.

## Independent-dancer migration (2026-08-31)

`node scripts/migrate_independent_studios.js [--apply]` — dry run by default,
idempotent, writes `reports/independent_migration.json`. Converts shared
`Independent, <region>` rosters into per-dancer synthetic studios
(`studios.is_independent = 1`). Run the identical command on local and prod;
never copy a database between them.

Left behind on purpose: awards with no resolved dancer (a published result is a
real fact even when the person cannot be identified), genuine cross-independent
collaborations, and same-name pairs — each of those is either one person entered
twice or two different children, and only a person can tell. The residual roster
is flagged `is_independent` too, so it disappears from studio surfaces while
keeping its awards.

Detection is a reviewed per-organization list in `utils/independents.js`, never
a regex on `independ` — `IndepenDANCE Studio` is a real studio. A rule fires
only on studios whose awards come from that organization.

## Event candidates: the second cross-database write (2026-08-31)

`event_candidates` lives in `submissions.sqlite` alongside the family
submissions — families write them at submission rate, in the same
Saturday-at-a-competition spike, and a provisional event is not archive data
until somebody says it is.

**Promotion spans both files and cannot be one transaction.** A candidate
becoming a canonical event means an INSERT into `database.sqlite` and an UPDATE
in `submissions.sqlite`. There is no cross-file transaction in SQLite, so both
promotion paths are **idempotent by construction** instead:

- an already-promoted candidate returns its existing event rather than making
  another;
- before inserting, an existing canonical event with the same
  `(org_id, name, year)` is reused.

So a crash between the two halves costs a retry, never a duplicate event. That
property is smoke-tested ("promoting twice is idempotent").

**Auto-merge runs against LIVE only.** `scripts/merge_event_candidates.js` is
called at the end of `weekly_update.js`'s `--promote` and `--direct` passes,
where `DB_PATH` is unset — never during the staged pass, which runs against
`staging_import.sqlite` and would merge candidates into events that may never
reach live. It also never fails a good import: the call is wrapped and logs
rather than throwing.

**Ambiguity is queued, never guessed.** Two canonical events both scoring above
the auto-merge threshold means a tour with two nearby stops; picking one would
file a family's award on the wrong weekend. Those land in
`/admin/event-candidates` with both options shown — the same principle as
`resolveOrCreateDancer` refusing to choose between same-name dancers.
