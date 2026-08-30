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

module.exports = { canonicalizeRoutine, routineKeySql };
