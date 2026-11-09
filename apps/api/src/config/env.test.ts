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

  it('dev sign-in phones are normalised in development and never active in production', () => {
    expect(
      loadEnv({ NODE_ENV: 'development', DEV_LOGIN_PHONES: '9930 2447, +96550000001' })
        .DEV_LOGIN_PHONES,
    ).toEqual(['+96599302447', '+96550000001']);
    expect(loadEnv({ NODE_ENV: 'development', DEV_ENDPOINTS: 'false' }).DEV_LOGIN_PHONES).toEqual(
      [],
    );
    const k = Buffer.alloc(32, 1).toString('base64');
    const prod = loadEnv({
      NODE_ENV: 'production',
      DEV_ENDPOINTS: 'true',
      MIGRATE_ON_START: 'true',
      DEV_LOGIN_PHONES: '+96599302447',
      JWT_SECRET: 'x'.repeat(32),
      ADMIN_JWT_SECRET: 'y'.repeat(32),
      ENCRYPTION_KEY: k,
      BLIND_INDEX_KEY: k,
      PAYMENT_WEBHOOK_SECRET: 'z'.repeat(16),
    });
    expect(prod.DEV_ENDPOINTS).toBe(false);
    expect(prod.MIGRATE_ON_START).toBe(false);
    expect(prod.DEV_LOGIN_PHONES).toEqual([]);
  });
});
