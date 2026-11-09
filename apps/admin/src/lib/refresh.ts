/**
 * Token refresh with single-flight per refresh token. The API rotates refresh tokens and
 * revokes the whole family if an old one is reused, so parallel requests (prefetches, several
 * tabs) must share one refresh call instead of racing.
 */
import type { TokenPair } from '@sanad/api-client';
import { API_URL } from './config';

const inflight = new Map<string, { at: number; p: Promise<TokenPair | null> }>();
const KEEP_MS = 30_000;

export async function callRefresh(
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<TokenPair | null> {
  const res = await fetcher(`${API_URL}/admin/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as TokenPair;
}

export function refreshOnce(
  refreshToken: string,
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<TokenPair | null> {
  for (const [k, v] of inflight) if (now - v.at > KEEP_MS) inflight.delete(k);
  const hit = inflight.get(refreshToken);
  if (hit) return hit.p;
  const p = callRefresh(refreshToken, fetcher).catch(() => null);
  inflight.set(refreshToken, { at: now, p });
  return p;
}
