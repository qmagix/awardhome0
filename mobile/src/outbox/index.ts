// The app's single outbox instance, plus the connectivity trigger.
//
// Flushing is attempted on a timer and whenever the network comes back, never
// only on a button. At a venue the family is between routines, not watching a
// sync screen — the queue should drain itself the moment there is signal.
import { createOutbox } from './outbox';
import { sqliteDraftStore } from './store';
import { auth } from '@/api/client';

export type { Draft } from './outbox';

async function postSubmission(payload: Record<string, unknown>): Promise<{ submission?: { id: number } }> {
  return auth.request('/submissions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

const listeners = new Set<() => void>();

export const outbox = createOutbox({
  store: sqliteDraftStore,
  send: postSubmission,
  onChange: () => { listeners.forEach(l => l()); },
  // Pivot P1: a draft made before the account exists names its dancer by
  // typed name. It is safe on disk but not yet sendable — the flush skips it
  // without burning retries until attach() gives it a dancer id.
  sendable: (p) => p['dancer_id'] != null,
});

/**
 * After sign-in (or any household refresh): connect guest drafts to the
 * household's dancers by typed name, then try to drain whatever that made
 * sendable. Never throws — a failed attach costs the sync, not the caller.
 */
export async function attachGuestDrafts(dancers: { id: number; name: string }[]): Promise<void> {
  try {
    const attached = await outbox.attach(dancers);
    if (attached > 0) await flushIfPossible();
  } catch {
    // Drafts are still on disk; the next refresh retries the attach.
  }
}

export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Is the internet reachable? `null` means we could not find out.
 *
 * expo-network is loaded LAZILY and its absence is tolerated, because it is
 * only an optimisation. A binary built before this dependency existed throws
 * "Cannot find native module 'ExpoNetwork'" on import — and a top-level import
 * would take this whole module down with it, which took out the root layout
 * (startOutboxSync became undefined) and both routes that import from here.
 * An optional capability must not be an import-time hard dependency.
 */
async function isInternetReachable(): Promise<boolean | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Network = require('expo-network') as typeof import('expo-network');
    const state = await Network.getNetworkStateAsync();
    return state.isInternetReachable ?? null;
  } catch {
    return null; // module missing, or the check failed — we simply don't know
  }
}

/**
 * Try to drain the queue. Checks connectivity first only as an optimisation —
 * a wrong or unavailable "offline" reading must not stop a flush, so anything
 * other than a definite "no" still attempts the send and lets the request
 * itself be the judge.
 */
export async function flushIfPossible(): Promise<void> {
  if ((await isInternetReachable()) === false) return;
  if (!(await auth.isSignedIn())) return; // nothing to send as a guest
  try {
    await outbox.flush();
  } catch {
    // flush() already records per-draft errors; nothing further to do here.
  }
}

/** Start the background drain. Idempotent, and never throws: a queue that
 *  cannot start is a degraded app, not a blank screen. */
export function startOutboxSync(intervalMs = 30_000): void {
  if (timer) return;
  void flushIfPossible();
  timer = setInterval(() => { void flushIfPossible(); }, intervalMs);
}

export function stopOutboxSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
