import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.js';

describe('csv', () => {
  it('quotes commas, quotes and new lines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });
  it('neutralises formulas but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-1.500')).toBe('-1.500');
  });
  it('starts with a BOM and uses CRLF', () => {
    expect(toCsv(['a'], [['ع']])).toBe('﻿a\r\nع\r\n');
  });
});
