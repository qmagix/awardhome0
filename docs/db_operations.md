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
