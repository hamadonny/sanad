import { describe, expect, it } from 'vitest';
import { documentAttributes, translations } from './locale';

describe('admin locale', () => {
  it('defaults to Arabic RTL', () => {
    expect(documentAttributes()).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(translations().admin.title).toBe('لوحة تحكم سند');
  });

  it('supports English LTR', () => {
    expect(documentAttributes('en')).toEqual({ lang: 'en', dir: 'ltr' });
  });
});
