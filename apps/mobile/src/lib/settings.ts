import type { Language } from '@sanad/i18n';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStateStorage } from './storage';

export interface Settings {
  /** null until the member picks a language on first launch. */
  language: Language | null;
  arabicNumerals: boolean;
  hijri: boolean;
  biometricLock: boolean;
  seenWelcome: boolean;
  askedNotifications: boolean;
  hydrated: boolean;
  set: (patch: Partial<Omit<Settings, 'set' | 'hydrated'>>) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      language: null,
      arabicNumerals: false,
      hijri: false,
      biometricLock: true,
      seenWelcome: false,
      askedNotifications: false,
      hydrated: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'sanad.settings',
      storage: createJSONStorage(() => asyncStateStorage),
      partialize: ({ set: _set, hydrated: _h, ...rest }) => rest,
      onRehydrateStorage: () => () => useSettings.setState({ hydrated: true }),
    },
  ),
);
