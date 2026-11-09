/** Server-only helpers: current language, current admin, and calls to the API. */
import 'server-only';
import type { AdminMe } from '@sanad/api-client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { API_URL } from './config';
import { makeT, parseLang } from './i18n';
import { ACCESS_COOKIE, LANG_COOKIE } from './session';

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const getT = cache(async () => makeT(parseLang((await cookies()).get(LANG_COOKIE)?.value)));

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const t = await getT();
  return fetch(`${API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Accept-Language': t.lang,
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function errorOf(res: Response): Promise<AdminApiError> {
  let body: { code?: string; message?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  const message = Array.isArray(body.message)
    ? body.message.join('; ')
    : String(body.message ?? res.statusText);
  return new AdminApiError(res.status, body.code ?? `HTTP_${res.status}`, message);
}

/** GET (or other) a JSON resource; a 401 sends the admin back to the login page. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await call(path, init);
  if (res.status === 401) redirect('/login');
  if (!res.ok) throw await errorOf(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Raw response (images, CSV). */
export async function apiRaw(path: string): Promise<Response> {
  return call(path);
}

export type Loaded<T> =
  { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

/** Load for a page: errors (403 etc.) are returned so the page can render them. */
export async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await api<T>(path) };
  } catch (e) {
    if (e instanceof AdminApiError)
      return { ok: false, status: e.status, code: e.code, message: e.message };
    throw e;
  }
}

export type ActionResult = { ok: boolean; message: string } | null;

/** Mutation for server actions: returns a translated result instead of throwing. */
export async function mutate(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  okMessage = 'admin.common.saved',
): Promise<ActionResult> {
  const t = await getT();
  const res = await call(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status === 401) redirect('/login');
  if (!res.ok) {
    const e = await errorOf(res);
    return { ok: false, message: t.t('admin.common.error', { message: e.message }) };
  }
  return { ok: true, message: t.t(okMessage) };
}

export const getMe = cache(async (): Promise<AdminMe> => api<AdminMe>('/admin/me'));

/** Multipart upload to the API (legal documents). */
export async function mutateForm(
  path: string,
  form: FormData,
  okMessage = 'admin.common.saved',
): Promise<ActionResult> {
  const t = await getT();
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    body: form,
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401) redirect('/login');
  if (!res.ok) {
    const e = await errorOf(res);
    return { ok: false, message: t.t('admin.common.error', { message: e.message }) };
  }
  return { ok: true, message: t.t(okMessage) };
}
