/**
 * CSV for finance exports (spec §10 "CSV/Excel export"). UTF-8 with a BOM so Excel shows Arabic
 * correctly. Cells that could be read as formulas are prefixed with ' (CSV injection), except
 * plain numbers such as "-1.500".
 */
const BOM = String.fromCharCode(0xfeff);
const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
