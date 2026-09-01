// The typed API surface. Response shapes come from src/api/schema.ts, which is
// GENERATED from the same OpenAPI document the server serves at
// /api/v1/mobile/openapi.json (`npm run api:types`). Nothing here restates a
// shape by hand, so the contract cannot drift between the two sides without a
// type error showing up on this one.
import Constants from 'expo-constants';
import { createAuth, type Auth } from './tokens';
import { secureTokenStorage } from './storage';
import type { components } from './schema';

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

function resolveBaseUrl(): string {
  const configured = Constants.expoConfig?.extra?.['apiBaseUrl'];
  return typeof configured === 'string' && configured.length > 0
    ? configured
    : 'https://awardhome.com';
}

export const auth: Auth = createAuth({
  baseUrl: resolveBaseUrl(),
  storage: secureTokenStorage,
});

// ---- Guest reads -----------------------------------------------------------
// These take no token on purpose. A parent should be able to find their
// dancer and look at the trophy case before deciding whether this app is worth
// an account.

export function searchDancers(q: string): Promise<{ dancers: DancerSummary[] }> {
  return auth.publicRequest(`/dancers/search?q=${encodeURIComponent(q)}`);
}

export function getTrophyCase(dancerId: string, cursor?: number): Promise<{
  dancer: { id: number; unique_id: string; name: string; is_claimed: boolean };
  awards: Award[];
  nextCursor: number | null;
}> {
  const qs = cursor ? `?cursor=${cursor}` : '';
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
  ok: boolean; status: string; routedTo: string;
  /** Set when the dancer's studio has no owner — nobody there will review
   *  this, and the family is the person positioned to change that. */
  unclaimedStudio: { id: number; unique_id: string; name: string } | null;
}> {
  return auth.request(`/dancers/${encodeURIComponent(String(dancerId))}/claim`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
