// Tiny in-memory TTL cache for expensive read paths (single-process app).
// cached() dedupes concurrent misses: while one caller computes, others
// await the same promise instead of stampeding the database.
//
// Once a value exists, callers never wait again: an expired entry is served
// stale while a single background recompute refreshes it. The homepage
// recompute takes seconds (see routes/dance/public.js), and its data only
// really changes on the weekly import and admin edits, so briefly-stale
// reads are always the right trade.

const store = new Map(); // key -> { value: Promise, expires, compute, ttlMs, refreshing }

async function cached(key, ttlMs, compute) {
  const hit = store.get(key);
  if (hit) {
    hit.compute = compute;
    hit.ttlMs = ttlMs;
    if (hit.expires <= Date.now()) refresh(key);
    return hit.value; // possibly stale while the refresh runs
  }

  const entry = { value: compute(), expires: Date.now() + ttlMs, compute, ttlMs, refreshing: null };
  store.set(key, entry);
  try {
    return await entry.value;
  } catch (err) {
    if (store.get(key) === entry) store.delete(key); // never cache a failure
    throw err;
  }
}

// Recompute in the background and swap the new value in on success (also
// resets the TTL). Callers keep getting the previous value until the new one
// is ready — nobody waits. Use instead of invalidate() when the data should
// update soon but no request should ever pay the recompute. No-op if the key
// was never computed or a refresh is already running; on failure the stale
// value keeps serving and the next expired hit retries.
function refresh(key) {
  const entry = store.get(key);
  if (!entry || entry.refreshing) return;
  entry.refreshing = Promise.resolve()
    .then(() => entry.compute())
    .then(v => {
      entry.value = Promise.resolve(v);
      entry.expires = Date.now() + entry.ttlMs;
    })
    .catch(err => {
      console.error(`[cache] background refresh of "${key}" failed:`, err.message);
    })
    .finally(() => { entry.refreshing = null; });
}

function invalidate(key) {
  store.delete(key);
}

module.exports = { cached, refresh, invalidate };
