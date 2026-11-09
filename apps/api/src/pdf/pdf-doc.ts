/**
 * Document model for generated PDFs (contracts, addenda, receipts, legal case files).
 * Builders produce a `PdfDoc`; a `PdfGenerator` renders it. Keeping the model separate means
 * the renderer can be swapped (e.g. a design agency's templates) without touching the content.
 */
export type Dir = 'rtl' | 'ltr';

export type PdfBlock =
  | { kind: 'title'; text: string; dir?: Dir }
  | { kind: 'heading'; text: string; dir?: Dir }
  | { kind: 'paragraph'; text: string; dir?: Dir; size?: number; muted?: boolean }
  | { kind: 'kv'; rows: [string, string][]; dir?: Dir }
  | {
      kind: 'table';
      columns: { label: string; width: number; align?: 'start' | 'end' }[];
      rows: string[][];
      dir?: Dir;
    }
  | { kind: 'banner'; text: string; dir?: Dir; tone?: 'warning' | 'info' }
  | { kind: 'signature'; rows: [string, string][]; dir?: Dir }
  | { kind: 'divider' }
  | { kind: 'spacer'; size?: number }
  | { kind: 'pageBreak' };

export interface PdfDoc {
  /** Shown in the header of every page. */
  title: string;
  /** Document reference in the footer (e.g. receipt id, hash prefix). */
  reference?: string;
  /** Fixed creation date keeps the bytes stable for the same content. */
  createdAt: Date;
  /** Default text direction. Arabic documents are right-to-left. */
  dir: Dir;
  blocks: PdfBlock[];
  /** Footer line, e.g. "Placeholder — not legal advice". */
  watermark?: string;
}

const ARABIC = codeRanges([
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
]);

export const hasArabic = (s: string) => ARABIC.test(s);
export const dirOf = (s: string): Dir => (hasArabic(s) ? 'rtl' : 'ltr');

/** Character class from code point ranges (keeps invisible characters out of the source). */
export function codeRanges(ranges: [number, number][]): RegExp {
  const hex = (n: number) => `\\u${n.toString(16).padStart(4, '0')}`;
  return new RegExp(`[${ranges.map(([a, b]) => `${hex(a)}-${hex(b)}`).join('')}]`);
}
