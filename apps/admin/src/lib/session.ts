/**
 * Admin session = two httpOnly cookies holding the API's admin token pair. Tokens never reach
 * browser JavaScript; the Next server calls the API on the admin's behalf (spec §12:
 * server-side auth). The API verifies every token; we only decode to read expiry and roles.
 */
import type { AdminRole } from '@sanad/api-client';

export const ACCESS_COOKIE = 'sanad_admin_at';
export const REFRESH_COOKIE = 'sanad_admin_rt';
export const LANG_COOKIE = 'sanad_admin_lang';

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Refresh tokens live 30 days on the API; the cookie never outlives them. */
export const REFRESH_MAX_AGE = 30 * 24 * 3600;

export interface TokenClaims {
  sub: string;
  exp: number;
  roles: AdminRole[];
}

/** Decode (not verify) a JWT payload. Returns null for anything malformed. */
export function decodeToken(token: string | undefined | null): TokenClaims | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(
      Buffer.from(part, 'base64url').toString('utf8'),
    ) as Partial<TokenClaims>;
    if (typeof json.sub !== 'string' || typeof json.exp !== 'number') return null;
    return { sub: json.sub, exp: json.exp, roles: Array.isArray(json.roles) ? json.roles : [] };
  } catch {
    return null;
  }
}

/** Refresh when the access token is missing or expires within `skewSeconds`. */
export function needsRefresh(
  token: string | undefined | null,
  nowMs: number = Date.now(),
  skewSeconds = 30,
): boolean {
  const c = decodeToken(token);
  return !c || c.exp * 1000 - nowMs < skewSeconds * 1000;
}
