import { Share } from 'react-native';

/**
 * Copy text, and fall back to the share sheet if we can't.
 *
 * expo-clipboard is loaded LAZILY for the same reason expo-network is (see
 * src/outbox/index.ts): a dev or TestFlight build made before this dependency
 * existed throws "Cannot find native module 'ExpoClipboard'", and a top-level
 * import turns that into a blank screen for the whole route rather than one
 * button that doesn't work. The share sheet is native to RN and always there,
 * so the user still gets the link out either way.
 *
 * Returns true if it went to the clipboard, false if it went to the sheet —
 * the caller needs to know, because "Link copied" would be a lie otherwise.
 */
export async function copyOrShare(text: string, shareMessage?: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    try {
      await Share.share({ message: shareMessage ?? text, url: text });
    } catch { /* the user dismissed the sheet; nothing to report */ }
    return false;
  }
}
