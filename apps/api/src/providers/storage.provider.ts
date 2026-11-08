/** StorageProvider (spec §12): identity documents, contracts, receipts. Encrypted at rest. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CryptoService } from '../common/crypto.service.js';

export interface StorageProvider {
  put(prefix: string, data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<{ data: Buffer; contentType: string }>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/** Local disk, AES-256-GCM encrypted. Swap for S3-compatible storage in production. */
export class LocalEncryptedStorage implements StorageProvider {
  private readonly root: string;
  constructor(
    dir: string,
    private readonly crypto: CryptoService,
  ) {
    this.root = resolve(dir);
  }

  async put(prefix: string, data: Buffer, contentType: string): Promise<string> {
    if (!/^[a-z0-9-]+$/.test(prefix)) throw new Error('invalid storage prefix');
    const key = `${prefix}/${randomUUID()}`;
    await mkdir(join(this.root, prefix), { recursive: true });
    const payload = JSON.stringify({ contentType, data: data.toString('base64') });
    await writeFile(join(this.root, key), this.crypto.encrypt(payload), 'utf8');
    return key;
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string }> {
    if (!/^[a-z0-9-]+\/[0-9a-f-]{36}$/.test(key)) throw new Error('invalid storage key');
    const raw = await readFile(join(this.root, key), 'utf8');
    const { contentType, data } = JSON.parse(this.crypto.decrypt(raw)) as {
      contentType: string;
      data: string;
    };
    return { data: Buffer.from(data, 'base64'), contentType };
  }
}

/** PdfGenerator (spec §12) — real implementation in Phase 5 (contracts, receipts, case files). */
export interface PdfGenerator {
  render(templateKey: string, data: Record<string, unknown>): Promise<Buffer>;
}
export const PDF_GENERATOR = Symbol('PDF_GENERATOR');

export class PlaceholderPdfGenerator implements PdfGenerator {
  async render(templateKey: string, data: Record<string, unknown>): Promise<Buffer> {
    // Minimal valid single-page PDF so downloads work before Phase 5.
    const text =
      `${templateKey}: ${JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 80)}`.replace(
        /[()\\]/g,
        '',
      );
    const content = `BT /F1 10 Tf 40 800 Td (${text}) Tj ET`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }
}
