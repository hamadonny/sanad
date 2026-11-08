import { defaultLanguage, isRtl, resources, type Language } from '@sanad/i18n';
import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { DevSettings, I18nManager, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Updates from 'expo-updates';
import { useSettings } from './settings';

/** Arabic is the default regardless of device language (spec §0.7, D-004). */
export function initI18n(language: Language = defaultLanguage) {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: defaultLanguage,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  }
  // `left`/`right` always mean physical sides; logical layout uses start/end + `direction`.
  (I18nManager as { swapLeftAndRightInRTL?: (v: boolean) => void }).swapLeftAndRightInRTL?.(false);
  applyNativeDirection(language);
  return i18next;
}

export function layoutDirection(language: Language): 'rtl' | 'ltr' {
  return isRtl(language) ? 'rtl' : 'ltr';
}

/**
 * Native RTL (navigation, gestures) needs I18nManager + a reload. The root view also sets
 * `direction`, so layout is correct immediately even where the native flag cannot change
 * (e.g. Expo Go). Returns true if a reload is needed.
 */
function applyNativeDirection(language: Language): boolean {
  const rtl = isRtl(language);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}

export async function changeLanguage(language: Language): Promise<void> {
  useSettings.getState().set({ language });
  await i18next.changeLanguage(language);
  // Expo Go resets the native RTL flag on every launch, so a reload would not help there.
  // On web the root `direction` style is enough.
  const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (applyNativeDirection(language) && !expoGo && Platform.OS !== 'web') {
    // Let the persisted settings reach storage before the JS reload.
    await new Promise((r) => setTimeout(r, 300));
    try {
      await Updates.reloadAsync();
    } catch {
      if (__DEV__) DevSettings.reload();
    }
  }
}

/** Current language + direction helpers for components. */
export function useDir() {
  const { i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'ar') as Language;
  const rtl = isRtl(language);
  return {
    language,
    rtl,
    dir: rtl ? ('rtl' as const) : ('ltr' as const),
    textAlign: rtl ? ('right' as const) : ('left' as const),
  };
}
