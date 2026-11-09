/**
 * Integration-test harness: a fresh Postgres database per test file, migrations applied, the
 * full Nest app with mock providers, a controllable clock and a deterministic seed source.
 *
 * Needs Postgres (docker compose up -d, or TEST_DATABASE_URL). Locally the suite is skipped
 * with a warning when no database is reachable; in CI (CI=true) it fails instead.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { ClockService } from '../src/common/clock.service.js';
import { runMigrations } from '../src/db/migrate.js';
import { SMS_PROVIDER, type MockSmsProvider } from '../src/providers/messaging.provider.js';
import { PAYMENT_PROVIDER, type MockPaymentProvider } from '../src/providers/payment.provider.js';
import { SEED_SOURCE, type SeedSource } from '../src/providers/seed.source.js';
import { AdminService } from '../src/admin/admin.service.js';
import { totpAt } from '../src/common/totp.js';
import { TokensService } from '../src/auth/tokens.service.js';
import { fixtureSeed } from '@sanad/core';

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://sanad:sanad@localhost:5433/postgres';

async function canConnect(): Promise<boolean> {
  const c = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    if (process.env.CI) throw new Error(`CI: cannot reach Postgres at ${ADMIN_URL}`);
    console.warn(
      `\n⚠ Skipping API integration tests: no Postgres at ${ADMIN_URL}. Run "pnpm infra:up".\n`,
    );
    return false;
  }
}

export const dbAvailable = await canConnect();

/** Seed source that tests can program per circle (falls back to a fixture seed). */
export class TestSeedSource implements SeedSource {
  chooser: ((ctx: { circleId: string; memberIds: readonly string[] }) => string) | null = null;
  next(ctx: { circleId: string; memberIds: readonly string[] }): string {
    return this.chooser ? this.chooser(ctx) : fixtureSeed(`api-${ctx.circleId}`);
  }
}

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  clock: ClockService;
  sms: MockSmsProvider;
  gateway: MockPaymentProvider;
  seeds: TestSeedSource;
  get<T>(token: unknown): T;
  close(): Promise<void>;
}

export async function createTestApp(opts: { identity?: 'mock' | 'manual' } = {}): Promise<TestApp> {
  const dbName = `sanad_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'test';
  process.env.IDENTITY_PROVIDER = opts.identity ?? 'mock';
  process.env.MOCK_KYC_AUTO_APPROVE = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.STORAGE_DIR = `./.data/test-storage/${dbName}`;
  await runMigrations(url.toString());

  const seeds = new TestSeedSource();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SEED_SOURCE)
    .useValue(seeds)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: ['error'] });
  configureApp(app);
  await app.init();
  const clock = app.get(ClockService);
  return {
    app,
    http: request(app.getHttpServer()),
    clock,
    sms: app.get<MockSmsProvider>(SMS_PROVIDER),
    gateway: app.get<MockPaymentProvider>(PAYMENT_PROVIDER),
    seeds,
    get: <T>(token: unknown) => app.get(token as never) as T,
    async close() {
      await app.close();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await c.end();
    },
  };
}

let phoneCounter = 50_100_000;
let civilCounter = 290_000_000_001;

export interface Member {
  id: string;
  token: string;
  phone: string;
  auth: { Authorization: string };
}

/** Sign up via OTP, pass (mock) KYC and sign the current contract. */
export async function signUp(
  t: TestApp,
  fullNameEn: string,
  opts: { kyc?: boolean; sign?: boolean } = {},
): Promise<Member> {
  phoneCounter += 1;
  const phone = `+965${phoneCounter}`;
  await t.http.post('/auth/otp/request').send({ phone }).expect(200);
  const code = /(\d{6})/.exec(t.sms.lastTo(phone) ?? '')?.[1];
  const res = await t.http.post('/auth/otp/verify').send({ phone, code }).expect(200);
  const m: Member = {
    id: res.body.userId as string,
    token: res.body.accessToken as string,
    phone,
    auth: { Authorization: `Bearer ${res.body.accessToken as string}` },
  };
  if (opts.kyc !== false) {
    civilCounter += 1;
    await t.http
      .post('/kyc/submissions')
      .set(m.auth)
      .send({
        fullNameAr: 'عضو تجريبي',
        fullNameEn,
        civilIdNumber: String(civilCounter),
        nationality: 'KW',
        dateOfBirth: '1990-01-01',
        civilIdExpiry: '2035-01-01',
        address: 'Kuwait City',
      })
      .expect(201);
  }
  if (opts.sign !== false) {
    const c = await t.http.get('/contracts/current').set(m.auth).expect(200);
    const req = await t.http
      .post('/contracts/sign/request')
      .set(m.auth)
      .send({ version: c.body.version })
      .expect(200);
    await t.http
      .post('/contracts/sign')
      .set(m.auth)
      .send({ version: c.body.version, code: req.body.devCode })
      .expect(200);
  }
  return m;
}

/** Re-issue access tokens (needed after the test clock jumps past their 15-minute lifetime). */
export async function refreshAuth(t: TestApp, members: Iterable<Member>): Promise<void> {
  const tokens = t.get<TokensService>(TokensService);
  for (const m of members) {
    const pair = await tokens.issue('member', m.id);
    m.token = pair.accessToken;
    m.auth.Authorization = `Bearer ${pair.accessToken}`;
  }
}

/** Create a super-admin and return an auth header. */
export async function adminAuth(
  t: TestApp,
  roles: string[] = ['super_admin'],
): Promise<{ Authorization: string }> {
  const email = `admin-${randomUUID().slice(0, 8)}@sanad.test`;
  const password = 'correct-horse-battery-staple';
  const { totpSecret } = await t
    .get<AdminService>(AdminService)
    .createAdmin(email, password, roles as never);
  const res = await t.http
    .post('/admin/auth/login')
    .send({ email, password, totp: totpAt(totpSecret, t.clock.now().getTime()) })
    .expect(200);
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}

let keyCounter = 0;
export const idemKey = () => `test-key-${(keyCounter += 1)}-${randomUUID().slice(0, 8)}`;

/** Create + confirm (mock gateway) a payment intent. */
export async function pay(
  t: TestApp,
  m: Member,
  body: Record<string, unknown>,
  path = '/payments/intents',
): Promise<{ id: string; status: string }> {
  const res = await t.http.post(path).set(m.auth).set('Idempotency-Key', idemKey()).send(body);
  if (res.status !== 201)
    throw new Error(`intent failed ${res.status}: ${JSON.stringify(res.body)}`);
  const confirmed = await t.http
    .post(`/payments/dev/${res.body.payment.id as string}/confirm`)
    .set(m.auth)
    .expect(200);
  return { id: res.body.payment.id as string, status: confirmed.body.status as string };
}

/** Kuwait-local instant for a calendar date. */
export const kuwait = (date: string, time = '10:00') => new Date(`${date}T${time}:00+03:00`);

/** supertest parser that collects a binary body (PDF, ZIP) into a Buffer. */
export const binary = ((res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}) as never;
