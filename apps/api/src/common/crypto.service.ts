import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/**
 * Encryption at rest (spec §15): AES-256-GCM for sensitive fields and documents, HMAC blind
 * indexes for lookups on encrypted values, SHA-256 for tokens, scrypt for admin passwords.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly indexKey: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
    this.indexKey = Buffer.from(env.BLIND_INDEX_KEY, 'base64');
  }

  encrypt(plain: Buffer | string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([
      cipher.update(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join('.');
  }

  decryptBuffer(token: string): Buffer {
    const [version, iv, tag, data] = token.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('invalid ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  }

  decrypt(token: string): string {
    return this.decryptBuffer(token).toString('utf8');
  }

  blindIndex(value: string): string {
    return createHmac('sha256', this.indexKey).update(value).digest('hex');
  }

  sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  randomBytes(n: number): Uint8Array {
    return new Uint8Array(randomBytes(n));
  }

  /** Uniform numeric code, e.g. a 6-digit OTP. */
  numericCode(digits: number): string {
    return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
  }

  safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt, 64);
    return `scrypt.${salt.toString('base64')}.${hash.toString('base64')}`;
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [kind, salt, hash] = stored.split('.');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const candidate = await scryptAsync(password, Buffer.from(salt, 'base64'), 64);
    return timingSafeEqual(candidate, Buffer.from(hash, 'base64'));
  }
}
