import { ApiError } from '@sanad/api-client';
import type { TFunction } from 'i18next';

/** A friendly, translated message for any error thrown by the API client. */
export function errorMessage(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (e.code.startsWith('HTTP_5')) return t('common.error');
    return e.message || t('common.error');
  }
  if (e instanceof TypeError) return t('errors.NETWORK');
  return t('common.error');
}
