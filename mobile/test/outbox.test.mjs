// Outbox tests — M7's acceptance criterion, run in plain Node.
//
// "A parent adds a weekend of results offline at a venue; all submissions
// arrive exactly once and batch under one event session."
//
// Exactly-once is the part worth testing hard, because the failure is silent
// and permanent: a duplicate here becomes a duplicate award in an archive
// whose whole value is not having those. The client cannot guarantee
// at-most-once delivery over a bad network — nothing can — so instead it
// guarantees that a draft is always sent under the SAME id, and lets the
// server's idempotency collapse the repeats. These tests exercise exactly
// that contract, including the cases where the network lies.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createOutbox, MAX_AUTO_ATTEMPTS } = await import('../src/outbox/outbox.ts');

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async put(d) { rows.set(d.clientSubmissionId, { ...d }); },
    async all() { return [...rows.values()]; },
    async get(id) { return rows.get(id) ?? null; },
    async remove(id) { rows.delete(id); },
  };
}

/** A server that is idempotent on client_submission_id, like the real one. */
function fakeServer({ failTimes = 0, failForever = false } = {}) {
  const seen = new Map();     // client_submission_id -> submission id
  const received = [];        // every request, including repeats
  let nextId = 1;
  let failures = 0;
  return {
    seen, received,
    get uniqueCount() { return seen.size; },
    async send(payload) {
      received.push(payload);
      if (failForever || failures < failTimes) { failures++; throw new Error('network down'); }
      const key = payload.client_submission_id;
      if (!seen.has(key)) seen.set(key, nextId++);
      return { submission: { id: seen.get(key) }, idempotent: false };
    },
  };
}

let counter = 0;
const seq = () => `draft-${++counter}`;

test('a weekend entered offline arrives exactly once', async () => {
  const store = memoryStore();
  const server = fakeServer({ failTimes: 99 }); // the venue wifi is down
  const outbox = createOutbox({ store, send: server.send, uuid: seq });

  // Six results, entered between routines with no connectivity.
  for (let i = 0; i < 6; i++) {
    await outbox.enqueue({ performance_name: `Routine ${i}`, group_size: 'small_group' });
  }
  await outbox.flush();
  assert.equal(server.uniqueCount, 0, 'nothing reached the server while offline');
  assert.equal((await outbox.counts()).pending, 6, 'all six are still queued');

  // In the car park, signal returns.
  const online = fakeServer();
  const outbox2 = createOutbox({ store, send: online.send, uuid: seq });
  await outbox2.flush();

  assert.equal(online.uniqueCount, 6, 'six awards arrived');
  assert.equal((await outbox2.counts()).pending, 0, 'the queue drained');
});

test('a retried draft is never a second award', async () => {
  const store = memoryStore();
  // Fails twice, then works — the classic flaky-network shape.
  const server = fakeServer({ failTimes: 2 });
  const outbox = createOutbox({ store, send: server.send, uuid: seq });

  await outbox.enqueue({ performance_name: 'Fireworks', group_size: 'small_group' });
  await outbox.flush();  // fails
  await outbox.flush();  // fails
  await outbox.flush();  // succeeds

  assert.equal(server.received.length, 3, 'it really was sent three times');
  assert.equal(server.uniqueCount, 1, 'and produced exactly one award');
  const ids = new Set(server.received.map(r => r.client_submission_id));
  assert.equal(ids.size, 1, 'every attempt carried the SAME id — the whole trick');
});

test('the id is minted at creation, before any attempt', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq });

  const draft = await outbox.enqueue({ performance_name: 'Solo' });
  const onDisk = await store.get(draft.clientSubmissionId);
  assert.ok(onDisk, 'the draft is on disk before anything is sent');
  assert.equal(onDisk.attempts, 0);
  assert.equal(server.received.length, 0, 'nothing was sent yet');

  await outbox.flush();
  assert.equal(server.received[0].client_submission_id, draft.clientSubmissionId,
    'the id written at creation is the id sent');
});

test('a response lost in transit does not duplicate the award', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq });
  await outbox.enqueue({ performance_name: 'Lost Ack' });

  // The request SUCCEEDS on the server and the reply never arrives — the
  // nastiest case, because the client cannot tell it from a real failure.
  const flaky = createOutbox({
    store, uuid: seq,
    send: async (p) => { await server.send(p); throw new Error('timeout'); },
  });
  await flaky.flush();
  assert.equal(server.uniqueCount, 1);

  // The client retries, believing it failed.
  await outbox.flush();
  assert.equal(server.uniqueCount, 1, 'still one award, not two');
  assert.equal(server.received.length, 2, 'even though it was sent twice');
});

test('concurrent flushes do not double-send', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq });
  for (let i = 0; i < 3; i++) await outbox.enqueue({ performance_name: `R${i}` });

  await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
  assert.equal(server.received.length, 3, 'three requests, not nine');
  assert.equal(server.uniqueCount, 3);
});

test('one bad draft does not block the rest of the weekend', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({
    store, uuid: seq,
    send: async (p) => {
      if (p.performance_name === 'Poisoned') throw new Error('dancer was deleted');
      return server.send(p);
    },
  });
  await outbox.enqueue({ performance_name: 'Poisoned' });
  await outbox.enqueue({ performance_name: 'Good One' });
  await outbox.enqueue({ performance_name: 'Good Two' });

  const res = await outbox.flush();
  assert.equal(res.sent, 2, 'the healthy drafts went');
  assert.equal(res.failed, 1);
  assert.equal(server.uniqueCount, 2);
});

test('a permanently failing draft is parked, never discarded', async () => {
  const store = memoryStore();
  const outbox = createOutbox({
    store, uuid: seq,
    send: async () => { throw new Error('always fails'); },
  });
  await outbox.enqueue({ performance_name: 'Doomed' });

  for (let i = 0; i < MAX_AUTO_ATTEMPTS + 3; i++) await outbox.flush();

  const stuck = await outbox.stuck();
  assert.equal(stuck.length, 1, 'it is still here — nobody deletes a family\'s record');
  assert.equal(stuck[0].attempts, MAX_AUTO_ATTEMPTS, 'automatic retries stopped at the cap');
  assert.equal((await outbox.counts()).pending, 0, 'and it no longer blocks the queue');

  await outbox.retry(stuck[0].clientSubmissionId);
  assert.equal((await outbox.counts()).pending, 1, 'a human can put it back in the queue');
});

test('drafts survive a restart, with their ids', async () => {
  const store = memoryStore();
  const offline = createOutbox({
    store, uuid: seq,
    send: async () => { throw new Error('offline'); },
  });
  const draft = await offline.enqueue({ performance_name: 'Before The Crash' });
  await offline.flush();

  // The app is killed; a new outbox opens the same store.
  const server = fakeServer();
  const afterRestart = createOutbox({ store, send: server.send, uuid: seq });
  await afterRestart.flush();

  assert.equal(server.received[0].client_submission_id, draft.clientSubmissionId,
    'the same id survived the restart — a new one would have duplicated the award');
  assert.equal(server.uniqueCount, 1);
});

test('a weekend batches under one event session', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq });

  const sessionId = 'session-abc';
  for (const routine of ['Fireworks', 'Rise', 'Storm']) {
    await outbox.enqueue({ performance_name: routine, event_session_id: sessionId, event_id: 42 });
  }
  await outbox.flush();

  const sessions = new Set(server.received.map(r => r.event_session_id));
  assert.equal(sessions.size, 1, 'one session for the whole weekend');
  assert.equal([...sessions][0], sessionId);
  assert.equal(server.uniqueCount, 3);
});

// ---- Pivot P1: add first, account at save ---------------------------------
//
// "A family adds their first memory with NO account. The draft lives on the
// phone; signing in attaches it to the household by dancer name and it sends
// itself." The dangerous outcomes are (a) a guest draft burning its retry
// budget on sends that cannot succeed, and (b) a memory attaching to the
// WRONG child because two household dancers share a name.

const guestPolicy = { sendable: (p) => p.dancer_id != null };

test('a guest draft is waiting, not failing — no retries burned before an account exists', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq, ...guestPolicy });

  const draft = await outbox.enqueue({ dancer_name: 'Emma Chen', performance_name: 'Firebird' });
  await outbox.flush();
  await outbox.flush();

  assert.equal(server.received.length, 0, 'nothing was sent for a draft with no dancer id');
  const row = await store.get(draft.clientSubmissionId);
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 0, 'skipping is free — the retry budget is intact');
  assert.equal((await outbox.counts()).waiting, 1);
  assert.equal((await outbox.counts()).pending, 0);
});

test('sign-in attaches the guest draft by folded name and it sends exactly once', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq, ...guestPolicy });

  const draft = await outbox.enqueue({ dancer_name: '  emma   CHEN ', performance_name: 'Firebird' });
  const attached = await outbox.attach([{ id: 7, name: 'Emma Chen' }]);
  await outbox.flush();

  assert.equal(attached, 1);
  assert.equal(server.uniqueCount, 1);
  assert.equal(server.received[0].dancer_id, 7, 'the typed name became the household dancer');
  assert.equal(server.received[0].client_submission_id, draft.clientSubmissionId,
    'the id minted at guest-draft creation survived the attach — still exactly-once');
});

test('an ambiguous name attaches NOTHING — a memory must never land on the wrong child', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq, ...guestPolicy });

  await outbox.enqueue({ dancer_name: 'Zixi Yu', performance_name: 'Clockwork' });
  const attached = await outbox.attach([
    { id: 1, name: 'Zixi Yu' },
    { id: 2, name: 'zixi yu' }, // two household profiles folding to one name
  ]);
  await outbox.flush();

  assert.equal(attached, 0, 'ambiguity waits for a person');
  assert.equal(server.received.length, 0);
  assert.equal((await outbox.counts()).waiting, 1, 'the draft is still safe and visible');
});

test('a name with no household match keeps waiting; a later attach picks it up', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq, ...guestPolicy });

  await outbox.enqueue({ dancer_name: 'Emma Chen', performance_name: 'Firebird' });
  assert.equal(await outbox.attach([{ id: 9, name: 'Someone Else' }]), 0);
  await outbox.flush();
  assert.equal(server.received.length, 0);

  // The family claims Emma; the household refresh attaches and the draft goes.
  assert.equal(await outbox.attach([{ id: 9, name: 'Someone Else' }, { id: 7, name: 'Emma Chen' }]), 1);
  await outbox.flush();
  assert.equal(server.uniqueCount, 1);
  assert.equal(server.received[0].dancer_id, 7);
});

test('attach never rewrites a signed-in draft or a sent one', async () => {
  const store = memoryStore();
  const server = fakeServer();
  const outbox = createOutbox({ store, send: server.send, uuid: seq, ...guestPolicy });

  // A signed-in draft (has its id already) and a sent guest draft.
  await outbox.enqueue({ dancer_id: 3, dancer_name: 'Emma Chen', performance_name: 'Rise' });
  await outbox.flush();
  assert.equal(server.uniqueCount, 1);

  const attached = await outbox.attach([{ id: 7, name: 'Emma Chen' }]);
  assert.equal(attached, 0, 'an id already chosen is never second-guessed');
  await outbox.flush();
  assert.equal(server.received.every(r => r.dancer_id === 3), true);
});
