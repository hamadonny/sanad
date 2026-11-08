import type { TokenPair, TokenStore } from '@sanad/api-client';
import { create } from 'zustand';
import { secure } from './storage';

const KEY = 'sanad.tokens';

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  tokens: TokenPair | null;
  load: () => Promise<void>;
  setTokens: (t: TokenPair | null) => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  tokens: null,
  load: async () => {
    const raw = await secure.get(KEY).catch(() => null);
    const tokens = raw ? (JSON.parse(raw) as TokenPair) : null;
    set({ tokens, status: tokens ? 'signedIn' : 'signedOut' });
  },
  setTokens: async (tokens) => {
    if (tokens) await secure.set(KEY, JSON.stringify(tokens));
    else await secure.remove(KEY).catch(() => undefined);
    set({ tokens, status: tokens ? 'signedIn' : 'signedOut' });
  },
}));

/** Token store handed to the API client (keychain-backed). */
export const tokenStore: TokenStore = {
  get: () => useAuth.getState().tokens,
  set: (t) => useAuth.getState().setTokens(t),
};
