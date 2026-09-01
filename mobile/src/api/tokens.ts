// Token lifecycle for the AwardHome mobile client.
//
// This module is deliberately free of React Native imports: `fetch` and the
// storage adapter are injected, so the riskiest logic in the whole app can be
// exercised in plain Node (see mobile/test/tokens.test.mjs) rather than only in
// a simulator nobody runs in CI.
//
// WHAT MAKES IT RISKY. The server rotates refresh tokens on every use and
// treats a replayed one as theft — it revokes the entire session (see
// utils/mobileAuth.js). That is the right server behaviour, and it means a
// naive client can sign its own user out:
//
//   five screens mount at once
//     -> five requests 401 on an expired access token
//       -> five parallel refreshes with the SAME refresh token
//         -> the first rotates it, the other four look like theft
//           -> session revoked, family signed out for no reason
//
// So refresh is SINGLE-FLIGHT: concurrent callers await one in-flight refresh
// instead of each starting their own. That property is the reason this file
// exists as its own module, and it is the first thing the tests check.
//
// WHERE TOKENS LIVE (plan M6):
//   refresh — expo-secure-store (Keychain / Keystore), because it is the
//             long-lived credential and must survive a restart
//   access  — memory only, never written anywhere. It lives 15 minutes;
//             persisting it would widen the blast radius of a device
//             compromise for no benefit.

export interface TokenStorage {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type SignOutReason = 'user' | 'expired' | 'token_reuse' | 'revoked';

export interface AuthOptions {
  baseUrl: string;
  storage: TokenStorage;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Called when the session ends for any reason the user did not ask for. */
  onSignedOut?: (reason: SignOutReason) => void;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Refresh this many ms BEFORE the access token actually expires, so a request
 *  in flight when the clock ticks over does not 401 for the sake of a second. */
const EXPIRY_SKEW_MS = 30_000;

export function createAuth(opts: AuthOptions) {
  const doFetch: typeof fetch = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? (() => Date.now());
  const api = (p: string) => `${opts.baseUrl.replace(/\/$/, '')}/api/v1/mobile${p}`;

  // Access token: memory only, deliberately never persisted.
  let accessToken: string | null = null;
  let accessExpiresAt = 0;
  // The single-flight latch. Non-null means a refresh is already running and
  // every other caller must await THIS promise rather than starting another.
  let inFlight: Promise<string | null> | null = null;

  async function readBody(res: Response): Promise<Record<string, unknown>> {
    try { return (await res.json()) as Record<string, unknown>; } catch { return {}; }
  }

  function fail(status: number, body: Record<string, unknown>): ApiError {
    return new ApiError(
      status,
      typeof body.error === 'string' ? body.error : 'server_error',
      typeof body.message === 'string' ? body.message : 'Something went wrong.',
    );
  }

  async function endSession(reason: SignOutReason): Promise<void> {
    accessToken = null;
    accessExpiresAt = 0;
    await opts.storage.setRefreshToken(null);
    opts.onSignedOut?.(reason);
  }

  function store(tokens: AuthTokens): Promise<void> {
    accessToken = tokens.accessToken;
    accessExpiresAt = now() + tokens.expiresIn * 1000;
    return opts.storage.setRefreshToken(tokens.refreshToken);
  }

  async function doRefresh(): Promise<string | null> {
    const refreshToken = await opts.storage.getRefreshToken();
    if (!refreshToken) return null;

    const res = await doFetch(api('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      const body = await readBody(res);
      // token_reuse means the server already killed the session. Anything else
      // 401 means the refresh token expired or was revoked. Either way the
      // only honest move is to ask the family to sign in again.
      await endSession(body.error === 'token_reuse' ? 'token_reuse' : 'expired');
      return null;
    }
    const tokens = (await res.json()) as AuthTokens;
    await store(tokens);
    return tokens.accessToken;
  }

  /** Single-flight refresh. Concurrent callers share one request — see the
   *  header comment for why doing otherwise signs the user out. */
  function refresh(): Promise<string | null> {
    if (!inFlight) {
      inFlight = doRefresh().finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  async function getAccessToken(): Promise<string | null> {
    if (accessToken && now() < accessExpiresAt - EXPIRY_SKEW_MS) return accessToken;
    return refresh();
  }

  /**
   * Authenticated request. Retries ONCE on a 401, and only after a refresh
   * that itself is single-flighted — a retry loop here would be a way to
   * hammer the auth endpoint on a genuinely dead session.
   */
  async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = async (token: string | null): Promise<Response> => doFetch(api(path), {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    let res = await send(await getAccessToken());
    if (res.status === 401) {
      // The access token may have been revoked rather than merely expired, so
      // force a refresh rather than trusting the cached expiry.
      accessExpiresAt = 0;
      const fresh = await refresh();
      if (!fresh) return res;
      res = await send(fresh);
    }
    return res;
  }

  /** Authenticated request that returns parsed JSON or throws ApiError. */
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await authedFetch(path, init);
    if (!res.ok) throw fail(res.status, await readBody(res));
    return (await res.json()) as T;
  }

  /** Unauthenticated request — guest search and trophy-case reads use this,
   *  because those endpoints are public and asking for a token first would
   *  make an account feel required when it is not. */
  async function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(api(path), init);
    if (!res.ok) throw fail(res.status, await readBody(res));
    return (await res.json()) as T;
  }

  return {
    /** True when a refresh token exists — not proof it still works. */
    async isSignedIn(): Promise<boolean> {
      return (await opts.storage.getRefreshToken()) !== null;
    },

    /** `devCode` is returned ONLY by a non-production server with no mail
     *  provider configured, so a simulator can sign in without email. */
    async requestCode(email: string): Promise<{ ok: boolean; devCode?: string }> {
      return publicRequest('/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    },

    async verifyCode(email: string, code: string, device?: { label?: string; platform?: string }): Promise<void> {
      const tokens = await publicRequest<AuthTokens>('/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, device_label: device?.label, platform: device?.platform }),
      });
      await store(tokens);
    },

    async signOut(all = false): Promise<void> {
      // Best effort: a device with no network still gets locally signed out.
      // Leaving the token on disk because the server was unreachable would be
      // the worse failure.
      try {
        await authedFetch('/auth/revoke', { method: 'POST', body: JSON.stringify({ all }) });
      } catch { /* ignore */ }
      await endSession('user');
    },

    getAccessToken,
    refresh,
    authedFetch,
    request,
    publicRequest,

    /** Test seam: assert the access token is never written to storage. */
    _peekAccessToken(): string | null { return accessToken; },
  };
}

export type Auth = ReturnType<typeof createAuth>;
