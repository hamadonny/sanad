import { describe, expect, it } from 'vitest';
import { assertNonNegative, bpsOf, fils, formatKwd, kwd, parseKwd, sum } from './money.js';

describe('money primitives', () => {
  it('kwd() converts whole KWD to fils', () => {
    expect(kwd(100)).toBe(100_000n);
    expect(kwd(0n)).toBe(0n);
    expect(() => kwd(1.5)).toThrow(RangeError);
  });

  it('fils() only accepts integers', () => {
    expect(fils(250)).toBe(250n);
    expect(fils(7n)).toBe(7n);
    expect(() => fils(0.1)).toThrow(RangeError);
  });

  it('formatKwd() always shows 3 decimals', () => {
    expect(formatKwd(100_000n)).toBe('100.000');
    expect(formatKwd(955_000n)).toBe('955.000');
    expect(formatKwd(1n)).toBe('0.001');
    expect(formatKwd(12_345n)).toBe('12.345');
    expect(formatKwd(-50_500n)).toBe('-50.500');
    expect(formatKwd(0n)).toBe('0.000');
  });

  it('parseKwd() parses up to 3 decimals and rejects anything else', () => {
    expect(parseKwd('100')).toBe(100_000n);
    expect(parseKwd('12.5')).toBe(12_500n);
    expect(parseKwd(' 0.250 ')).toBe(250n);
    expect(parseKwd('-3.001')).toBe(-3_001n);
    expect(() => parseKwd('1.0001')).toThrow(RangeError);
    expect(() => parseKwd('abc')).toThrow(RangeError);
    expect(() => parseKwd('')).toThrow(RangeError);
  });

  it('parseKwd() and formatKwd() round-trip', () => {
    for (const s of ['0.000', '1.001', '999.999', '1000.000', '-7.050']) {
      expect(formatKwd(parseKwd(s))).toBe(s);
    }
  });

  it('bpsOf() rounds down to the nearest fils', () => {
    const m = kwd(100);
    expect(bpsOf(m, 3_000n)).toBe(kwd(30)); // spot 1 minimum bid (30%)
    expect(bpsOf(m, 500n)).toBe(kwd(5)); // min increment (5%)
    expect(bpsOf(kwd(1000), 1_000n)).toBe(kwd(100)); // 10% holdback
    expect(bpsOf(1n, 5_000n)).toBe(0n); // 0.5 fils → 0
    expect(bpsOf(333n, 3_333n)).toBe(110n); // 110.9889 → 110
    expect(() => bpsOf(-1n, 100n)).toThrow(RangeError);
    expect(() => bpsOf(1n, -100n)).toThrow(RangeError);
  });

  it('sum() adds amounts', () => {
    expect(sum([])).toBe(0n);
    expect(sum([kwd(955), kwd(900), kwd(8000)])).toBe(kwd(9855));
  });

  it('assertNonNegative() guards negative amounts', () => {
    expect(assertNonNegative(5n)).toBe(5n);
    expect(() => assertNonNegative(-1n, 'payout')).toThrow(/payout must be non-negative/);
  });
});
