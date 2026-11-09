import { describe, expect, it } from 'vitest';
import { scrub } from './scrub.js';

describe('scrub', () => {
  it('removes phones, civil IDs, emails, tokens and secrets', () => {
    const s = scrub(
      'user +96550000052 / 99302447 civil 290010112345 a@b.com Bearer abc.def code: 123456 {"password":"x"}',
    );
    expect(s).not.toMatch(/50000052|99302447|290010112345|a@b\.com|abc\.def|123456/);
    expect(s).toContain('[phone]');
    expect(s).toContain('[civil-id]');
    expect(s).toContain('[redacted]');
  });
  it('keeps ordinary diagnostics and truncates', () => {
    expect(scrub('TypeError: x is undefined at Home (index.tsx:12)')).toBe(
      'TypeError: x is undefined at Home (index.tsx:12)',
    );
    expect(scrub('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});
