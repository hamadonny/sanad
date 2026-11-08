/**
 * Storage: secrets (tokens) in the OS keychain/keystore via expo-secure-store; everything else
 * (settings, offline query cache) in AsyncStorage. No personal data is written to AsyncStorage
 * beyond what the app already shows on screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

/** Web is a developer preview only (no keychain); phones always use the secure store. */
const web = Platform.OS === 'web';

export const secure = {
  get: (key: string) => (web ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string) =>
    web
      ? AsyncStorage.setItem(key, value)
      : SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
  remove: (key: string) => (web ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key)),
};

export const asyncStateStorage: StateStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};
