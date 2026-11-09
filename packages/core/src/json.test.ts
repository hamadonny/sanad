import { describe, expect, it } from 'vitest';
import { decodeJson, encodeJson } from './json.js';

describe('bigint-safe JSON', () => {
  it('round-trips nested bigints', () => {
    const v = { a: 1n, b: [2n, { c: -3n }], d: 'x', e: null, f: true };
    const encoded = JSON.parse(JSON.stringify(encodeJson(v))) as unknown;
    expect(encoded).toEqual({
      a: { $fils: '1' },
      b: [{ $fils: '2' }, { c: { $fils: '-3' } }],
      d: 'x',
      e: null,
      f: true,
    });
    expect(decodeJson(encoded)).toEqual(v);
  });
});
