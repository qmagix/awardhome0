// Resolve a studio name from an importer to an existing studio row, tolerating
// the spelling variance that real result documents contain.
//
// Why this exists: importers matched studio names with `WHERE name = ?` --
// exact and case-SENSITIVE. Any org whose extractor is later corrected then
// emits slightly different text ("HappyFeet Dance Company" where the DB holds
// "Happy Feet Dance Company", verified as one word in the StarQuest source),
// so the importer mints a second studio and every award under it duplicates.
// A StarQuest re-import produced 2,470 such duplicate-studio awards.
//
// Resolution runs widest-last, so the safest match always wins:
//   1. exact           the fast path, unchanged behaviour
//   2. whitespace      tabs/double spaces collapsed
//   3. case            "4PM Dance" == "4pm Dance"
//   4. spacing         "HappyFeet" == "Happy Feet"
//   5. punctuation     "Steppin' Out" == "Steppin Out", "Co." == "Co"
//
// A row found at any tier is followed through merged_into_id to its live
// survivor, so historical spellings keep resolving after a merge. Chains are
// followed to the terminal studio -- callers that follow only one hop would
// otherwise land on a dead row.
//
// Tier 5 is deliberately the last resort: it is the only one that could join
// two genuinely different studios, and by then every safer reading has failed.

const NORMALIZERS = [
  { tier: 'case', sql: `LOWER(TRIM(name)) = ?`, key: (n) => n.toLowerCase() },
  { tier: 'space', sql: `REPLACE(LOWER(TRIM(name)), ' ', '') = ?`, key: (n) => n.toLowerCase().replace(/\s+/g, '') },
  {
    tier: 'punct',
    sql: `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(name)), ' ', ''), '.', ''), ',', ''), '''', ''), '-', ''), '&', '') = ?`,
    key: (n) => n.toLowerCase().replace(/[\s.,'\-&]/g, ''),
  },
];

// Follow merged_into_id to the live studio. Bounded: a cycle must not hang an
// import.
async function followMerges(db, row) {
  let cur = row, hops = 0;
  while (cur && cur.status === 'merged' && cur.merged_into_id && hops++ < 20) {
    const next = await db.get(
      'SELECT id, status, merged_into_id FROM studios WHERE id = ?', [cur.merged_into_id]);
    if (!next || next.id === cur.id) break;
    cur = next;
  }
  return cur ? cur.id : null;
}

// Returns { id, tier } — tier says how the match was made, so importers can
// report anything resolved by a loose tier. `create: false` returns null
// instead of inserting.
async function resolveStudio(db, rawName, opts = {}) {
  const { create = true, generateStudioId } = opts;
  const name = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!name) return { id: null, tier: 'empty' };

  let row = await db.get('SELECT id, status, merged_into_id FROM studios WHERE name = ?', [rawName]);
  let tier = 'exact';
  if (!row && name !== rawName) {
    row = await db.get('SELECT id, status, merged_into_id FROM studios WHERE name = ?', [name]);
    tier = 'whitespace';
  }
  if (!row) {
    for (const n of NORMALIZERS) {
      // Prefer a LIVE row when several variants match this key.
      row = await db.get(
        `SELECT id, status, merged_into_id FROM studios WHERE ${n.sql}
         ORDER BY (CASE WHEN IFNULL(status,'') = 'merged' THEN 1 ELSE 0 END), id LIMIT 1`, [n.key(name)]);
      if (row) { tier = n.tier; break; }
    }
  }

  if (row) return { id: await followMerges(db, row), tier };
  if (!create) return { id: null, tier: 'missing' };

  const uniqueId = generateStudioId ? generateStudioId(name) : 'STD-' + require('crypto').randomUUID();
  const res = await db.run('INSERT INTO studios (unique_id, name) VALUES (?, ?)', [uniqueId, name]);
  return { id: res.lastID, tier: 'created' };
}

module.exports = { resolveStudio, followMerges };
