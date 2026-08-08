const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

// Single shared connection for the whole process. sqlite3 serializes
// statements on one connection, and WAL + busy_timeout handle contention
// with other processes (import scripts, sqlite3 CLI).
// NOTE: foreign_keys stays OFF — the live data has known orphaned
// awards.dancer_id references that must be cleaned up before enforcement.
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await open({
        filename: path.join(__dirname, 'database.sqlite'),
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

    INSERT OR IGNORE INTO system_settings (key, value) VALUES ('openai_model', 'gpt-4o-mini');

    -- Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_awards_event ON awards(event_id);
    CREATE INDEX IF NOT EXISTS idx_awards_studio ON awards(studio_id);
    CREATE INDEX IF NOT EXISTS idx_awards_backfill ON awards(event_id, studio_id, performance_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_award_dancers_award ON award_dancers(award_id);
    CREATE INDEX IF NOT EXISTS idx_award_dancers_dancer ON award_dancers(dancer_id);
    CREATE INDEX IF NOT EXISTS idx_events_org ON events(org_id);
  `);
  
  // Migrations
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
  try { await db.exec("ALTER TABLE studios ADD COLUMN auto_featured_rank INTEGER"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN auto_featured_since DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN auto_feature_cooldown_until DATETIME"); } catch(e) {}
  try { await db.exec("ALTER TABLE studios ADD COLUMN onboarding_dismissed INTEGER DEFAULT 0"); } catch(e) {}

  console.log("Database initialized.");
  return db;
}

if (require.main === module) {
  initDb().then(() => {
    console.log("Initialization complete.");
    process.exit(0);
  });
}

module.exports = { openDb, initDb };
