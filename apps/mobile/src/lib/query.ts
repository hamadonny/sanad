import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { ApiError } from '@sanad/api-client';

/** Offline-friendly reads (spec §9.2): cached queries are persisted and shown when offline. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 7 * 24 * 3600_000,
      networkMode: 'offlineFirst',
      retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
    },
    mutations: { networkMode: 'online', retry: false },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'sanad.queries',
  throttleTime: 2_000,
});

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected))),
);

export const keys = {
  me: ['me'] as const,
  options: ['options'] as const,
  circles: ['circles'] as const,
  circle: (id: string) => ['circle', id] as const,
  auction: (id: string) => ['auction', id] as const,
  draw: (id: string) => ['draw', id] as const,
  schedule: (id: string) => ['schedule', id] as const,
  payments: ['payments'] as const,
  notifications: ['notifications'] as const,
  contract: ['contract'] as const,
  kyc: ['kyc'] as const,
  replacements: ['replacements'] as const,
};

/** After any money action, refresh everything that shows money. */
export function invalidateMoney(): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (q) =>
      [
        'me',
        'circles',
        'circle',
        'payments',
        'auction',
        'options',
        'schedule',
        'replacements',
      ].includes(String(q.queryKey[0])),
  });
}
