// Token-lifecycle tests, run in plain Node (`npm test` inside mobile/).
//
// These exist because the highest-consequence bug this client can have is not
// a layout problem — it is signing a family out for no reason. The server
// rotates refresh tokens and treats a replayed one as theft by revoking the
// session, so a client that refreshes twice in parallel destroys its own
// session. A simulator would not catch that reliably; this does, every run.
//
// src/api/tokens.ts takes `fetch` and storage as parameters precisely so it can
// be tested here, with no React Native and no device.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Node 22 strips types natively, so the source runs here with no build step —
// which matches how the rest of this repo works.
const { createAuth, ApiError } = await import('../src/api/tokens.ts');

function memoryStorage(initial = null) {
  let token = initial;
  const writes = [];
  return {
    writes,
    async getRefreshToken() { return token; },
    async setRefreshToken(t) { token = t; writes.push(t); },
    peek() { return token; },
  };
}

/** A fake server that mirrors the real one's contract, including rotation. */
function fakeServer({ rotateFails = false } = {}) {
  const calls = [];
  let refreshCount = 0;
  let currentRefresh = 'refresh-1';
  let currentAccess = 'access-1';
  let accessValid = true;

  const impl = async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api\/v1\/mobile/, '');
    calls.push({ path, method: init.method ?? 'GET', headers: init.headers ?? {} });

    if (path === '/auth/refresh') {
      refreshCount++;
      const sent = JSON.parse(init.body).refresh_token;
      if (rotateFails || sent !== currentRefresh) {
        // Exactly the server's behaviour: a replayed refresh token kills the
        // session.
        return new Response(JSON.stringify({ error: 'token_reuse', message: 'Sign in again.' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      currentRefresh = `refresh-${refreshCount + 1}`;
      currentAccess = `access-${refreshCount + 1}`;
      accessValid = true;
      return new Response(JSON.stringify({
        accessToken: currentAccess, refreshToken: currentRefresh, expiresIn: 900,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (path === '/auth/verify') {
      return new Response(JSON.stringify({
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Mirrors the real server: reads that match a public web page need no
    // token (routes/api/mobile.js), so guest browsing works without an account.
    const isPublic = path.startsWith('/dancers/search')
      || /^\/dancers\/[^/]+\/awards/.test(path)
      || path.startsWith('/events/nearby')
      || path.startsWith('/openapi.json');
    if (isPublic) {
      return new Response(JSON.stringify({ ok: true, path }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const bearer = (init.headers ?? {}).Authorization;
    if (!bearer || bearer !== `Bearer ${currentAccess}` || !accessValid) {
      return new Response(JSON.stringify({ error: 'unauthorized', message: 'Sign in.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, path }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  return {
    impl, calls,
    get refreshCount() { return refreshCount; },
    expireAccess() { accessValid = false; },
  };
}

const base = { baseUrl: 'https://example.test' };

test('concurrent requests trigger exactly ONE refresh', async () => {
  const server = fakeServer();
  const storage = memoryStorage('refresh-1');
  const auth = createAuth({ ...base, storage, fetchImpl: server.impl });

  // Five screens mounting at once on a cold start: no access token in memory,
  // so every one of them needs a refresh. Only one may actually happen.
  const results = await Promise.all([
    auth.request('/me'), auth.request('/me'), auth.request('/me'),
    auth.request('/activity'), auth.request('/submissions'),
  ]);

  assert.equal(server.refreshCount, 1, 'refresh must be single-flight');
  assert.equal(results.length, 5);
  assert.ok(results.every(r => r.ok === true));
});

test('a 401 mid-session refreshes once and retries the request', async () => {
  const server = fakeServer();
  const storage = memoryStorage('refresh-1');
  const auth = createAuth({ ...base, storage, fetchImpl: server.impl });

  await auth.request('/me');
  const before = server.refreshCount;
  server.expireAccess(); // the server revoked or expired the access token

  const res = await auth.request('/me');
  assert.equal(res.ok, true, 'the retry after refresh must succeed');
  assert.equal(server.refreshCount, before + 1, 'exactly one extra refresh');
});

test('the access token is never written to storage', async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  const auth = createAuth({ ...base, storage, fetchImpl: server.impl });

  await auth.verifyCode('parent@example.test', '123456');
  assert.equal(auth._peekAccessToken(), 'access-1', 'access token is held in memory');
  assert.ok(!storage.writes.includes('access-1'), 'access token must never reach storage');
  assert.equal(storage.peek(), 'refresh-1', 'refresh token is the only thing persisted');
});

test('rotation is followed: the NEW refresh token replaces the old one', async () => {
  const server = fakeServer();
  const storage = memoryStorage('refresh-1');
  const auth = createAuth({ ...base, storage, fetchImpl: server.impl });

  await auth.refresh();
  assert.equal(storage.peek(), 'refresh-2',
    'storing the old token would replay it next time and revoke the session');
});

test('a dead session clears storage and reports why', async () => {
  const server = fakeServer({ rotateFails: true });
  const storage = memoryStorage('stolen-token');
  const reasons = [];
  const auth = createAuth({
    ...base, storage, fetchImpl: server.impl,
    onSignedOut: (r) => reasons.push(r),
  });

  const token = await auth.getAccessToken();
  assert.equal(token, null);
  assert.equal(storage.peek(), null, 'a token the server rejected must not be kept');
  assert.deepEqual(reasons, ['token_reuse'], 'the app is told the session was ended for security');
});

test('signed-out clients still read public endpoints', async () => {
  const server = fakeServer();
  const storage = memoryStorage(); // no refresh token: a guest
  const auth = createAuth({ ...base, storage, fetchImpl: server.impl });

  assert.equal(await auth.isSignedIn(), false);
  const res = await auth.publicRequest('/dancers/search?q=emma');
  assert.equal(res.ok, true, 'guest browsing must not require a token');
  assert.equal(server.refreshCount, 0, 'and must not attempt a refresh');
});

test('an authenticated call with no session returns the 401 rather than looping', async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  const auth = createAuth({ ...base, storage, fetchImpl: server.impl });

  await assert.rejects(() => auth.request('/me'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 401);
    return true;
  });
  assert.ok(server.calls.filter(c => c.path === '/me').length <= 2,
    'at most one retry — a loop here would hammer the auth endpoint');
});
