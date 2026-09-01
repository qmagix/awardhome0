import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth, getHousehold, type HouseholdDancer } from '@/api/client';

/**
 * Whether this device has a session, and who it belongs to.
 *
 * Deliberately NOT a gate on the whole app. Search and trophy-case viewing
 * work signed out (design §6.1), so this context reports state rather than
 * blocking navigation — a family should be able to find their dancer before
 * deciding whether the app is worth an account.
 */
interface SessionValue {
  ready: boolean;
  signedIn: boolean;
  email: string | null;
  dancers: HouseholdDancer[];
  /** Re-read the household from the server (after a sign-in or a claim). */
  refresh: () => Promise<void>;
  signOut: (all?: boolean) => Promise<void>;
  /** Set when the server ended the session on us, so the UI can say why. */
  endedReason: string | null;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [dancers, setDancers] = useState<HouseholdDancer[]>([]);
  const [endedReason, setEndedReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!(await auth.isSignedIn())) {
      setEmail(null);
      setDancers([]);
      setReady(true);
      return;
    }
    try {
      const me = await getHousehold();
      setEmail(me.user.email);
      setDancers(me.dancers);
      setEndedReason(null);
    } catch {
      // A failed /me on launch means the refresh token is gone or rejected.
      // tokens.ts has already cleared it; there is nothing to retry.
      setEmail(null);
      setDancers([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signOut = useCallback(async (all = false) => {
    await auth.signOut(all);
    setEmail(null);
    setDancers([]);
  }, []);

  const value = useMemo<SessionValue>(() => ({
    ready,
    signedIn: email !== null,
    email,
    dancers,
    refresh,
    signOut,
    endedReason,
  }), [ready, email, dancers, refresh, signOut, endedReason]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
