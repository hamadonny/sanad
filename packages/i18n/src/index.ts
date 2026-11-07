/**
 * @sanad/i18n — shared translation resources. Arabic is the default and the source of truth
 * for keys; English must match its shape (enforced by the type system).
 */
import { ar } from './locales/ar.js';
import { en } from './locales/en.js';
import type { TranslationShape } from './types.js';

export type { TranslationShape } from './types.js';

export const supportedLanguages = ['ar', 'en'] as const;
export type Language = (typeof supportedLanguages)[number];

export const defaultLanguage: Language = 'ar';

const rtlLanguages: ReadonlySet<Language> = new Set(['ar']);

export function isRtl(language: Language): boolean {
  return rtlLanguages.has(language);
}

export function isSupportedLanguage(value: string): value is Language {
  return (supportedLanguages as readonly string[]).includes(value);
}

/** i18next-compatible resources: `{ ar: { translation }, en: { translation } }`. */
export const resources: Record<Language, { translation: TranslationShape }> = {
  ar: { translation: ar },
  en: { translation: en },
};
