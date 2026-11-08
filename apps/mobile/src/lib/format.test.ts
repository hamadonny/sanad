import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatMoney,
  groupKwd,
  localizeDigits,
  normalizeKuwaitPhone,
  parseKwdInput,
} from './format';

describe('money display (spec §9.2: KWD with 3 decimals)', () => {
  it('groups thousands and keeps 3 decimals', () => {
    expect(groupKwd('1000.000')).toBe('1,000.000');
    expect(groupKwd('955.500')).toBe('955.500');
    expect(groupKwd('-12345.001')).toBe('-12,345.001');
  });

  it('formats in both languages, optionally with Arabic-Indic digits', () => {
    expect(
      formatMoney({ fils: '955000', kwd: '955.000' }, { language: 'en', arabicNumerals: false }),
    ).toBe('955.000 KWD');
    expect(formatMoney(1_000_000n, { language: 'ar', arabicNumerals: false })).toBe(
      '1,000.000 د.ك',
    );
    expect(formatMoney('45.000', { language: 'ar', arabicNumerals: true })).toBe('٤٥.٠٠٠ د.ك');
    expect(formatMoney('45.000', { language: 'en', arabicNumerals: false, currency: false })).toBe(
      '45.000',
    );
    expect(localizeDigits('2027-01-05', true)).toBe('٢٠٢٧-٠١-٠٥');
  });

  it('parses typed amounts to fils, rejecting more than 3 decimals', () => {
    expect(parseKwdInput('45')).toBe(45_000n);
    expect(parseKwdInput('45.5')).toBe(45_500n);
    expect(parseKwdInput('٤٥')).toBe(45_000n);
    expect(parseKwdInput('1,000')).toBe(1_000_000n);
    expect(parseKwdInput('1.0005')).toBeNull();
    expect(parseKwdInput('abc')).toBeNull();
  });

  it('normalises Kuwaiti phone numbers', () => {
    expect(normalizeKuwaitPhone('50000001')).toBe('+96550000001');
    expect(normalizeKuwaitPhone('+965 9999 1234')).toBe('+96599991234');
    expect(normalizeKuwaitPhone('٥٠٠٠٠٠٠١')).toBe('+96550000001');
    expect(normalizeKuwaitPhone('12345678')).toBeNull();
  });

  it('countdowns', () => {
    expect(formatCountdown(0, 'en')).toBe('Ended');
    expect(formatCountdown(26 * 3600_000, 'en')).toBe('1d 2h');
    expect(formatCountdown(65_000, 'en')).toBe('1m 05s');
  });
});
