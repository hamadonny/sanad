import { defaultLanguage, isRtl, resources, type Language } from '@sanad/i18n';

/** Document attributes for a language. Arabic (default) is right-to-left. */
export function documentAttributes(language: Language = defaultLanguage): {
  lang: Language;
  dir: 'rtl' | 'ltr';
} {
  return { lang: language, dir: isRtl(language) ? 'rtl' : 'ltr' };
}

export function translations(language: Language = defaultLanguage) {
  return resources[language].translation;
}
