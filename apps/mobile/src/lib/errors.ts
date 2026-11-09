import { ApiError } from '@sanad/api-client';
import type { TFunction } from 'i18next';
import { reportError } from './telemetry';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/** fetch() rejects with a TypeError whose message names the network failure. */
function isNetworkFailure(e: unknown): boolean {
  return (
    e instanceof TypeError &&
    /network request failed|failed to fetch|load failed|networkerror/i.test(e.message)
  );
}

/** Short technical detail, shown only in development builds so a tester can report it. */
function devDetail(e: unknown): string {
  if (!isDev) return '';
  if (e instanceof ApiError) return ` (${e.code})`;
  if (e instanceof Error) return ` (${e.name}: ${e.message.slice(0, 120)})`;
  return ` (${String(e).slice(0, 120)})`;
}

/** A friendly, translated message for any error thrown while talking to the API. */
export function errorMessage(t: TFunction, e: unknown): string {
  if (isDev) console.warn('[sanad] request failed:', e);
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (e.status >= 500 || e.code.startsWith('HTTP_5')) return t('common.error') + devDetail(e);
    return (e.message || t('common.error')) + devDetail(e);
  }
  if (isNetworkFailure(e)) return t('errors.NETWORK');
  reportError(e, 'request'); // unexpected client-side failure
  return t('common.error') + devDetail(e);
}
