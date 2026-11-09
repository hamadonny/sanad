/** StorageProvider (spec §12): identity documents, contracts, receipts. Encrypted at rest. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CryptoService } from '../common/crypto.service.js';
import type { PdfDoc } from '../pdf/pdf-doc.js';

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

/** PdfGenerator (spec §12): renders the document model in src/pdf (PDFKit implementation). */
export interface PdfGenerator {
  render(doc: PdfDoc): Promise<Buffer>;
}
export const PDF_GENERATOR = Symbol('PDF_GENERATOR');
