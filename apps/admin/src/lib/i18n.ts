import { defaultLanguage, isRtl, resources, type Language } from '@sanad/i18n';

type Dict = Record<string, unknown>;

/** Look up `a.b.c` in the translation tree and fill `{{vars}}`. Missing keys return the key. */
export function translate(
  lang: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let node: unknown = resources[lang].translation;
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Dict)[part] : undefined;
  }
  if (typeof node !== 'string') return key;
  return vars
    ? node.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? `{{${k}}}`))
    : node;
}

export function parseLang(value: string | undefined | null): Language {
  return value === 'en' ? 'en' : defaultLanguage;
}

export function makeT(lang: Language) {
  return {
    lang,
    dir: isRtl(lang) ? ('rtl' as const) : ('ltr' as const),
    t: (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
  };
}
export type Translator = ReturnType<typeof makeT>;
