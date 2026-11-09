import { describe, expect, it } from 'vitest';
import { matchesDeclared, sniff } from './file-type.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const jpg = Buffer.from('ffd8ffe000104a46494600010101', 'hex');
const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj', 'latin1');

describe('upload sniffing', () => {
  it('recognises real files', () => {
    expect(sniff(png)).toBe('image/png');
    expect(sniff(jpg)).toBe('image/jpeg');
    expect(sniff(pdf)).toBe('application/pdf');
  });
  it('rejects content that does not match the declared type', () => {
    expect(matchesDeclared(Buffer.from('<script>alert(1)</script>'), 'image/png')).toBe(false);
    expect(matchesDeclared(pdf, 'image/png')).toBe(false);
    expect(matchesDeclared(png, 'image/png')).toBe(true);
    expect(matchesDeclared(jpg, 'image/jpg')).toBe(true);
  });
});
