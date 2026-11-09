'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL } from '../lib/config';
import { parseLang } from '../lib/i18n';
import { ACCESS_COOKIE, LANG_COOKIE, REFRESH_COOKIE } from '../lib/session';

export async function switchLanguage(): Promise<void> {
  const jar = await cookies();
  const next = parseLang(jar.get(LANG_COOKIE)?.value) === 'ar' ? 'en' : 'ar';
  jar.set(LANG_COOKIE, next, { path: '/', sameSite: 'lax', maxAge: 365 * 24 * 3600 });
  const ref = (await headers()).get('referer');
  let path = '/';
  try {
    if (ref) path = new URL(ref).pathname + new URL(ref).search;
  } catch {
    /* default */
  }
  redirect(path);
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  if (refresh) {
    // Revoke the token family on the API (best effort).
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => undefined);
  }
  redirect('/login');
}
