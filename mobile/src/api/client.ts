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
): Promise<{ ok: boolean; status: string; routedTo: string }> {
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
