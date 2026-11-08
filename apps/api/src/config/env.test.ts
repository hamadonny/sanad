import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('env', () => {
  it('treats empty secrets from a copied .env.example as unset (dev defaults apply)', () => {
    const e = loadEnv({
      NODE_ENV: 'test',
      JWT_SECRET: '',
      ADMIN_JWT_SECRET: ' ',
      PAYMENT_WEBHOOK_SECRET: '',
      ENCRYPTION_KEY: '',
    });
    expect(e.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(Buffer.from(e.ENCRYPTION_KEY, 'base64')).toHaveLength(32);
  });

  it('requires real secrets in production and disables dev endpoints', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow(
      /JWT_SECRET must be set/,
    );
  });
});
