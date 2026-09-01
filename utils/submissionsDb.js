// Staging database for family-entered awards (mobile app design v2 §8,
// development plan M1).
//
// WHY A SEPARATE FILE. SQLite serialises writers. A submission spike — a
// Saturday at a big competition, dozens of families entering placements —
// must not queue behind, or hold up, the serving database that renders every
// public page. The repo already established this pattern for the weekly
// staged import (staging_import.sqlite via DB_PATH); this is the same idea
// with a permanent home. It also keeps the "do we need Postgres yet?"
// question answerable with a real number (p95 write latency on THIS file)
// rather than a guess.
//
// SUBMISSIONS_DB_PATH overrides the file — used by the smoke suite and any
// throwaway copy, exactly like DB_PATH does for the canonical database.
//
// ORPHAN STORY (required: foreign keys are off platform-wide, and these rows
// point ACROSS databases, so nothing could enforce them even in principle):
//   * user_id / dancer_id / studio_id / event_id are canonical ids in
//     database.sqlite. A deleted dancer or event leaves a dangling
//     submission.
//   * Reads always resolve those ids against the canonical DB and drop what
//     no longer exists (see utils/submissions.js listForDancer / listForUser),
//     so an orphan is invisible rather than a crash.
//   * Promotion (M3) re-resolves every id at decision time and refuses to
//     promote a submission whose dancer or event has since vanished.
//   * scripts/check_submission_orphans.js reports them for a human; nothing
//     deletes a family's submission automatically — it is their record of
//     their own child's award, and silent erasure is the one outcome worse
//     than a dangling row.
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

let dbPromise = null;

function submissionsDbPath() {
  return process.env.SUBMISSIONS_DB_PATH || path.join(__dirname, '..', 'submissions.sqlite');
}

// One shared connection per process, same contract as database.js: WAL so
// readers never block on the writer, busy_timeout for the import scripts and
// the sqlite3 CLI.
function openSubmissionsDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await open({ filename: submissionsDbPath(), driver: sqlite3.Database });
      await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA synchronous = NORMAL;
      `);
      await initSubmissionsSchema(db);
      return db;
    })();
  }
  return dbPromise;
}

// Idempotent CREATE TABLE IF NOT EXISTS + try/catch ALTER, matching
// database.js. Unlike the canonical schema this runs on first connection
// rather than only under `node database.js`: the file is created by the app
// itself, so there is no window where a deploy has the code but not the
// table.
async function initSubmissionsSchema(db) {
  await db.exec(`
    -- One family-entered award, awaiting review. NEVER a canonical award:
    -- promotion (M3) writes the canonical row and back-fills award_id here.
    --
    -- Three separate concerns, deliberately not collapsed into one column
    -- (design §7): status = workflow, visibility = who can see it,
    -- verification_level = how strong the evidence is.
    CREATE TABLE IF NOT EXISTS award_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- Idempotency: the client mints a UUID per submission and retries with
      -- the same one. A retried offline upload returns the original row
      -- instead of a duplicate award. Unique per user, not globally: one
      -- household's id must never collide with another's.
      client_submission_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,

      dancer_id INTEGER NOT NULL,
      -- DERIVED from dancer_studios at submit time, never typed by a family
      -- (design §6.2 — the single largest duplicate vector removed at source).
      studio_id INTEGER,

      -- M1 accepts canonical events only. event_candidate_id lands in M2;
      -- the invariant that survives both is: no submission without an event.
      event_id INTEGER,
      event_candidate_id INTEGER,
      -- Server-issued batch handle so a weekend at one competition reviews as
      -- one pass (design §6.7). Free-form; NULL until M7 uses it.
      event_session_id TEXT,

      performance_name TEXT NOT NULL,
      -- utils/routineKey canonical form, stored at write time so the
      -- convergence key (M4) never has to re-derive it.
      performance_name_key TEXT,

      -- REQUIRED (design §6.5): group size decides the canonical write path
      -- (solo double-writes awards.dancer_id + junction; groups use the
      -- junction only). Inferring it from link count is what produced 1,874
      -- group awards indistinguishable from solos.
      group_size TEXT NOT NULL,
      group_size_n INTEGER,
      -- 0 for group/line/production: the family named their own dancer and
      -- the cast is explicitly partial. Never mistaken for a solo.
      cast_complete INTEGER NOT NULL DEFAULT 0,

      place TEXT,
      award_type TEXT,
      category TEXT,
      age_division TEXT,
      -- Names only. The credit GRAPH (two-sided accept) is behind an IP gate;
      -- capturing the names as award metadata is not. See plan §9.6.
      teacher TEXT,
      choreographer TEXT,
      notes TEXT,

      -- Exactly what the client sent, before server normalisation. Kept so a
      -- reviewer can see the family's own words when the normaliser and the
      -- family disagree.
      raw_payload TEXT,

      status TEXT NOT NULL DEFAULT 'submitted',
      visibility TEXT NOT NULL DEFAULT 'owner_visible',
      verification_level TEXT NOT NULL DEFAULT 'family_submitted',

      -- Set by promotion (M3). Non-NULL means this submission became (or
      -- joined) a canonical award.
      award_id INTEGER,
      reviewer_user_id INTEGER,
      reviewer_note TEXT,
      decided_at DATETIME,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_award_submissions_idem
      ON award_submissions(user_id, client_submission_id);
    CREATE INDEX IF NOT EXISTS idx_award_submissions_dancer
      ON award_submissions(dancer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_award_submissions_user
      ON award_submissions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_award_submissions_status
      ON award_submissions(status, created_at);
    -- The M4 convergence key: two households submitting the same routine at
    -- the same event must reach ONE award with two dancer links.
    CREATE INDEX IF NOT EXISTS idx_award_submissions_converge
      ON award_submissions(event_id, performance_name_key, studio_id, group_size);

    -- Additional named cast for the enumerable formats (solo/duet/trio).
    -- dancer_id is filled only when the family picked an existing profile;
    -- a typed teammate name stays unresolved until a reviewer decides —
    -- inventing a person from a name is the failure this whole design avoids.
    CREATE TABLE IF NOT EXISTS award_submission_dancers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      dancer_id INTEGER,
      name TEXT NOT NULL,
      name_key TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(submission_id, name_key)
    );
    CREATE INDEX IF NOT EXISTS idx_award_submission_dancers_sub
      ON award_submission_dancers(submission_id);

    -- Private evidence (certificate photo, results screenshot). PRIVATE BY
    -- DEFAULT and never share media (design §7 principle "evidence is never
    -- share media"): object_key points at private storage, not /uploads.
    -- Object storage arrives in M5; the table exists now so the submission
    -- shape does not change under the reviewer tooling later.
    CREATE TABLE IF NOT EXISTS award_submission_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      media_type TEXT,
      byte_size INTEGER,
      checksum TEXT,
      uploaded_by INTEGER,
      consent_context TEXT,
      scan_status TEXT NOT NULL DEFAULT 'pending',
      retention_state TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(submission_id, object_key)
    );
    CREATE INDEX IF NOT EXISTS idx_award_submission_evidence_sub
      ON award_submission_evidence(submission_id);

    -- An event a family created because they genuinely could not find theirs
    -- (design §6.4). Immediately selectable by other families in the same
    -- place and week, so a second parent at the same competition is never
    -- forced to create a duplicate — but NEVER a canonical events row. Only
    -- a reviewer promotes, or the organizer's own import auto-merges.
    --
    -- Why the staging file: families write these at submission rate, in the
    -- same Saturday-at-a-competition spike, and a provisional event is not
    -- archive data until somebody says it is.
    --
    -- Orphan story: org_id / upcoming_event_id / promoted_event_id /
    -- created_by are canonical ids across the database boundary. Reads
    -- resolve them and tolerate absence; scripts/check_submission_orphans.js
    -- reports dangles; nothing is deleted automatically.
    CREATE TABLE IF NOT EXISTS event_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- Two families creating the same event minutes apart are offered each
      -- other's row first; if both proceed anyway, they share a cluster id so
      -- a reviewer sees one decision instead of two unrelated rows.
      dedup_cluster_id TEXT NOT NULL,

      -- Canonical organizations.id when the family recognised the brand.
      org_id INTEGER,
      -- org_upcoming_events.id when this candidate was seeded from the
      -- organizer's OWN announced tour stop — the highest-confidence case,
      -- and the one that auto-merges cleanly when results land later.
      upcoming_event_id INTEGER,

      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      city TEXT,
      state TEXT,
      venue TEXT,
      lat REAL,
      lng REAL,

      -- Optional banner/programme photo. PRIVATE to the creator and the
      -- reviewer until an approval step exists: it is dedup evidence ("two
      -- candidates with the same banner are the same event"), not public
      -- content, and unmoderated family images must not reach other families.
      photo_key TEXT,
      photo_status TEXT NOT NULL DEFAULT 'private',

      source TEXT NOT NULL DEFAULT 'family',
      created_by INTEGER NOT NULL,

      -- open -> promoted (a canonical event was created) | merged (absorbed
      -- into an existing canonical event) | rejected. Only 'open' rows are
      -- offered in the picker; promoted/merged ones redirect submissions to
      -- their canonical event.
      status TEXT NOT NULL DEFAULT 'open',
      promoted_event_id INTEGER,
      decided_by INTEGER,
      decided_at DATETIME,
      decision_note TEXT,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- One candidate per organizer-announced stop, ever: the seed is
    -- get-or-create, so two households picking the same tour stop share a row.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_candidates_upcoming
      ON event_candidates(upcoming_event_id) WHERE upcoming_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_event_candidates_lookup
      ON event_candidates(status, start_date);
    CREATE INDEX IF NOT EXISTS idx_event_candidates_cluster
      ON event_candidates(dedup_cluster_id);
    CREATE INDEX IF NOT EXISTS idx_event_candidates_namekey
      ON event_candidates(name_key, start_date);

    -- Convergence (M4) must work whether the event is canonical or still a
    -- candidate, so the key needs both shapes.
    CREATE INDEX IF NOT EXISTS idx_award_submissions_converge_candidate
      ON award_submissions(event_candidate_id, performance_name_key, studio_id, group_size);

    -- Per-household abuse ledger (design §9 "abuse limits"). One row per
    -- counted action; the limiter counts rows in a rolling day rather than
    -- keeping a mutable counter, so a limit change applies retroactively and
    -- correctly, and the ledger doubles as an audit trail.
    CREATE TABLE IF NOT EXISTS household_action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      subject_id INTEGER,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_household_action_log_lookup
      ON household_action_log(user_id, action, created_at);
  `);
}

module.exports = { openSubmissionsDb, submissionsDbPath, initSubmissionsSchema };
