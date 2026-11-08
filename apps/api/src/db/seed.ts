/**
 * Demo data (spec §12): demo users, circles in every state, and the §5.14 worked examples.
 *
 *   pnpm infra:up && pnpm --filter @sanad/api db:migrate && pnpm --filter @sanad/api db:seed
 *
 * Runs against DATABASE_URL using the real services with mock providers. It moves the API
 * clock through past months, so the example circles are fully played out (CLOSED), one
 * circle is mid-way (ACTIVE), one is in its auction, one is FORMING and one was CANCELLED.
 * Refuses to run when NODE_ENV=production.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { addDays, buildSchedule, findSeed, kuwaitDate, kwd, type Behavior } from '@sanad/core';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { AdminService } from '../admin/admin.service.js';
import { CircleStore } from '../circles/circle-store.js';
import { CirclesService } from '../circles/circles.service.js';
import { ClockService } from '../common/clock.service.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { KycService } from '../kyc/kyc.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { SEED_SOURCE, type CryptoSeedSource } from '../providers/seed.source.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DbService } from './db.service.js';
import { circles, trustProfiles, users } from './schema.js';
import { fundCapitalTransaction } from '@sanad/core';
import { LedgerRepository } from '../ledger/ledger.repository.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('refusing to seed a production database');
process.env.IDENTITY_PROVIDER = 'mock';
process.env.MOCK_KYC_AUTO_APPROVE = 'true';
process.env.JOBS_ENABLED = 'false';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const db = app.get(DbService).db;
const clock = app.get(ClockService);
const payments = app.get(PaymentsService);
const circlesSvc = app.get(CirclesService);
const scheduler = app.get(SchedulerService);
const store = app.get(CircleStore);
const seeds = app.get<CryptoSeedSource>(SEED_SOURCE);

const [{ n: existing } = { n: 0 }] = (await db.execute(sql`SELECT count(*)::int AS n FROM circles`))
  .rows as { n: number }[];
if (existing > 0) {
  console.log(
    'Database already has circles — skipping seed. Reset with: pnpm infra:down && docker volume rm sanad_postgres-data',
  );
  await app.close();
  process.exit(0);
}

await app.get(SettingsService).ensureSeeded();
await app.get(ContractsService).ensureSeeded();
await app.get(NotificationsService).seedTemplates();

const realNow = new Date();
const at = (d: Date | string) =>
  clock.set(typeof d === 'string' ? new Date(`${d}T10:00:00+03:00`) : d);

// ── admin ──
const adminEmail = 'admin@sanad.local';
const adminPassword = 'sanad-dev-admin-2027';
let totpSecret = '(already existed)';
try {
  totpSecret = (await app.get(AdminService).createAdmin(adminEmail, adminPassword, ['super_admin']))
    .totpSecret;
} catch {
  /* exists */
}

// ── launch reserve ──
await db.transaction((tx) =>
  app
    .get(LedgerRepository)
    .post(tx, [
      fundCapitalTransaction(
        'FUND_CAPITAL:demo-launch-reserve',
        kwd(20_000),
        'demo launch reserve',
      ),
    ]),
);

let phone = 50_000_000;
let civil = 280_000_000_000;
async function member(fullNameEn: string, completedCircles = 0): Promise<string> {
  phone += 1;
  civil += 1;
  const [u] = await db
    .insert(users)
    .values({ phone: `+965${phone}` })
    .returning({ id: users.id });
  await db.insert(trustProfiles).values({ userId: u!.id, completedCircles });
  await app.get(KycService).submit(
    u!.id,
    {
      fullNameAr: 'عضو تجريبي',
      fullNameEn,
      civilIdNumber: String(civil),
      nationality: 'KW',
      dateOfBirth: '1990-01-01',
      civilIdExpiry: '2035-12-31',
      address: 'Kuwait City',
    },
    {},
  );
  const c = await app.get(ContractsService).current();
  await app
    .get(ContractsService)
    .sign(u!.id, c.version, { ip: '127.0.0.1', userAgent: 'seed', deviceId: null });
  return u!.id;
}

let key = 0;
const confirm = async (userId: string, input: Parameters<PaymentsService['createIntent']>[1]) => {
  const { payment } = await payments.createIntent(userId, input, `seed-${(key += 1)}-key`);
  await payments.devConfirm(payment.id);
};

async function circleOf(userId: string): Promise<string> {
  const rows = (
    await db.execute(
      sql`SELECT c.id FROM circles c JOIN circle_members m ON m.circle_id = c.id WHERE m.user_id = ${userId} ORDER BY c.created_at DESC LIMIT 1`,
    )
  ).rows as { id: string }[];
  return rows[0]!.id;
}

interface Spec {
  name: string;
  completed: number;
  bid?: { spot: number; kwd: number };
  behavior?: Behavior;
}

/** Form a 100-KWD circle, run the auction and draw, then play `months` months. */
async function play(
  label: string,
  specs: Spec[],
  opts: {
    start: string;
    months: number;
    forceSpots?: Record<string, number>;
    replacement?: { replaces: string; afterMonth: number };
  },
) {
  at(opts.start);
  const ids = new Map<string, string>();
  for (const s of specs) ids.set(s.name, await member(`${s.name} ${label}`, s.completed));
  const winners = specs.filter((s) => s.bid);
  seeds.override = opts.forceSpots
    ? ({ circleId, memberIds }) => {
        const w = new Set(winners.map((x) => ids.get(x.name)));
        const taken = new Set(winners.map((x) => x.bid!.spot));
        return findSeed(
          `seed-${label}`,
          {
            circleId,
            memberIds: memberIds.filter((id) => !w.has(id)),
            spots: Array.from({ length: 10 }, (_, i) => i + 1).filter((s) => !taken.has(s)),
          },
          (spotOf) =>
            Object.entries(opts.forceSpots!).every(([n, spot]) => spotOf.get(ids.get(n)!) === spot),
        );
      }
    : null;
  for (const s of specs)
    await confirm(ids.get(s.name)!, { purpose: 'ENTRY_FEE', monthlyFils: kwd(100) });
  const circleId = await circleOf(ids.get(specs[0]!.name)!);
  for (const w of winners)
    await circlesSvc.placeBid(ids.get(w.name)!, circleId, w.bid!.spot, kwd(w.bid!.kwd));
  if (opts.months === 0) return circleId;
  clock.advance(49 * 3_600_000);
  await scheduler.tick();
  const { row, config, state } = await store.read(circleId);
  const schedule = buildSchedule(config, row.startDate as string, state.n);
  const behaviorOf = (id: string) => specs.find((s) => ids.get(s.name) === id)?.behavior;
  const pays = (id: string, k: number) => {
    const b = behaviorOf(id) ?? { kind: 'PAYS_ALL' as const };
    if (b.kind === 'STOPS_AFTER' && k > b.lastPaidMonth) return 'NO';
    return b.lateMonths?.includes(k) ? 'LATE' : 'ON_TIME';
  };
  const holders = async () => {
    const s = (await store.read(circleId)).state;
    return s.slots.flatMap((sl) =>
      sl.holderId && s.members.find((m) => m.memberId === sl.holderId)?.status === 'ACTIVE'
        ? [sl.holderId]
        : [],
    );
  };
  for (const r of schedule.slice(0, opts.months)) {
    at(r.dueDate);
    for (const id of await holders())
      if (pays(id, r.month) === 'ON_TIME')
        await confirm(id, { purpose: 'CONTRIBUTION', circleId, month: r.month });
    at(r.payoutDate);
    await scheduler.tick();
    at(addDays(r.payoutDate, 1));
    for (const id of await holders())
      if (pays(id, r.month) === 'LATE')
        await confirm(id, { purpose: 'CONTRIBUTION', circleId, month: r.month });
    at(r.defaultsOn);
    await scheduler.tick();
    if (opts.replacement?.afterMonth === r.month) {
      const rid = await member(`R ${label}`, 2);
      const vacant = (await store.read(circleId)).state.slots.find(
        (sl) => sl.vacatedBy === ids.get(opts.replacement!.replaces),
      )!;
      await confirm(rid, { purpose: 'REPLACEMENT', circleId, spot: vacant.spot });
    }
  }
  seeds.override = null;
  return circleId;
}

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const example = (o: Record<string, Partial<Spec>> = {}): Spec[] =>
  NAMES.map((name) => ({
    name,
    completed: name === 'B' ? 0 : 2,
    ...(name === 'A' ? { bid: { spot: 1, kwd: 45 } } : {}),
    ...o[name],
  }));

const report: [string, string][] = [];
report.push([
  'Example 1 (everyone pays)',
  await play('ex1', example(), { start: '2025-01-05', months: 10, forceSpots: { B: 2, H: 8 } }),
]);
report.push([
  'Example 2 (post-payout default)',
  await play('ex2', example({ B: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 2 } } }), {
    start: '2025-01-06',
    months: 10,
    forceSpots: { B: 2, H: 8 },
  }),
]);
report.push([
  'Example 3 (pre-payout default)',
  await play('ex3', example({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }), {
    start: '2025-01-07',
    months: 10,
    forceSpots: { B: 2, H: 8 },
  }),
]);
report.push([
  'Example 4 (replacement)',
  await play('ex4', example({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }), {
    start: '2025-01-08',
    months: 10,
    forceSpots: { B: 2, H: 8 },
    replacement: { replaces: 'H', afterMonth: 6 },
  }),
]);
report.push([
  'Example 5 (no bids)',
  await play(
    'ex5',
    NAMES.map((name, i) => ({ name, completed: i < 3 ? 0 : i < 5 ? 1 : 2 })),
    { start: '2025-01-09', months: 10, forceSpots: { A: 1, D: 3 } },
  ),
]);

// ACTIVE: started ~2.5 months ago, everyone pays, one member late once.
const realToday = kuwaitDate(realNow);
const activeStart = addDays(realToday, -80);
report.push([
  'ACTIVE demo',
  await play(
    'active',
    NAMES.map((name) => ({
      name,
      completed: 1,
      ...(name === 'C' ? { behavior: { kind: 'PAYS_ALL', lateMonths: [2] } as Behavior } : {}),
    })),
    { start: activeStart, months: 2 },
  ),
]);

// AUCTION: full circle with two open bids.
at(new Date(realNow.getTime() - 3_600_000));
report.push([
  'AUCTION demo',
  await play(
    'auction',
    NAMES.map((name, i) => ({
      name,
      completed: 2,
      ...(i < 2 ? { bid: { spot: i + 1, kwd: 30 - i * 10 + 5 } } : {}),
    })),
    { start: realToday, months: 0 },
  ),
]);

// FORMING: 4 of 10.
at(realNow);
const formingIds: string[] = [];
for (const n of ['Noura', 'Yousef', 'Maryam', 'Khaled'])
  formingIds.push(await member(`${n} Forming`, 0));
for (const id of formingIds) await confirm(id, { purpose: 'ENTRY_FEE', monthlyFils: kwd(50) });
report.push(['FORMING demo', await circleOf(formingIds[0]!)]);

// CANCELLED: 2 members, timed out.
at(addDays(realToday, -30));
const lonely = [await member('Lonely One', 2), await member('Lonely Two', 2)];
for (const id of lonely) await confirm(id, { purpose: 'ENTRY_FEE', monthlyFils: kwd(250) });
clock.advance(15 * 86_400_000);
await scheduler.tick();
report.push(['CANCELLED demo', await circleOf(lonely[0]!)]);

clock.set(null);
const statuses = await db.select({ id: circles.id, status: circles.status }).from(circles);
console.log('\nSanad demo data ready\n');
for (const [label, id] of report)
  console.log(`  ${label.padEnd(34)} ${statuses.find((s) => s.id === id)?.status.padEnd(9)} ${id}`);
console.log(
  `\n  Members: phones +96550000001 … +965${phone}. Sign in with OTP; read codes at GET /dev/sms?phone=…`,
);
console.log(
  `  Admin:   ${adminEmail} / ${adminPassword}   TOTP secret: ${totpSecret}  (add to an authenticator app)`,
);
await app.close();
