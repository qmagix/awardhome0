const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

// Single shared connection for the whole process. sqlite3 serializes
// statements on one connection, and WAL + busy_timeout handle contention
// with other processes (import scripts, sqlite3 CLI).
// NOTE: foreign_keys stays OFF — the live data has known orphaned
// awards.dancer_id references that must be cleaned up before enforcement.
let dbPromise = null;

// DB_PATH overrides the database file — used by the weekly updater's staging
// pass to run the whole import pipeline against a throwaway copy.
function openDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await open({
        filename: process.env.DB_PATH || path.join(__dirname, 'database.sqlite'),
        driver: sqlite3.Database
      });
      await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA synchronous = NORMAL;
      `);
      return db;
    })();
  }
  return dbPromise;
}

async function initDb() {
  const db = await openDb();
  
  // Tables are created IF NOT EXISTS below. We do NOT drop them.

  await db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      website TEXT,
      description TEXT,
      slogan TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER,
      name TEXT NOT NULL,
      year INTEGER NOT NULL,
      date_string TEXT,
      url TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      is_verified BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS studios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_id TEXT UNIQUE NOT NULL,
      name TEXT UNIQUE NOT NULL,
      contact TEXT,
      address TEXT,
      email TEXT,
      phone TEXT,
      website_url TEXT,
      needs_investigation BOOLEAN DEFAULT 0,
      is_featured BOOLEAN DEFAULT 0,
      is_claimed BOOLEAN DEFAULT 0,
      owner_id INTEGER REFERENCES users(id),
      bio TEXT,
      logo_url TEXT,
      view_count INTEGER DEFAULT 0,
      instagram_handle TEXT,
      tiktok_handle TEXT,
      join_code TEXT,
      aka TEXT,
      status TEXT DEFAULT 'active',
      merged_into_id INTEGER REFERENCES studios(id),
      rejected_merges TEXT
    );
    CREATE TABLE IF NOT EXISTS studio_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      studio_id INTEGER,
      proof_text TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(studio_id) REFERENCES studios(id)
    );
    CREATE TABLE IF NOT EXISTS routine_cast_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      routine_key TEXT NOT NULL,
      routine_display TEXT NOT NULL,
      year TEXT NOT NULL,
      email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS routine_cast_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id INTEGER NOT NULL REFERENCES routine_cast_invites(id),
      helper_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      note TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      decided_by INTEGER REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS studio_award_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      award_term TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(studio_id, award_term)
    );
    CREATE TABLE IF NOT EXISTS studio_routine_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      routine_key TEXT NOT NULL,
      year TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(studio_id, routine_key, year)
    );
    CREATE TABLE IF NOT EXISTS studio_routine_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      display_name TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(studio_id, from_key)
    );
    CREATE TABLE IF NOT EXISTS studio_merge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_studio_id INTEGER NOT NULL REFERENCES studios(id),
      source_studio_id INTEGER NOT NULL REFERENCES studios(id),
      requested_by INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      decided_by INTEGER REFERENCES users(id),
      dismissed_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS dancer_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      dancer_id INTEGER NOT NULL,
      proof_text TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(dancer_id) REFERENCES dancers(id)
    );
    CREATE TABLE IF NOT EXISTS dancers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      birthday TEXT,
      change_log TEXT,
      needs_investigation BOOLEAN DEFAULT 0,
      instagram_handle TEXT,
      tiktok_handle TEXT
    );
    CREATE TABLE IF NOT EXISTS dancer_studios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dancer_id INTEGER NOT NULL,
      studio_id INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      headshot_url TEXT,
      graduation_year INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (dancer_id) REFERENCES dancers(id),
      FOREIGN KEY (studio_id) REFERENCES studios(id),
      UNIQUE(dancer_id, studio_id)
    );
    CREATE TABLE IF NOT EXISTS awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      place TEXT,
      performance_name TEXT,
      performance_number TEXT,
      award_type TEXT,
      category TEXT,
      age_division TEXT,
      dancer_id INTEGER,
      studio_id INTEGER,
      notes TEXT,
      is_self_added BOOLEAN DEFAULT 0,
      verification_status TEXT DEFAULT 'unverified',
      merged_from_studio_id INTEGER REFERENCES studios(id),
      is_hall_of_fame INTEGER DEFAULT 0,
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (dancer_id) REFERENCES dancers(id),
      FOREIGN KEY (studio_id) REFERENCES studios(id)
    );
    CREATE TABLE IF NOT EXISTS award_dancers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id INTEGER NOT NULL,
      dancer_id INTEGER NOT NULL,
      status TEXT DEFAULT 'imported',
      source TEXT DEFAULT 'import',
      created_at DATETIME,
      FOREIGN KEY (award_id) REFERENCES awards(id),
      FOREIGN KEY (dancer_id) REFERENCES dancers(id),
      UNIQUE(award_id, dancer_id)
    );

    CREATE TABLE IF NOT EXISTS studio_info_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER REFERENCES studios(id),
      scraped_name TEXT,
      scraped_address TEXT,
      scraped_phone TEXT,
      scraped_email TEXT,
      scraped_website_url TEXT,
      source_url TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      page_url TEXT,
      status TEXT DEFAULT 'new',
      admin_reply TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- Owner display preference: hide a specific card from the dancer's
    -- PUBLIC page only (record stays in the archive, the owner's editor,
    -- and studio surfaces). Separate table, not an award_dancers column:
    -- hiding is an overlay preference, not a property of the link.
    CREATE TABLE IF NOT EXISTS dancer_card_hidden (
      dancer_id INTEGER NOT NULL REFERENCES dancers(id),
      award_id INTEGER NOT NULL REFERENCES awards(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (dancer_id, award_id)
    );


    -- Community flags on USER-ADDED card content (never award facts).
    -- First open flag on approved content demotes it to 'pending' (so
    -- conditional materialization unpublishes it instantly) UNLESS a prior
    -- flag on the same content was resolved 'reinstated' — then new flags
    -- only queue for review (griefing guard: one auto-dark per content
    -- until a human reinstates; after that, humans decide).
    CREATE TABLE IF NOT EXISTS content_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      flagger_user_id INTEGER REFERENCES users(id),
      flagger_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      UNIQUE(content_type, content_id, flagger_key)
    );


    -- Inbound inquiries from the public /partners page (sponsors, press,
    -- organizers arriving through the front door). No user_id: senders are
    -- outsiders by definition. Also defensively created by routes/partners.js.
    CREATE TABLE IF NOT EXISTS partner_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    CREATE TABLE IF NOT EXISTS org_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER REFERENCES organizations(id),
      event_name TEXT,
      event_date TEXT,
      event_location TEXT,
      file_path TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS impersonation_tokens (
      token TEXT PRIMARY KEY,
      target_user_id INTEGER REFERENCES users(id),
      target_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER,
      org_id INTEGER,
      tone TEXT,
      prompt TEXT,
      raw_awards_json TEXT,
      original_ai_response TEXT,
      user_edited_response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (studio_id) REFERENCES studios(id),
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS studio_duplicate_exceptions (
      studio_id INTEGER REFERENCES studios(id),
      dancer_name TEXT COLLATE NOCASE,
      PRIMARY KEY (studio_id, dancer_name)
    );

    CREATE TABLE IF NOT EXISTS studio_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      action TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_studio_activity_studio_time ON studio_activity(studio_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_studio_activity_time ON studio_activity(created_at);

    CREATE TABLE IF NOT EXISTS studio_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      email TEXT NOT NULL,
      subject TEXT,
      message_id TEXT,
      sent_by INTEGER REFERENCES users(id),
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_studio_invites_studio ON studio_invites(studio_id);

    CREATE TABLE IF NOT EXISTS email_suppressions (
      email TEXT PRIMARY KEY,
      reason TEXT DEFAULT 'unsubscribe',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Hand-composed organizer invitation letters (superadmin, /admin/orgs).
    -- Unlike studio_invites, the full letter body is stored: the admin edits
    -- the template before sending, so the record is the source of truth for
    -- what was actually said.
    CREATE TABLE IF NOT EXISTS org_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      message_id TEXT,
      sent_by INTEGER REFERENCES users(id),
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id);

    -- Private claim links embedded in organizer invitation letters. Deliberate
    -- design: there is NO public claim button on org pages (an "unclaimed"
    -- state would advertise which orgs aren't partnered yet), so possession
    -- of a mailed token is the whole authorization — claiming is instant,
    -- no admin review round-trip.
    CREATE TABLE IF NOT EXISTS org_claim_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      invite_id INTEGER REFERENCES org_invites(id),
      token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      used_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Who receives review notifications (weekly-import holds, organizer
    -- results uploads). Managed by superadmins at /admin/reviewers; while
    -- empty, utils/reviewers.js falls back to REVIEW_EMAIL then
    -- SUPERADMIN_EMAIL from the environment.
    CREATE TABLE IF NOT EXISTS reviewers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      added_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Persistent org-level first-place decisions (superadmin curation on
    -- /admin/org/:slug/categories). The org page toggle upserts here AND
    -- updates existing awards; imports re-apply rules so new events inherit
    -- the org decision. Event-level toggles remain direct award overrides.
    -- NULL combo fields are stored as '' so the primary key stays unique.
    CREATE TABLE IF NOT EXISTS org_first_place_rules (
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      category TEXT NOT NULL DEFAULT '',
      award_type TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      is_first_place INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (org_id, category, award_type, place)
    );

    -- Fetch bookkeeping for the weekly scrape updater (scripts/weekly_update.js).
    -- One row per cached page file under scripts/raw/; first_fetched_at drives
    -- the "unsettled window" (recently discovered pages get refetched weekly
    -- until they age out), content_hash detects late edits for reporting.
    CREATE TABLE IF NOT EXISTS scrape_log (
      file_path TEXT PRIMARY KEY,
      org_dir TEXT,
      year TEXT,
      first_fetched_at DATETIME,
      last_fetched_at DATETIME,
      content_hash TEXT,
      last_changed_at DATETIME
    );

    -- Per-dancer thank-you lines shown on the flip-book award card's
    -- acknowledgements page. One row per (award, dancer): a group routine
    -- gets one line per teammate ("yearbook back"). Lines are written by
    -- dancer/studio owners but display only after superadmin approval
    -- (concierge moderation, same philosophy as the org logo coin) —
    -- authors are often minors, and a group card surfaces teammates'
    -- lines on every member's public page.
    CREATE TABLE IF NOT EXISTS award_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id INTEGER NOT NULL REFERENCES awards(id),
      dancer_id INTEGER NOT NULL REFERENCES dancers(id),
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(award_id, dancer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_award_acks_award ON award_acknowledgements(award_id);
    CREATE INDEX IF NOT EXISTS idx_award_acks_status ON award_acknowledgements(status);

    -- Per-award photo for the flip-book card's photo page (usually the
    -- routine's performance shot). Scoped per (award, dancer) like the
    -- acknowledgements: on a group routine each family controls the photo
    -- shown on their own dancer's card, so owners never fight over one
    -- slot. The dancer-level default (dancers.card_photo_*) is the
    -- fallback when an award has no photo of its own. Same superadmin
    -- moderation gate (/admin/card-content).
    CREATE TABLE IF NOT EXISTS award_card_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id INTEGER NOT NULL REFERENCES awards(id),
      dancer_id INTEGER NOT NULL REFERENCES dancers(id),
      photo_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      uploaded_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(award_id, dancer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_award_card_photos_dancer ON award_card_photos(dancer_id);
    CREATE INDEX IF NOT EXISTS idx_award_card_photos_status ON award_card_photos(status);

    -- One-time photo-upload consent, per uploader per dancer: the first
    -- upload records the affirmation (parent/guardian or permission from
    -- everyone pictured) and later uploads skip the checkbox. Kept as its
    -- own table (not a dancers column) because studio owners and parents
    -- each affirm for their own uploads.
    CREATE TABLE IF NOT EXISTS card_photo_consents (
      user_id INTEGER NOT NULL REFERENCES users(id),
      dancer_id INTEGER NOT NULL REFERENCES dancers(id),
      consented_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, dancer_id)
    );

    -- Feature flags: deploy dark, release on cadence (deploy ≠ release).
    -- state: 'off' (hidden from everyone), 'beta' (admins + early_access
    -- users), 'on' (everyone). flip_at: optional scheduled promotion to
    -- 'on', applied lazily on read (utils/featureFlags.js) — no cron
    -- needed. Managed at /admin/features.
    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'off',
      flip_at DATETIME,
      notes TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tombstones for dancer-award links a human deliberately removed
    -- (director denied a claim, removed a dancer from a routine).
    -- Automated re-add paths (dancer auto-backfill, future cast-bearing
    -- imports) MUST check this table before inserting; a director
    -- re-adding by hand clears the tombstone. Prevents the classic
    -- "I deleted that and the sync brought it back" surprise.
    CREATE TABLE IF NOT EXISTS award_dancer_removals (
      award_id INTEGER NOT NULL,
      dancer_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'studio_owner',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (award_id, dancer_id)
    );

    -- Demand telemetry for the homepage org cards. DELIBERATE: public org
    -- cards do NOT link to /dance/org pages (org data stays low-profile
    -- until the org partners with us), but clicks are recorded so outreach
    -- can quote real visitor interest ("X% of homepage visitors tried to
    -- open your page"). See routes/dance/public.js + views/index.ejs.
    CREATE TABLE IF NOT EXISTS org_card_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Generic per-day counters. First user: dance_home_views, the
    -- impression denominator for org-card click-through rates.
    CREATE TABLE IF NOT EXISTS daily_counters (
      day TEXT NOT NULL,
      key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, key)
    );

    -- Upcoming Events Directory (ideas.md §7): organizers' future tour
    -- stops, shown on org pages + /dance/events. source: 'owner' (entered
    -- in the dashboard — authoritative, never overwritten by automation),
    -- 'seed' (hand-curated from official sites), 'scraped' (phase 2).
    -- status 'cancelled' keeps the row for history but hides it publicly.
    CREATE TABLE IF NOT EXISTS org_upcoming_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      city TEXT,
      state TEXT,
      venue TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      registration_url TEXT,
      source TEXT NOT NULL DEFAULT 'owner',
      source_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_seen_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_org_upcoming_events_org_date
      ON org_upcoming_events(org_id, start_date);

    -- Directory phase 3: per-user saved events ("My Shortlist") for
    -- studio admins and parents planning their season.
    CREATE TABLE IF NOT EXISTS event_shortlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      upcoming_event_id INTEGER NOT NULL REFERENCES org_upcoming_events(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, upcoming_event_id)
    );

    -- Events-directory telemetry: every Register / Official Site click on
    -- /dance/events. was_gold is snapshotted at click time — gold buttons
    -- move between events and sponsorships lapse, so the row must remember
    -- what the visitor actually saw for gold-vs-standard comparisons to
    -- stay truthful historically. Impression denominators live in
    -- daily_counters ('upcoming_events_views', 'upcoming_events_ics_exports').
    CREATE TABLE IF NOT EXISTS event_reg_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upcoming_event_id INTEGER NOT NULL,
      org_id INTEGER NOT NULL,
      was_gold INTEGER NOT NULL DEFAULT 0,
      link_type TEXT NOT NULL DEFAULT 'register',
      clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_event_reg_clicks_event
      ON event_reg_clicks(upcoming_event_id);

    -- Known flags ship dark; releases happen at /admin/features
    INSERT OR IGNORE INTO feature_flags (key, state) VALUES ('thank_you_notes', 'off');
    INSERT OR IGNORE INTO feature_flags (key, state) VALUES ('award_photos', 'off');
    INSERT OR IGNORE INTO feature_flags (key, state) VALUES ('auto_moderation', 'off');
    INSERT OR IGNORE INTO feature_flags (key, state) VALUES ('reactions', 'off');

    INSERT OR IGNORE INTO system_settings (key, value) VALUES ('openai_model', 'gpt-4o-mini');
    -- Card-content moderation mode: 'manual' (every item human-reviewed),
    -- 'assisted' (machine verdicts shown in the queue, humans still click),
    -- 'auto' (machine-clean notes go live; flagged ones queue). See
    -- utils/moderation.js; the auto_moderation feature flag gates whether
    -- the pipeline runs at all.
    INSERT OR IGNORE INTO system_settings (key, value) VALUES ('moderation_mode', 'manual');
    -- Which award-card design public pages render: 'classic' (two-face
    -- flip) or 'flipbook' (paged back). Superadmin toggle at /admin/settings;
    -- per-session preview override via ?card_design= on dancer pages.
    INSERT OR IGNORE INTO system_settings (key, value) VALUES ('card_design', 'classic');

    -- Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_awards_event ON awards(event_id);
    CREATE INDEX IF NOT EXISTS idx_awards_studio ON awards(studio_id);
    CREATE INDEX IF NOT EXISTS idx_awards_backfill ON awards(event_id, studio_id, performance_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_award_dancers_award ON award_dancers(award_id);
    CREATE INDEX IF NOT EXISTS idx_award_dancers_dancer ON award_dancers(dancer_id);
    CREATE INDEX IF NOT EXISTS idx_events_org ON events(org_id);
  `);
  
  // Migrations
  try { await db.exec('ALTER TABLE studio_merge_requests ADD COLUMN dismissed_at DATETIME'); } catch(e) {}
  // Password reset: SHA-256 of the emailed token (never the token itself —
  // a DB leak must not enable account takeover), plus a short expiry.
  try { await db.exec('ALTER TABLE users ADD COLUMN reset_token_hash TEXT'); } catch(e) {}
  try { await db.exec('ALTER TABLE users ADD COLUMN reset_token_expires DATETIME'); } catch(e) {}
  // Machine-canonical routine key (utils/routineKey.js); filled by
  // scripts/sweep_routine_keys.js — see docs/db_operations.md.
  try { await db.exec('ALTER TABLE awards ADD COLUMN performance_name_key TEXT'); } catch(e) {}
  // Which tier of the org's published hierarchy an award belongs to
  // (1 headline, 2 division overall, 3 named special) — set by
  // scripts/encode_top_awards.js. Lets the platform change what counts as
  // "major" without re-encoding. See docs/major_award_policy.md.
  try { await db.exec('ALTER TABLE awards ADD COLUMN top_award_tier INTEGER'); } catch(e) {}
  try { await db.exec('CREATE INDEX IF NOT EXISTS idx_awards_studio_perfkey ON awards(studio_id, performance_name_key)'); } catch(e) {}
  try { await db.exec('ALTER TABLE studios ADD COLUMN instagram_handle TEXT'); } catch(e) {}
  try { await db.exec('ALTER TABLE studios ADD COLUMN tiktok_handle TEXT'); } catch(e) {}
  try { await db.exec('ALTER TABLE studios ADD COLUMN join_code TEXT'); } catch(e) {}
  try { await db.exec("ALTER TABLE award_dancers ADD COLUMN status TEXT DEFAULT 'imported'"); } catch(e) {}
  try { await db.exec("ALTER TABLE awards ADD COLUMN age_division TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN is_claimed BOOLEAN DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN claimed_by_user_id INTEGER REFERENCES users(id)"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN headshot_url TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN graduation_year INTEGER"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN instagram_handle TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN tiktok_handle TEXT"); } catch(e) {}
  // Flip-book card photo page: uploaded by the dancer or studio owner with
  // guardian consent, public only once card_photo_status = 'approved'
  // (superadmin review at /admin/card-content; statuses: none/pending/
  // approved/rejected). Distinct from headshot_url (a free URL field).
  // Studio-code routing for dancer profile claims: when the claimant
  // provides a valid studio claim code (studios.join_code) for a studio
  // the dancer is affiliated with, studio_id + code_valid route the claim
  // into that studio's Verifications queue (director confirms identity);
  // system admin remains the backstop reviewer either way.
  // Per-feature beta cohort: early_access users see 'beta'-state flags
  try { await db.exec("ALTER TABLE users ADD COLUMN early_access INTEGER DEFAULT 0"); } catch(e) {}
  // Machine-moderation verdict shown in the review queue ('machine-clean',
  // 'auto-approved', or 'flagged: <reasons>'); NULL = never machine-checked
  try { await db.exec("ALTER TABLE award_acknowledgements ADD COLUMN moderation_note TEXT"); } catch(e) {}
  // The verifications dashboard reads ds.created_at, but the column was
  // never in the schema — the page 500'd on any freshly-migrated DB.
  // (ALTER can't add a CURRENT_TIMESTAMP default; existing rows stay NULL,
  // which the view already tolerates.)
  try { await db.exec("ALTER TABLE dancer_studios ADD COLUMN created_at DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancer_claims ADD COLUMN studio_id INTEGER REFERENCES studios(id)"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancer_claims ADD COLUMN code_valid INTEGER DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN card_photo_url TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN card_photo_status TEXT DEFAULT 'none'"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN card_photo_uploaded_by INTEGER REFERENCES users(id)"); } catch(e) {}
  
  try { await db.exec("ALTER TABLE organizations ADD COLUMN owner_id INTEGER REFERENCES users(id)"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN logo_url TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN custom_icons TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN description TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN slogan TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN data_since INTEGER"); } catch(e) {}
  try { await db.exec("ALTER TABLE events ADD COLUMN logo_url TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE users ADD COLUMN verification_token TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE users ADD COLUMN verification_token_expires DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN award_metadata TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN public_preferences TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE awards ADD COLUMN award_class TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE awards ADD COLUMN is_first_place INTEGER DEFAULT 0"); } catch(e) {}
  // Superadmin-marked "top award of its event" (set in batch via the award
  // vocabulary editor at /admin/orgs/:id/award-vocab). The hook for surfaces
  // that need each org's genuinely top honors (marquee picks, future HOF).
  try { await db.exec("ALTER TABLE awards ADD COLUMN is_top_award INTEGER DEFAULT 0"); } catch(e) {}
  // Organizer-objection readiness (see org_invite_draft.md "objection
  // response"): 'public' (default) | 'unlisted' (org page 404s publicly,
  // homepage card gone; awards still shown) | 'hidden' (phase 2: awards
  // excluded from all public surfaces except claimed owners' own views —
  // enforcement not yet built, state reserved). Set at /admin/orgs.
  try { await db.exec("ALTER TABLE organizations ADD COLUMN visibility TEXT DEFAULT 'public'"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN visibility_note TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE org_upcoming_events ADD COLUMN lat REAL"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN is_sponsor INTEGER DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE org_upcoming_events ADD COLUMN gold TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE org_upcoming_events ADD COLUMN lng REAL"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN auto_featured_rank INTEGER"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN auto_featured_since DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN auto_feature_cooldown_until DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN onboarding_dismissed INTEGER DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN vanity_tag TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN hide_from_rankings INTEGER DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancers ADD COLUMN hide_from_search INTEGER DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN branding_terms_accepted_at DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE dancer_studios ADD COLUMN source TEXT DEFAULT 'import'"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN frozen_at DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN frozen_prev_owner_id INTEGER REFERENCES users(id)"); } catch(e) {}
  try { await db.exec("ALTER TABLE organizations ADD COLUMN branding_terms_accepted_by INTEGER REFERENCES users(id)"); } catch(e) {}
  try {
    // Importers leave created_at NULL; weekly_update.js stamps NULLs after
    // each run, which is also how it detects "events added by this run".
    await db.exec("ALTER TABLE events ADD COLUMN created_at DATETIME");
    // Column just created: stamp pre-existing events with the era of the last
    // full scrape so they read as long-settled rather than brand new.
    await db.exec("UPDATE events SET created_at = '2026-05-15 00:00:00'");
  } catch(e) {}

  // Director's private tag for a dancer within their studio ("Senior Mia",
  // "Mia 2018") — shown only on studio-management surfaces to distinguish
  // same-name dancers; never on public pages.
  try { await db.exec("ALTER TABLE dancer_studios ADD COLUMN label TEXT"); } catch(e) {}

  // Link provenance: who asserted each dancer-award link ('import' |
  // 'studio_owner' | 'dancer_claim' | 'admin') and when. Importers don't
  // set source (the ADD COLUMN default covers them); human surfaces set
  // it explicitly. Legacy rows: claim-flow links are recoverable from
  // status; everything else predates provenance and reads as 'import'.
  try { await db.exec("ALTER TABLE award_dancers ADD COLUMN source TEXT DEFAULT 'import'"); } catch(e) {}
  try { await db.exec("ALTER TABLE award_dancers ADD COLUMN created_at DATETIME"); } catch(e) {}
  try {
    await db.exec("UPDATE award_dancers SET source = 'dancer_claim' WHERE status IN ('pending', 'verified') AND source = 'import'");
  } catch(e) {}
  // created_at stamp via trigger (not per-writer code) so importers and
  // future writers can't forget it. Must run AFTER the column ALTERs.
  try {
    await db.exec(`CREATE TRIGGER IF NOT EXISTS trg_award_dancers_created
      AFTER INSERT ON award_dancers
      WHEN NEW.created_at IS NULL
      BEGIN
        UPDATE award_dancers SET created_at = datetime('now') WHERE id = NEW.id;
      END`);
  } catch(e) {}

  console.log("Database initialized.");
  return db;
}

// Re-assert stored org_first_place_rules onto awards. Scope with eventId
// right after importing an event so per-event overrides on OTHER events
// survive; org-wide (no eventId) re-asserts the org decision everywhere,
// overwriting conflicting event-level toggles.
async function applyOrgFirstPlaceRules(db, { orgId = null, eventId = null } = {}) {
  if (eventId && !orgId) {
    const ev = await db.get('SELECT org_id FROM events WHERE id = ?', [eventId]);
    if (!ev) throw new Error(`Event ${eventId} not found`);
    orgId = ev.org_id;
  }
  const rules = await db.all(
    `SELECT org_id, category, award_type, place, is_first_place
     FROM org_first_place_rules${orgId ? ' WHERE org_id = ?' : ''}`,
    orgId ? [orgId] : []);
  let changed = 0;
  for (const r of rules) {
    const scopeSql = eventId ? 'event_id = ?' : 'event_id IN (SELECT id FROM events WHERE org_id = ?)';
    const res = await db.run(`
      UPDATE awards SET is_first_place = ?
      WHERE ${scopeSql}
        AND category IS ? AND award_type IS ? AND place IS ?
        AND is_first_place != ?`,
      [r.is_first_place, eventId || r.org_id,
       r.category === '' ? null : r.category,
       r.award_type === '' ? null : r.award_type,
       r.place === '' ? null : r.place,
       r.is_first_place]);
    changed += res.changes;
  }
  return { rules: rules.length, changed };
}

if (require.main === module) {
  initDb().then(() => {
    console.log("Initialization complete.");
    process.exit(0);
  });
}

module.exports = { openDb, initDb, applyOrgFirstPlaceRules };
