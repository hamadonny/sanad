import { kwd } from '@sanad/core';
import { describe, expect, it } from 'vitest';
import { layoutDirection } from './i18n';
import { displayKwd } from './money';

describe('mobile display helpers', () => {
  it('shows KWD with 3 decimals in both languages', () => {
    expect(displayKwd(kwd(1000), 'en')).toBe('1000.000 KWD');
    expect(displayKwd(955_500n, 'ar')).toBe('955.500 د.ك');
  });

  it('lays Arabic out right-to-left', () => {
    expect(layoutDirection('ar')).toBe('rtl');
    expect(layoutDirection('en')).toBe('ltr');
  });
});
