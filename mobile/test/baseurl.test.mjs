import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The base URL must be resolved in exactly ONE place.
 *
 * This is a regression test for a real, silent failure: four screens read
 * Constants.expoConfig.extra.apiBaseUrl themselves for share links and the
 * award-card web view. When .env.local stopped pinning a LAN address, those
 * copies fell back to the PRODUCTION default while the API client correctly
 * derived the local host — so the app talked to localhost while opening cards
 * on awardhome.com, which answered with the private beta gate.
 *
 * Nothing crashed and no type was wrong. The only symptom was a beta password
 * prompt inside a native sheet, which looks like a server misconfiguration
 * rather than a client bug. A grep is the cheapest guard that would have
 * caught it.
 */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

test('apiBaseUrl is read in exactly one place', () => {
  const files = [...walk('app'), ...walk('src')];
  const readers = files.filter(f => readFileSync(f, 'utf8').includes("extra?.['apiBaseUrl']"));
  assert.deepEqual(
    readers, ['src/api/client.ts'],
    'Import { baseUrl } from "@/api/client" instead of re-reading expoConfig.extra.apiBaseUrl. '
    + 'A second reader silently resolves to production in dev. Found: ' + readers.join(', '));
});

test('nothing hardcodes the production host outside the resolver', () => {
  const files = [...walk('app'), ...walk('src')];
  // The quoted LITERAL, not a mention: prose referring to awardhome.com in a
  // comment is fine, a `'https://awardhome.com'` fallback in code is not.
  const offenders = files.filter(f =>
    f !== 'src/api/client.ts'
    && /['"`]https:\/\/awardhome\.com/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, [],
    'A hardcoded https://awardhome.com fallback defeats the dev host derivation. Found: '
    + offenders.join(', '));
});
