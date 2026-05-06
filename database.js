const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function openDb() {
  return open({
    filename: path.join(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });
}

async function initDb() {
  const db = await openDb();
  
  // Drop tables for migration
  await db.exec(`
    DROP TABLE IF EXISTS awards;
    DROP TABLE IF EXISTS dancer_studios;
    DROP TABLE IF EXISTS dancers;
    DROP TABLE IF EXISTS studios;
    DROP TABLE IF EXISTS events;
    DROP TABLE IF EXISTS organizations;
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      website TEXT
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
      view_count INTEGER DEFAULT 0
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
    CREATE TABLE IF NOT EXISTS dancers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      birthday TEXT,
      change_log TEXT,
      needs_investigation BOOLEAN DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS dancer_studios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dancer_id INTEGER NOT NULL,
      studio_id INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
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
      dancer_id INTEGER,
      studio_id INTEGER,
      notes TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (dancer_id) REFERENCES dancers(id),
      FOREIGN KEY (studio_id) REFERENCES studios(id)
    );
    CREATE TABLE IF NOT EXISTS award_dancers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id INTEGER NOT NULL,
      dancer_id INTEGER NOT NULL,
      FOREIGN KEY (award_id) REFERENCES awards(id),
      FOREIGN KEY (dancer_id) REFERENCES dancers(id),
      UNIQUE(award_id, dancer_id)
    );
  `);
  
  // Migrations
  try { await db.exec('ALTER TABLE studios ADD COLUMN instagram_handle TEXT'); } catch(e) {}
  try { await db.exec('ALTER TABLE studios ADD COLUMN tiktok_handle TEXT'); } catch(e) {}

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
