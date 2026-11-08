import { SanadApi } from '@sanad/api-client';
import Constants from 'expo-constants';
import { tokenStore, useAuth } from './auth';
import { useSettings } from './settings';

/**
 * API base URL: EXPO_PUBLIC_API_URL if set; otherwise, in development, the computer running the
 * Expo dev server on port 3000 (so a phone on the same Wi-Fi just works).
 */
export function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (explicit && !(host && /localhost|127\.0\.0\.1/.test(explicit)))
    return explicit.replace(/\/$/, '');
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export const api = new SanadApi({
  baseUrl: resolveApiUrl(),
  tokens: tokenStore,
  onSignedOut: () => void useAuth.getState().setTokens(null),
  headers: () => ({ 'Accept-Language': useSettings.getState().language ?? 'ar' }),
});

/** Mock gateway URLs (Phases 2–6). Real checkout pages arrive with the Phase 7 gateway. */
export const isMockCheckout = (url: string) => url.startsWith('sanad-mock://');
