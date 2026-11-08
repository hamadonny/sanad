/**
 * Environment configuration, validated at startup. In development and test, safe throwaway
 * defaults are used for secrets; in production every secret must be provided.
 */
import { z } from 'zod';

const devSecret = (name: string) => `dev-only-${name}-change-me-0123456789abcdef`;
const devKey = Buffer.alloc(32, 7).toString('base64');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().default('postgresql://sanad:sanad@localhost:5432/sanad'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** How often the scheduler tick runs when jobs are enabled. */
  JOBS_TICK_SECONDS: z.coerce.number().int().positive().default(300),
  JWT_SECRET: z.string().min(32).optional(),
  ADMIN_JWT_SECRET: z.string().min(32).optional(),
  /** base64 of 32 random bytes — AES-256-GCM key for Civil ID numbers, documents and seeds. */
  ENCRYPTION_KEY: z.string().optional(),
  /** base64 of 32 random bytes — HMAC key for blind indexes (duplicate Civil ID detection). */
  BLIND_INDEX_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
  STORAGE_DIR: z.string().default('./.data/storage'),
  /** Providers: real integrations only arrive in Phase 7 (written go-ahead required). */
  PAYMENT_PROVIDER: z.literal('mock').default('mock'),
  IDENTITY_PROVIDER: z.enum(['mock', 'manual']).default('manual'),
  SMS_PROVIDER: z.literal('mock').default('mock'),
  PUSH_PROVIDER: z.literal('mock').default('mock'),
  /** Dev convenience: the mock identity provider approves submissions instantly. */
  MOCK_KYC_AUTO_APPROVE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Dev-only endpoints (mock payment confirmation, SMS inbox). Never enabled in production. */
  DEV_ENDPOINTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = Omit<
  z.infer<typeof schema>,
  | 'JWT_SECRET'
  | 'ADMIN_JWT_SECRET'
  | 'ENCRYPTION_KEY'
  | 'BLIND_INDEX_KEY'
  | 'PAYMENT_WEBHOOK_SECRET'
> & {
  JWT_SECRET: string;
  ADMIN_JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  BLIND_INDEX_KEY: string;
  PAYMENT_WEBHOOK_SECRET: string;
};

/** Load the repo-root `.env` (if present) without overriding variables already set. */
export function loadDotEnv(): void {
  for (const candidate of ['.env', '../../.env']) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      /* not found — try next */
    }
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && source.NODE_ENV !== 'test') loadDotEnv();
  // Treat empty values (e.g. `JWT_SECRET=` copied from .env.example) as "not set".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const parsed = schema.parse(cleaned);
  const prod = parsed.NODE_ENV === 'production';
  const need = (key: keyof typeof parsed, fallback: string): string => {
    const v = parsed[key];
    if (typeof v === 'string' && v.length > 0) return v;
    if (prod) throw new Error(`${String(key)} must be set in production`);
    return fallback;
  };
  const env: Env = {
    ...parsed,
    JWT_SECRET: need('JWT_SECRET', devSecret('jwt')),
    ADMIN_JWT_SECRET: need('ADMIN_JWT_SECRET', devSecret('admin-jwt')),
    ENCRYPTION_KEY: need('ENCRYPTION_KEY', devKey),
    BLIND_INDEX_KEY: need('BLIND_INDEX_KEY', Buffer.alloc(32, 9).toString('base64')),
    PAYMENT_WEBHOOK_SECRET: need('PAYMENT_WEBHOOK_SECRET', devSecret('webhook')),
    DEV_ENDPOINTS: prod ? false : parsed.DEV_ENDPOINTS,
  };
  for (const k of ['ENCRYPTION_KEY', 'BLIND_INDEX_KEY'] as const) {
    if (Buffer.from(env[k], 'base64').length !== 32)
      throw new Error(`${k} must be base64 of 32 bytes`);
  }
  return env;
}

export const ENV = Symbol('ENV');
