import { describe, expect, it } from 'vitest';
import { defaultLanguage, isRtl, isSupportedLanguage, resources } from './index.js';

function keyPaths(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? keyPaths(v as object, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('defaults to Arabic, which is RTL', () => {
    expect(defaultLanguage).toBe('ar');
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });

  it('recognises supported languages', () => {
    expect(isSupportedLanguage('ar')).toBe(true);
    expect(isSupportedLanguage('fr')).toBe(false);
  });

  it('English has exactly the same keys as Arabic', () => {
    expect(keyPaths(resources.en.translation).sort()).toEqual(
      keyPaths(resources.ar.translation).sort(),
    );
  });

  it('has no empty strings', () => {
    const values = (obj: object): unknown[] =>
      Object.values(obj).flatMap((v) => (typeof v === 'object' && v !== null ? values(v) : [v]));
    for (const lang of ['ar', 'en'] as const) {
      for (const v of values(resources[lang].translation)) {
        expect(typeof v === 'string' && v.trim().length > 0).toBe(true);
      }
    }
  });
});
