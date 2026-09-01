import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from './tokens';

const REFRESH_KEY = 'awardhome.refresh_token';

/**
 * Refresh tokens go to the Keychain (iOS) / Keystore (Android) — never to
 * AsyncStorage, which is a plain file any other process on a rooted device can
 * read. The access token is deliberately absent from this file: it lives in
 * memory for fifteen minutes and persisting it would widen the blast radius of
 * a device compromise for no benefit.
 *
 * SecureStore is unavailable on web. Rather than silently degrade to a
 * localStorage shim — which would put a 60-day credential somewhere any script
 * on the page can read — the web build simply has no persisted session.
 */
export const secureTokenStorage: TokenStorage = {
  async getRefreshToken() {
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      return null;
    }
  },

  async setRefreshToken(token) {
    try {
      if (token === null) await SecureStore.deleteItemAsync(REFRESH_KEY);
      else await SecureStore.setItemAsync(REFRESH_KEY, token, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      // A keychain write failing is not something a family can act on, and
      // throwing here would break sign-in entirely. They stay signed in for
      // this launch and are asked to sign in again next time.
    }
  },
};
