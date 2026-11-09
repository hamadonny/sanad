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
  DATABASE_URL: z.string().default('postgresql://sanad:sanad@localhost:5433/sanad'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
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
  /**
   * Dev-only: comma-separated phones that sign in without an SMS code (founder testing until a
   * real SMS provider arrives in Phase 7). Ignored unless DEV_ENDPOINTS; always empty in production.
   */
  DEV_LOGIN_PHONES: z.string().default('+96599302447'),
  /** Optional chat webhook (Slack/Teams/Discord-compatible) for new API errors. */
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  /**
   * App Store / Play review account: this one phone signs in with REVIEW_CODE instead of an SMS
   * (also in production, because store reviewers cannot receive Kuwaiti SMS). Leave empty to
   * disable. Use a number you own and a random 6-digit code; share it only in the review notes.
   */
  REVIEW_PHONE: z.string().optional(),
  REVIEW_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  /** Apply pending database migrations when the API starts (development only). */
  MIGRATE_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = Omit<
  z.infer<typeof schema>,
  | 'DEV_LOGIN_PHONES'
  | 'JWT_SECRET'
  | 'ADMIN_JWT_SECRET'
  | 'ENCRYPTION_KEY'
  | 'BLIND_INDEX_KEY'
  | 'PAYMENT_WEBHOOK_SECRET'
> & {
  /** Normalised +965 numbers; empty unless dev endpoints are on. */
  DEV_LOGIN_PHONES: string[];
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

function normalizeKw(raw: string): string {
  const p = raw.replace(/[\s()-]/g, '');
  return p.startsWith('+') ? p : p.startsWith('00') ? `+${p.slice(2)}` : `+965${p}`;
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
    MIGRATE_ON_START: prod ? false : parsed.MIGRATE_ON_START,
    REVIEW_PHONE:
      parsed.REVIEW_PHONE && parsed.REVIEW_CODE ? normalizeKw(parsed.REVIEW_PHONE) : undefined,
    DEV_LOGIN_PHONES:
      prod || !parsed.DEV_ENDPOINTS
        ? []
        : parsed.DEV_LOGIN_PHONES.split(',')
            .map((p) => p.replace(/[\s()-]/g, ''))
            .filter((p) => p.length > 0)
            .map((p) =>
              p.startsWith('+') ? p : p.startsWith('00') ? `+${p.slice(2)}` : `+965${p}`,
            ),
  };
  for (const k of ['ENCRYPTION_KEY', 'BLIND_INDEX_KEY'] as const) {
    if (Buffer.from(env[k], 'base64').length !== 32)
      throw new Error(`${k} must be base64 of 32 bytes`);
  }
  return env;
}

export const ENV = Symbol('ENV');
