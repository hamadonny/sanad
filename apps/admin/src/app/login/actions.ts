'use server';
import type { AdminLoginResponse } from '@sanad/api-client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, IS_DEV } from '../../lib/config';
import { getT } from '../../lib/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions } from '../../lib/session';

export type LoginState = { error: string } | null;

export async function login(_prev: LoginState, data: FormData): Promise<LoginState> {
  const { t } = await getT();
  const email = String(data.get('email') ?? '').trim();
  const password = String(data.get('password') ?? '');
  const totp = String(data.get('totp') ?? '').replace(/\s/g, '');
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, totp }),
      cache: 'no-store',
    });
  } catch {
    return { error: t('errors.NETWORK') };
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 400) return { error: t('admin.login.invalid') };
    let code = `HTTP_${res.status}`;
    try {
      code = ((await res.json()) as { code?: string }).code ?? code;
    } catch {
      /* ignore */
    }
    const translated = t(`errors.${code}`);
    return {
      error:
        translated !== `errors.${code}` ? translated : t('admin.common.error', { message: code }),
    };
  }
  const pair = (await res.json()) as AdminLoginResponse;
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, pair.accessToken, cookieOptions(pair.expiresIn));
  jar.set(REFRESH_COOKIE, pair.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  redirect('/');
}

/** Dev only: ask the API (DEV_ENDPOINTS) for the current 2FA code of a demo admin. */
export async function devTotp(email: string): Promise<string | null> {
  if (!IS_DEV) return null;
  try {
    const r = await fetch(`${API_URL}/dev/admin-totp?email=${encodeURIComponent(email)}`, {
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return ((await r.json()) as { code: string | null }).code;
  } catch {
    return null;
  }
}
