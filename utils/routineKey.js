// Machine-canonical routine key: the single place where "same routine,
// different spelling" folds are defined. Derived — NEVER written back into
// performance_name (the raw name is the source-of-record and every
// importer's idempotency anchor). Stored in awards.performance_name_key by
// scripts/sweep_routine_keys.js; readers fall back to LOWER(TRIM()) for
// rows imported since the last sweep.
function canonicalizeRoutine(raw) {
  if (raw == null) return null;
  let s = String(raw).normalize('NFKC');
  s = s
    .replace(/[‘’ʼ`´]/g, "'") // curly/modifier apostrophes, backtick, acute
    .replace(/[“”]/g, '"')                   // curly double quotes
    .replace(/[–—−]/g, '-')             // en/em dash, minus sign
    .replace(/ /g, ' ');                          // no-break space
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s || null;
}

// SQL fragment for reading the key with the unswept-row fallback.
// `alias` is the awards table alias in the calling query.
function routineKeySql(alias = 'a') {
  return `IFNULL(${alias}.performance_name_key, LOWER(TRIM(IFNULL(${alias}.performance_name, ''))))`;
}

// ---- Phase 2: per-studio owner-declared aliases ----
// True misspellings the machine can't fold ("Kongfu"/"Kungfu Kiddies"):
// the owner merges spellings and picks the correct one. Aliases NEVER touch
// performance_name — they redirect the stored performance_name_key (and
// carry the preferred display spelling), so removing an alias fully
// restores machine behavior via resweepStudioKeys.

async function ensureRoutineAliasTable(db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS studio_routine_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_id INTEGER NOT NULL REFERENCES studios(id),
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      display_name TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(studio_id, from_key)
    )`);
}

// Canonicalize + apply this studio's aliases — what write-path matching
// should use for a client-sent routine spelling.
async function resolveRoutineKey(db, studioId, routine) {
  const k = canonicalizeRoutine(routine);
  if (!k) return k;
  await ensureRoutineAliasTable(db);
  const al = await db.get(
    'SELECT to_key FROM studio_routine_aliases WHERE studio_id = ? AND from_key = ?', [studioId, k]);
  return al ? al.to_key : k;
}

// Recompute every stored key for one studio from scratch (machine canonical
// + current aliases). Used after an alias is removed.
async function resweepStudioKeys(db, studioId) {
  await ensureRoutineAliasTable(db);
  const aliasRows = await db.all(
    'SELECT from_key, to_key FROM studio_routine_aliases WHERE studio_id = ?', [studioId]);
  const amap = new Map(aliasRows.map(r => [r.from_key, r.to_key]));
  const rows = await db.all(
    'SELECT id, performance_name, performance_name_key FROM awards WHERE studio_id = ?', [studioId]);
  let changed = 0;
  for (const r of rows) {
    let k = canonicalizeRoutine(r.performance_name);
    if (k && amap.has(k)) k = amap.get(k);
    if (k !== (r.performance_name_key || null)) {
      await db.run('UPDATE awards SET performance_name_key = ? WHERE id = ?', [k, r.id]);
      changed++;
    }
  }
  return changed;
}

module.exports = { canonicalizeRoutine, routineKeySql, ensureRoutineAliasTable, resolveRoutineKey, resweepStudioKeys };
