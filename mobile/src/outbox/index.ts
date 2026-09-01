// The app's single outbox instance, plus the connectivity trigger.
//
// Flushing is attempted on a timer and whenever the network comes back, never
// only on a button. At a venue the family is between routines, not watching a
// sync screen — the queue should drain itself the moment there is signal.
import * as Network from 'expo-network';
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
});

export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Try to drain the queue. Checks connectivity first only as an optimisation —
 * a wrong "offline" reading must not stop a flush, so an unknown state still
 * attempts the send and lets the request itself be the judge.
 */
export async function flushIfPossible(): Promise<void> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isInternetReachable === false) return;
  } catch {
    // Fall through: attempting and failing costs one request.
  }
  if (!(await auth.isSignedIn())) return; // nothing to send as a guest
  try {
    await outbox.flush();
  } catch {
    // flush() already records per-draft errors; nothing further to do here.
  }
}

/** Start the background drain. Idempotent. */
export function startOutboxSync(intervalMs = 30_000): void {
  if (timer) return;
  void flushIfPossible();
  timer = setInterval(() => { void flushIfPossible(); }, intervalMs);
}

export function stopOutboxSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
