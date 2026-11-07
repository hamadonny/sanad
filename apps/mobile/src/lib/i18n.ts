import { defaultLanguage, isRtl, resources, type Language } from '@sanad/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * Arabic is the default regardless of device language (spec §0.7).
 * Phase 3 adds the language picker, persistence, and I18nManager.forceRTL + reload.
 */
export function initI18n(language: Language = defaultLanguage) {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: defaultLanguage,
      interpolation: { escapeValue: false },
    });
  }
  return i18next;
}

export function layoutDirection(language: Language): 'rtl' | 'ltr' {
  return isRtl(language) ? 'rtl' : 'ltr';
}
