/**
 * Renders a PdfDoc with PDFKit and the Readex Pro font (Arabic + Latin, embedded).
 *
 * Arabic needs two things PDF libraries rarely do together:
 * - shaping (joined letter forms) — fontkit, inside PDFKit, does this per string;
 * - bidirectional order (Arabic words right-to-left with numbers/English left-to-right inside).
 * We lay text out ourselves word by word: each line is split into runs of Arabic and non-Arabic
 * words, runs are placed in visual order, and each word is drawn as one shaped string.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { PdfGenerator } from '../providers/storage.provider.js';
import { codeRanges, type Dir, type PdfBlock, type PdfDoc } from './pdf-doc.js';

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const FONTS = {
  regular: `${FONT_DIR}ReadexPro_400Regular.ttf`,
  medium: `${FONT_DIR}ReadexPro_500Medium.ttf`,
  bold: `${FONT_DIR}ReadexPro_700Bold.ttf`,
};

const COLORS = {
  ink: '#252422',
  muted: '#5f5a53',
  border: '#ccc5b9',
  soft: '#f6f2e7',
  flame: '#eb5e28',
  warnBg: '#fbefd5',
  warn: '#8a5a00',
};

/** Arabic letters (not Arabic-Indic digits, which read left-to-right like other numbers). */
const ARABIC_LETTER = codeRanges([
  [0x0621, 0x064a],
  [0x066e, 0x06d3],
  [0x06d5, 0x06d5],
  [0x06fa, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
]);

type Doc = InstanceType<typeof PDFDocument>;

const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '«': '»',
  '»': '«',
  '<': '>',
  '>': '<',
};
const mirror = (w: string) =>
  ARABIC_LETTER.test(w) ? w.replace(/[()[\]{}«»<>]/g, (c) => MIRROR[c] ?? c) : w;
type Font = keyof typeof FONTS;

interface Style {
  font: Font;
  size: number;
  color: string;
}

const M = 50; // page margin
const HEADER = 34;
const FOOTER = 36;

/**
 * Visual placement of one line's words (x offsets from the line's left edge). Arabic words form
 * right-to-left runs, everything else (numbers, Latin) left-to-right runs; neutral tokens such
 * as "—" follow the paragraph direction. Pure, so it is unit-tested.
 */
export function layoutLine(
  words: string[],
  widths: number[],
  space: number,
  dir: Dir,
  width: number,
  align: 'start' | 'end' | 'center' = 'start',
): { word: string; x: number; rtl: boolean }[] {
  const cls = words.map((w) =>
    ARABIC_LETTER.test(w) ? 'rtl' : /[\p{L}\p{N}]/u.test(w) ? 'ltr' : dir,
  );
  const runs: number[][] = [];
  cls.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && cls[last[0]!] === c) last.push(i);
    else runs.push([i]);
  });
  const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
  const runWidth = (run: number[]) =>
    run.reduce((a, i) => a + widths[i]!, 0) + space * (run.length - 1);
  const slack = width - total;
  const offset = align === 'center' ? slack / 2 : align === 'end' ? slack : 0;
  const out: { word: string; x: number; rtl: boolean }[] = [];
  const put = (i: number, x: number) => out.push({ word: words[i]!, x, rtl: cls[i] === 'rtl' });
  if (dir === 'rtl') {
    let cursor = width - offset;
    for (const run of runs) {
      if (cls[run[0]!] === 'rtl') {
        for (const i of run) {
          cursor -= widths[i]!;
          put(i, cursor);
          cursor -= space;
        }
      } else {
        let at = cursor - runWidth(run);
        const next = at - space;
        for (const i of run) {
          put(i, at);
          at += widths[i]! + space;
        }
        cursor = next;
      }
    }
  } else {
    let cursor = offset;
    for (const run of runs) {
      if (cls[run[0]!] === 'ltr') {
        for (const i of run) {
          put(i, cursor);
          cursor += widths[i]! + space;
        }
      } else {
        let at = cursor + runWidth(run);
        for (const i of run) {
          at -= widths[i]!;
          put(i, at);
          at -= space;
        }
        cursor += runWidth(run) + space;
      }
    }
  }
  return out;
}

export class PdfKitGenerator implements PdfGenerator {
  async render(def: PdfDoc): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: M + HEADER, bottom: M + FOOTER, left: M, right: M },
      bufferPages: true,
      info: {
        Title: def.title,
        Producer: 'Sanad',
        Creator: 'Sanad',
        CreationDate: def.createdAt,
        ModDate: def.createdAt,
      },
      lang: def.dir === 'rtl' ? 'ar' : 'en',
      displayTitle: true,
    });
    for (const [name, path] of Object.entries(FONTS)) doc.registerFont(name, path);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    const r = new Renderer(doc, def.dir);
    for (const b of def.blocks) r.block(b);
    r.decorate(def);
    doc.end();
    return done;
  }
}

class Renderer {
  private y: number;
  constructor(
    private readonly doc: Doc,
    private readonly dir: Dir,
  ) {
    this.y = doc.page.margins.top;
  }

  private get left() {
    return this.doc.page.margins.left;
  }
  private get width() {
    return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right;
  }
  private get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  private ensure(h: number) {
    if (this.y + h > this.bottom) {
      this.doc.addPage();
      this.y = this.doc.page.margins.top;
    }
  }

  private use(s: Style) {
    this.doc.font(s.font).fontSize(s.size).fillColor(s.color);
  }

  private measure(text: string, s: Style): number {
    this.use(s);
    return this.doc.widthOfString(text);
  }

  /** Greedy word wrap; explicit new lines start new lines. */
  wrap(text: string, width: number, s: Style): string[][] {
    const lines: string[][] = [];
    const space = this.measure(' ', s);
    for (const para of text.split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push([]);
        continue;
      }
      let line: string[] = [];
      let w = 0;
      for (const word of words) {
        const ww = this.measure(word, s);
        if (line.length && w + space + ww > width) {
          lines.push(line);
          line = [];
          w = 0;
        }
        // A single word wider than the line is drawn anyway (rare: hashes) — split it.
        if (!line.length && ww > width) {
          let chunk = '';
          for (const ch of word) {
            if (this.measure(chunk + ch, s) > width) {
              lines.push([chunk]);
              chunk = '';
            }
            chunk += ch;
          }
          line = [chunk];
          w = this.measure(chunk, s);
          continue;
        }
        w += (line.length ? space : 0) + ww;
        line.push(word);
      }
      lines.push(line);
    }
    return lines;
  }

  /** Draw one line of words inside [x, x+width] with bidi run ordering. */
  drawLine(
    words: string[],
    x: number,
    width: number,
    y: number,
    dir: Dir,
    s: Style,
    align: 'start' | 'end' | 'center' = 'start',
  ) {
    if (words.length === 0) return;
    this.use(s);
    const placed = layoutLine(
      words,
      words.map((w) => this.doc.widthOfString(w)),
      this.doc.widthOfString(' '),
      dir,
      width,
      align,
    );
    for (const p of placed) {
      // fontkit reverses Arabic glyphs but does not mirror brackets, so mirror them ourselves.
      this.doc.text(p.rtl ? mirror(p.word) : p.word, x + p.x, y, {
        lineBreak: false,
        features: ['liga', 'kern'],
      });
    }
  }

  private lineHeight(s: Style) {
    return s.size * 1.55;
  }

  /** Wrapped text flowing across pages. */
  text(
    text: string,
    s: Style,
    dir: Dir,
    opts: { x?: number; width?: number; align?: 'start' | 'end' | 'center' } = {},
  ) {
    const x = opts.x ?? this.left;
    const width = opts.width ?? this.width;
    const lh = this.lineHeight(s);
    for (const line of this.wrap(text, width, s)) {
      this.ensure(lh);
      this.drawLine(line, x, width, this.y, dir, s, opts.align);
      this.y += lh;
    }
  }

  block(b: PdfBlock) {
    const dir = ('dir' in b && b.dir) || this.dir;
    switch (b.kind) {
      case 'title':
        this.text(b.text, { font: 'bold', size: 20, color: COLORS.ink }, dir);
        this.y += 6;
        break;
      case 'heading':
        this.ensure(40);
        this.y += 8;
        this.text(b.text, { font: 'bold', size: 13, color: COLORS.ink }, dir);
        this.doc
          .moveTo(this.left, this.y)
          .lineTo(this.left + this.width, this.y)
          .lineWidth(0.6)
          .strokeColor(COLORS.flame)
          .stroke();
        this.y += 8;
        break;
      case 'paragraph':
        this.text(
          b.text,
          { font: 'regular', size: b.size ?? 10.5, color: b.muted ? COLORS.muted : COLORS.ink },
          dir,
        );
        this.y += 4;
        break;
      case 'kv':
        this.kv(b.rows, dir, false);
        break;
      case 'signature':
        this.ensure(30 + b.rows.length * 18);
        this.y += 6;
        this.box(() => this.kv(b.rows, dir, true), COLORS.soft);
        break;
      case 'table':
        this.table(b.columns, b.rows, dir);
        break;
      case 'banner':
        this.y += 4;
        this.box(
          () =>
            this.text(
              b.text,
              { font: 'medium', size: 10, color: b.tone === 'info' ? COLORS.ink : COLORS.warn },
              dir,
              { x: this.left + 10, width: this.width - 20 },
            ),
          b.tone === 'info' ? COLORS.soft : COLORS.warnBg,
        );
        break;
      case 'divider':
        this.y += 6;
        this.doc
          .moveTo(this.left, this.y)
          .lineTo(this.left + this.width, this.y)
          .lineWidth(0.5)
          .strokeColor(COLORS.border)
          .stroke();
        this.y += 8;
        break;
      case 'spacer':
        this.y += b.size ?? 10;
        break;
      case 'pageBreak':
        this.doc.addPage();
        this.y = this.doc.page.margins.top;
        break;
    }
  }

  /** Background box behind content drawn by `fn` (content must fit on the current page). */
  private box(fn: () => void, fill: string) {
    const page = this.doc.bufferedPageRange().count;
    const top = this.y;
    this.y += 8;
    // Draw content first to know the height, then paint the box underneath via a second pass.
    const startY = this.y;
    fn();
    const end = this.y + 4;
    if (this.doc.bufferedPageRange().count === page) {
      this.doc.save();
      this.doc
        .rect(this.left, top, this.width, end - top)
        .fillOpacity(0.55)
        .fill(fill);
      this.doc.restore();
      // Re-draw on top for crisp text: simplest approach is to repeat the content.
      this.y = startY;
      fn();
    }
    this.y = end + 6;
  }

  private kv(rows: [string, string][], dir: Dir, strong: boolean) {
    const labelW = this.width * 0.34;
    const valueW = this.width - labelW - 12;
    const label: Style = { font: 'regular', size: 9.5, color: COLORS.muted };
    const value: Style = { font: strong ? 'medium' : 'regular', size: 10.5, color: COLORS.ink };
    for (const [k, v] of rows) {
      const kl = this.wrap(k, labelW, label);
      const vl = this.wrap(v, valueW, value);
      const h = Math.max(kl.length * this.lineHeight(label), vl.length * this.lineHeight(value));
      this.ensure(h);
      const lx = dir === 'rtl' ? this.left + this.width - labelW : this.left;
      const vx = dir === 'rtl' ? this.left : this.left + labelW + 12;
      let yy = this.y;
      for (const l of kl) {
        this.drawLine(l, lx, labelW, yy + 1, dir, label);
        yy += this.lineHeight(label);
      }
      yy = this.y;
      for (const l of vl) {
        this.drawLine(l, vx, valueW, yy, dir, value);
        yy += this.lineHeight(value);
      }
      this.y += h + 2;
    }
  }

  private table(
    columns: { label: string; width: number; align?: 'start' | 'end' }[],
    rows: string[][],
    dir: Dir,
  ) {
    const totalW = columns.reduce((a, c) => a + c.width, 0);
    const widths = columns.map((c) => (c.width / totalW) * this.width);
    const xs: number[] = [];
    let acc = 0;
    for (const w of widths) {
      xs.push(dir === 'rtl' ? this.left + this.width - acc - w : this.left + acc);
      acc += w;
    }
    const head: Style = { font: 'medium', size: 9, color: COLORS.muted };
    const cell: Style = { font: 'regular', size: 9.5, color: COLORS.ink };
    const pad = 5;
    const drawHeader = () => {
      const h = this.lineHeight(head) + pad;
      this.doc.rect(this.left, this.y, this.width, h).fill(COLORS.soft);
      columns.forEach((c, i) =>
        this.drawLine(
          c.label.split(' '),
          xs[i]! + pad,
          widths[i]! - pad * 2,
          this.y + pad / 2,
          dir,
          head,
          c.align ?? 'start',
        ),
      );
      this.y += h;
    };
    this.ensure(40);
    drawHeader();
    for (const row of rows) {
      const wrapped = row.map((v, i) => this.wrap(v, widths[i]! - pad * 2, cell));
      const h = Math.max(...wrapped.map((l) => l.length)) * this.lineHeight(cell) + pad;
      if (this.y + h > this.bottom) {
        this.doc.addPage();
        this.y = this.doc.page.margins.top;
        drawHeader();
      }
      wrapped.forEach((lines, i) => {
        let yy = this.y + pad / 2;
        for (const l of lines) {
          this.drawLine(
            l,
            xs[i]! + pad,
            widths[i]! - pad * 2,
            yy,
            dir,
            cell,
            columns[i]!.align ?? 'start',
          );
          yy += this.lineHeight(cell);
        }
      });
      this.y += h;
      this.doc
        .moveTo(this.left, this.y)
        .lineTo(this.left + this.width, this.y)
        .lineWidth(0.4)
        .strokeColor(COLORS.border)
        .stroke();
    }
    this.y += 8;
  }

  /** Header (brand + title) and footer (reference, page x/y, watermark) on every page. */
  decorate(def: PdfDoc) {
    const range = this.doc.bufferedPageRange();
    const small: Style = { font: 'regular', size: 8, color: COLORS.muted };
    const brand: Style = { font: 'bold', size: 12, color: COLORS.ink };
    for (let i = 0; i < range.count; i++) {
      this.doc.switchToPage(range.start + i);
      const top = M;
      const w = this.doc.page.width - M * 2;
      // Keystone mark: small flame square + wordmark.
      const markX = def.dir === 'rtl' ? M + w - 10 : M;
      this.doc.rect(markX, top + 2, 10, 10).fill(COLORS.flame);
      this.drawLine(
        ['سند', '·', 'Sanad'],
        def.dir === 'rtl' ? M : M + 16,
        w - 16,
        top - 1,
        def.dir,
        brand,
      );
      this.drawLine(def.title.split(' '), M, w, top + 16, def.dir, small, 'end');
      this.doc
        .moveTo(M, top + HEADER - 6)
        .lineTo(M + w, top + HEADER - 6)
        .lineWidth(0.5)
        .strokeColor(COLORS.border)
        .stroke();
      const fy = this.doc.page.height - M - FOOTER + 14;
      this.doc
        .moveTo(M, fy - 6)
        .lineTo(M + w, fy - 6)
        .lineWidth(0.5)
        .strokeColor(COLORS.border)
        .stroke();
      this.drawLine(
        [`${i + 1}/${range.count}`],
        M,
        w,
        fy,
        'ltr',
        small,
        def.dir === 'rtl' ? 'start' : 'end',
      );
      if (def.reference) this.drawLine(def.reference.split(' '), M, w, fy, def.dir, small);
      if (def.watermark)
        this.drawLine(def.watermark.split(' '), M, w, fy + 11, def.dir, {
          ...small,
          color: COLORS.warn,
        });
    }
  }
}

/** SHA-256 of a generated document (stored with signatures). */
export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
