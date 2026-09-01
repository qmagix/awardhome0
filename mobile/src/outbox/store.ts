import * as SQLite from 'expo-sqlite';
import type { Draft, DraftStore } from './outbox';

/**
 * expo-sqlite backing for the outbox.
 *
 * SQLite rather than AsyncStorage because these rows are a family's record of
 * their child's awards before anything has reached the server. A JSON blob
 * rewritten in full on every change loses the lot on a partial write; a real
 * database with per-row writes does not, and a phone killed mid-save at a
 * competition venue is a completely ordinary event.
 *
 * The payload is stored as JSON because its shape follows the submission API
 * rather than this table — adding a field to the Add flow should not need a
 * migration on a device that may be offline for a week.
 */
const DB_NAME = 'awardhome-outbox.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS drafts (
          client_submission_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          submission_id INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status, created_at);
        -- Small durable key/value beside the queue. Its one job today is the
        -- active event session: picking an event needs the network, and the
        -- session has to survive the app being killed so the rest of the
        -- weekend can be entered with no signal at all.
        CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      `);
      return db;
    })();
  }
  return dbPromise;
}

interface Row {
  client_submission_id: string;
  payload: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  submission_id: number | null;
}

function toDraft(r: Row): Draft {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(r.payload) as Record<string, unknown>;
  } catch {
    // A corrupt payload must not crash the queue on launch; the draft shows as
    // stuck and the family can discard it.
    payload = {};
  }
  return {
    clientSubmissionId: r.client_submission_id,
    payload,
    status: r.status as Draft['status'],
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    submissionId: r.submission_id,
  };
}

export const sqliteDraftStore: DraftStore = {
  async put(d) {
    const db = await open();
    await db.runAsync(
      `INSERT INTO drafts (client_submission_id, payload, status, attempts, last_error, created_at, submission_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_submission_id) DO UPDATE SET
         payload = excluded.payload, status = excluded.status, attempts = excluded.attempts,
         last_error = excluded.last_error, submission_id = excluded.submission_id`,
      [d.clientSubmissionId, JSON.stringify(d.payload), d.status, d.attempts,
       d.lastError, d.createdAt, d.submissionId],
    );
  },

  async all() {
    const db = await open();
    const rows = await db.getAllAsync<Row>('SELECT * FROM drafts ORDER BY created_at ASC');
    return rows.map(toDraft);
  },

  async get(id) {
    const db = await open();
    const row = await db.getFirstAsync<Row>(
      'SELECT * FROM drafts WHERE client_submission_id = ?', [id]);
    return row ? toDraft(row) : null;
  },

  async remove(id) {
    const db = await open();
    await db.runAsync('DELETE FROM drafts WHERE client_submission_id = ?', [id]);
  },
};

// ---- Durable key/value -----------------------------------------------------

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (value === null || value === undefined) {
    await db.runAsync('DELETE FROM kv WHERE k = ?', [key]);
    return;
  }
  await db.runAsync(
    'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    [key, JSON.stringify(value)],
  );
}
