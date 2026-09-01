// The typed API surface. Response shapes come from src/api/schema.ts, which is
// GENERATED from the same OpenAPI document the server serves at
// /api/v1/mobile/openapi.json (`npm run api:types`). Nothing here restates a
// shape by hand, so the contract cannot drift between the two sides without a
// type error showing up on this one.
import Constants from 'expo-constants';
import { createAuth, type Auth } from './tokens';
import { secureTokenStorage } from './storage';
import type { components } from './schema';

// The port `npm run dev` serves on. Only consulted in development.
const DEV_API_PORT = 3008;

export type Award = components['schemas']['Award'];
export type Submission = components['schemas']['Submission'];
export type EventOption = components['schemas']['EventOption'];

export interface DancerSummary {
  id: number;
  unique_id: string;
  name: string;
  is_claimed: number;
  award_count: number;
  studios: string | null;
}

export interface HouseholdDancer {
  id: number;
  unique_id: string;
  name: string;
  award_count: number;
  /** 'owner' — the claim was approved. 'pending_claim' — she has asked and
   *  nobody has decided yet; she may still record awards, but they wait. */
  standing: 'owner' | 'pending_claim';
  /** Independent dancers only: may this family publish without a reviewer?
   *  'none' — curating privately. 'requested' — asked AwardHome.
   *  'approved' — publishes on submit, labelled family_submitted. */
  independent_publish_status: 'none' | 'requested' | 'approved';
  studios: { id: number; name: string; unique_id: string; is_independent: number }[];
}

export interface ActivityItem {
  type: 'submission' | 'correction' | 'claim';
  id: number;
  at: string;
  title: string | null;
  status: string;
  note?: string | null;
}

/**
 * Where the API lives.
 *
 * An explicit EXPO_PUBLIC_API_BASE_URL always wins — that is what the eas.json
 * build profiles set, and it is the only thing a release build should ever
 * use. app.config.js folds it into extra.apiBaseUrl.
 *
 * In DEV with nothing explicit, derive the host from the Metro server the app
 * is already talking to. A hardcoded LAN address in .env.local is only correct
 * until DHCP hands this machine a different lease, and when it moves the app
 * fails with "We couldn't reach AwardHome" — which looks like a bug in the app
 * rather than a stale line in a config file. Metro's host is by construction
 * the machine serving this bundle, so it cannot go stale.
 */
function resolveBaseUrl(): string {
  const configured = Constants.expoConfig?.extra?.['apiBaseUrl'];
  const explicit = typeof configured === 'string' && configured.length > 0
    && configured !== 'https://awardhome.com';
  if (explicit) return configured as string;

  if (__DEV__) {
    // "<lan-ip>:8081" -> "http://<lan-ip>:3008"
    const hostUri = Constants.expoConfig?.hostUri
      ?? (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
    const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : null;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:${DEV_API_PORT}`;
    }
  }

  return typeof configured === 'string' && configured.length > 0
    ? configured
    : 'https://awardhome.com';
}

/**
 * The one resolved base URL, exported so nothing else re-derives it.
 *
 * Four screens used to call Constants.expoConfig.extra.apiBaseUrl themselves
 * for share links and the award-card web view. When .env.local stopped pinning
 * an address, those copies silently fell back to the PRODUCTION default while
 * the API client correctly derived the local host — so the app talked to
 * localhost but opened cards on awardhome.com, which answered with the private
 * beta gate. One resolver, one answer.
 */
export const baseUrl = resolveBaseUrl();

export const auth: Auth = createAuth({
  baseUrl,
  storage: secureTokenStorage,
});

// ---- Guest reads -----------------------------------------------------------
// These take no token on purpose. A parent should be able to find their
// dancer and look at the trophy case before deciding whether this app is worth
// an account.

export function searchDancers(q: string): Promise<{ dancers: DancerSummary[] }> {
  return auth.publicRequest(`/dancers/search?q=${encodeURIComponent(q)}`);
}

export interface MyClaim { id: number; status: string; studio_id: number | null }

export function getTrophyCase(dancerId: string, cursor?: string): Promise<{
  dancer: { id: number; unique_id: string; name: string; is_claimed: boolean };
  /** Where the signed-in caller's own claim stands, if they have one. */
  myClaim: MyClaim | null;
  /** Set when the caller has a pending claim and the dancer's studio has no
   *  owner — nobody is going to review it until someone there claims. */
  unclaimedStudio: { id: number; unique_id: string; name: string } | null;
  awards: Award[];
  /** Opaque "<year>:<id>" keyset cursor — the trophy case is ordered by
   *  recency, not by import order, so a single id no longer locates a page. */
  nextCursor: string | null;
}> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return auth.publicRequest(`/dancers/${encodeURIComponent(dancerId)}/awards${qs}`);
}

// ---- Authenticated ---------------------------------------------------------

export function getHousehold(): Promise<{
  user: { id: number; email: string };
  dancers: HouseholdDancer[];
}> {
  return auth.request('/me');
}

export function claimDancer(
  dancerId: number | string,
  body: { relationship?: string; proof?: string; studio_code?: string },
): Promise<{
  ok: boolean; status: string;
  /** studio | waiting_for_studio | awardhome — who is competent to decide. */
  routedTo: string;
  studio: { id: number; name: string } | null;
  /** Set when the dancer's studio has no owner — nobody there will review
   *  this, and the family is the person positioned to change that. */
  unclaimedStudio: { id: number; unique_id: string; name: string } | null;
}> {
  return auth.request(`/dancers/${encodeURIComponent(String(dancerId))}/claim`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Ask AwardHome to publish an independent dancer's record. Owner only, and
 *  only for a dancer with no studio director to ask instead. */
export function requestIndependentPublish(dancerId: number): Promise<{ ok: boolean; status: string }> {
  return auth.request(`/dancers/${dancerId}/publish-request`, { method: 'POST' });
}

export function getActivity(): Promise<{ activity: ActivityItem[] }> {
  return auth.request('/activity');
}

export function listSubmissions(): Promise<{ submissions: Submission[]; nextCursor: number | null }> {
  return auth.request('/submissions');
}

// ---- M7: sessions, evidence, sharing --------------------------------------

export interface EventSession {
  id: string;
  event_id: number | null;
  event_candidate_id: number | null;
  created_at: string;
}

/** Get-or-create the session for a weekend. Needs network — which is why the
 *  Add flow asks for the event once, up front, and then works offline. */
export function openEventSession(
  ref: { event_id?: number; event_candidate_id?: number },
): Promise<{ session: EventSession; created: boolean }> {
  return auth.request('/event-sessions', { method: 'POST', body: JSON.stringify(ref) });
}

export function findEvents(params: {
  lat?: number; lng?: number; date?: string; q?: string;
}): Promise<{ options: EventOption[] }> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return auth.publicRequest(`/events/nearby?${qs}`);
}

/** Two steps by design: the grant is what lets the storage driver move to
 *  S3/R2 later without the client changing. */
export async function uploadEvidence(
  submissionId: number,
  file: { uri: string; mimeType?: string },
): Promise<{ evidenceId: number; objectKey: string }> {
  const grant = await auth.request<{ grant: string; uploadUrl: string }>(
    `/submissions/${submissionId}/evidence`, { method: 'POST' },
  );
  const bytes = await (await fetch(file.uri)).blob();
  const res = await auth.authedFetch('/uploads', {
    method: 'POST',
    headers: {
      'Content-Type': file.mimeType ?? 'application/octet-stream',
      'X-Upload-Grant': grant.grant,
    },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new Error('Upload failed');
  return (await res.json()) as { evidenceId: number; objectKey: string };
}

// ---- Studios: search, view, claim ------------------------------------------

export interface StudioSummary {
  id: number;
  unique_id: string;
  name: string;
  is_claimed: number;
  award_count: number;
}

export function searchStudios(q: string): Promise<{ studios: StudioSummary[] }> {
  return auth.publicRequest(`/studios/search?q=${encodeURIComponent(q)}`);
}

export function getStudio(id: string): Promise<{
  studio: StudioSummary & { bio: string | null; website_url: string | null };
  stats: { awards: number; events: number; dancers: number };
}> {
  return auth.publicRequest(`/studios/${encodeURIComponent(id)}`);
}

export function claimStudio(id: string, body: {
  contact_name: string; role?: string; phone?: string;
  studio_address: string; proof?: string;
}): Promise<{ ok: boolean; status: string; reason?: string }> {
  return auth.request(`/studios/${encodeURIComponent(id)}/claim`, {
    method: 'POST', body: JSON.stringify(body),
  });
}
