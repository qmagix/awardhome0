// The offline outbox (development plan M7).
//
// THE SCENE THIS EXISTS FOR: a parent at a competition venue, on wifi that
// barely works, entering a weekend of results between routines. Every award
// must survive that, and every award must arrive EXACTLY ONCE — a duplicate
// here is a duplicate in the archive, which is the failure this whole product
// spends its effort avoiding.
//
// HOW EXACTLY-ONCE IS ACHIEVED, and where the work actually happens:
//
//   The client mints a `client_submission_id` (a UUID) when the draft is
//   CREATED — not when it is sent. The server is idempotent on
//   (user, client_submission_id) and returns the original row for a repeat
//   (utils/submissions.js). So the client's job is not "send exactly once",
//   which is impossible over an unreliable network; it is "always send the
//   same id for the same draft". That is a much easier promise to keep, and
//   it survives a crash mid-request, a timeout that actually succeeded, and a
//   process death between send and acknowledgement.
//
//   The consequence worth stating: a draft may be sent MANY times. That is
//   fine and expected. What must never happen is a draft being sent under two
//   different ids, so the id is written to disk before the first attempt and
//   never regenerated.
//
// Like src/api/tokens.ts, this module imports nothing from React Native — the
// database and the network are injected — so the logic can be tested in plain
// Node instead of only in a simulator.

export type DraftStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface Draft {
  clientSubmissionId: string;
  payload: Record<string, unknown>;
  status: DraftStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  /** Server id once accepted — proof this draft reached the archive. */
  submissionId: number | null;
}

/** The two rows-and-queries operations the outbox needs, so any store can back
 *  it: expo-sqlite in the app, an in-memory map in the tests. */
export interface DraftStore {
  put(draft: Draft): Promise<void>;
  all(): Promise<Draft[]>;
  get(id: string): Promise<Draft | null>;
  remove(id: string): Promise<void>;
}

export interface OutboxOptions {
  store: DraftStore;
  /** Posts one submission; resolves with the server's response. */
  send: (payload: Record<string, unknown>) => Promise<{ submission?: { id: number } }>;
  now?: () => number;
  uuid?: () => string;
  /** Called after every flush so the UI can re-render counts. */
  onChange?: () => void;
}

/** Give up retrying automatically after this many failures. The draft is NOT
 *  discarded — it stays on disk, visible, and the family can retry by hand.
 *  Silently dropping someone's record of their child's award is the one
 *  outcome worse than a stuck queue. */
const MAX_AUTO_ATTEMPTS = 8;

export function createOutbox(opts: OutboxOptions) {
  const now = opts.now ?? (() => Date.now());
  const uuid = opts.uuid ?? (() => globalThis.crypto.randomUUID());
  // Single-flight, for the same reason the token refresh is: two concurrent
  // flushes would send the same drafts twice, and while the server would
  // deduplicate them, it doubles the traffic on exactly the bad network this
  // exists to cope with.
  let flushing: Promise<FlushResult> | null = null;

  async function enqueue(payload: Record<string, unknown>): Promise<Draft> {
    // The id is minted HERE, at creation, and written before any attempt.
    // Minting it at send time would produce a new id per retry and a duplicate
    // award per retry.
    const draft: Draft = {
      clientSubmissionId: uuid(),
      payload,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now(),
      submissionId: null,
    };
    await opts.store.put(draft);
    opts.onChange?.();
    return draft;
  }

  async function pending(): Promise<Draft[]> {
    const all = await opts.store.all();
    return all
      .filter(d => d.status === 'pending' || d.status === 'failed')
      .sort((a, b) => a.createdAt - b.createdAt); // a weekend arrives in order
  }

  interface FlushResult { sent: number; failed: number; remaining: number }

  async function doFlush(): Promise<FlushResult> {
    const queue = await pending();
    let sent = 0, failed = 0;

    for (const draft of queue) {
      if (draft.attempts >= MAX_AUTO_ATTEMPTS) continue;
      await opts.store.put({ ...draft, status: 'sending' });
      try {
        const res = await opts.send({
          ...draft.payload,
          // Always the same id for this draft. This single line is what makes
          // the whole thing exactly-once.
          client_submission_id: draft.clientSubmissionId,
        });
        await opts.store.put({
          ...draft,
          status: 'sent',
          attempts: draft.attempts + 1,
          lastError: null,
          submissionId: res.submission?.id ?? null,
        });
        sent++;
      } catch (err) {
        await opts.store.put({
          ...draft,
          status: 'failed',
          attempts: draft.attempts + 1,
          lastError: err instanceof Error ? err.message : String(err),
        });
        failed++;
        // Keep going. One bad draft — a deleted dancer, a rejected field —
        // must not block the rest of the weekend behind it.
      }
    }

    const remaining = (await pending()).filter(d => d.attempts < MAX_AUTO_ATTEMPTS).length;
    opts.onChange?.();
    return { sent, failed, remaining };
  }

  return {
    enqueue,
    pending,

    /** Flush the queue. Concurrent callers share one pass. */
    flush(): Promise<FlushResult> {
      if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
      return flushing;
    },

    /** Drafts that have exhausted automatic retries and need a human. */
    async stuck(): Promise<Draft[]> {
      return (await opts.store.all()).filter(
        d => d.status === 'failed' && d.attempts >= MAX_AUTO_ATTEMPTS);
    },

    /** Manual retry: clears the attempt count so automatic flushing resumes. */
    async retry(id: string): Promise<void> {
      const d = await opts.store.get(id);
      if (!d) return;
      await opts.store.put({ ...d, status: 'pending', attempts: 0, lastError: null });
      opts.onChange?.();
    },

    /** Discard a draft. Only ever called from an explicit user action — the
     *  outbox never drops anything on its own. */
    async discard(id: string): Promise<void> {
      await opts.store.remove(id);
      opts.onChange?.();
    },

    async counts(): Promise<{ pending: number; sent: number; stuck: number }> {
      const all = await opts.store.all();
      return {
        pending: all.filter(d => (d.status === 'pending' || d.status === 'failed') && d.attempts < MAX_AUTO_ATTEMPTS).length,
        sent: all.filter(d => d.status === 'sent').length,
        stuck: all.filter(d => d.status === 'failed' && d.attempts >= MAX_AUTO_ATTEMPTS).length,
      };
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
export { MAX_AUTO_ATTEMPTS };
