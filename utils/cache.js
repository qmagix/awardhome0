// Tiny in-memory TTL cache for expensive read paths (single-process app).
// cached() dedupes concurrent misses: while one caller computes, others
// await the same promise instead of stampeding the database.

const store = new Map(); // key -> { value: Promise, expires: number }

async function cached(key, ttlMs, compute) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = compute();
  store.set(key, { value, expires: Date.now() + ttlMs });
  try {
    return await value;
  } catch (err) {
    store.delete(key); // never cache a failure
    throw err;
  }
}

function invalidate(key) {
  store.delete(key);
}

module.exports = { cached, invalidate };
