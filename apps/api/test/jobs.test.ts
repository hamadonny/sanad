/**
 * Job idempotency (spec §17): every scheduled job run twice gives the same result as once.
 * Also: failed gateway transfers are retried without double-paying.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CircleStore } from '../src/circles/circle-store.js';
import { DbService } from '../src/db/db.service.js';
import { circles } from '../src/db/schema.js';
import { SchedulerService } from '../src/jobs/scheduler.service.js';
import { DisbursementService } from '../src/payments/disbursement.service.js';
import {
  createTestApp,
  dbAvailable,
  idemKey,
  kuwait,
  pay,
  refreshAuth,
  signUp,
  type Member,
  type TestApp,
} from './helpers.js';

describe.skipIf(!dbAvailable)('scheduled jobs are idempotent', () => {
  let t: TestApp;
  const members: Member[] = [];
  let circleId = '';
  let scheduler: SchedulerService;

  const snapshot = async () => {
    const db = t.get<DbService>(DbService).db;
    const q = async (table: string) =>
      Number(
        (
          (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))).rows[0] as {
            n: number;
          }
        ).n,
      );
    const [c] = await db.select({ v: circles.stateVersion, s: circles.status }).from(circles);
    return {
      ledger: await q('ledger_transactions'),
      entries: await q('ledger_entries'),
      events: await q('circle_events'),
      payouts: await q('payouts'),
      refunds: await q('refunds'),
      notifications: await q('notifications'),
      stateVersion: c?.v,
      status: c?.s,
    };
  };

  const twice = async () => {
    await scheduler.tick();
    const first = await snapshot();
    const r2 = await scheduler.tick();
    expect(await snapshot()).toEqual(first);
    expect(r2).toMatchObject({
      cancelled: 0,
      drawn: 0,
      payouts: 0,
      defaults: 0,
      closed: 0,
      errors: [],
    });
    return first;
  };

  beforeAll(async () => {
    t = await createTestApp();
    scheduler = t.get<SchedulerService>(SchedulerService);
    t.clock.set(kuwait('2027-03-01'));
    for (let i = 0; i < 10; i += 1) members.push(await signUp(t, `Member ${i} Test`));
    for (const m of members) await pay(t, m, { monthlyKwd: 50 }, '/circles/queue');
    const db = t.get<DbService>(DbService).db;
    circleId = (await db.select({ id: circles.id }).from(circles))[0]!.id;
  });
  afterAll(async () => {
    await t?.close();
  });

  it('auction close + draw', async () => {
    t.clock.advance(49 * 3_600_000);
    await refreshAuth(t, members);
    const s = await twice();
    expect(s.status).toBe('ACTIVE');
  });

  it('payout, reminders and defaults across a month where one member does not pay', async () => {
    const store = t.get<CircleStore>(CircleStore);
    const schedule = (
      await t.http.get(`/circles/${circleId}/schedule`).set(members[0]!.auth).expect(200)
    ).body.rows as { month: number; dueDate: string; payoutDate: string; defaultsOn: string }[];
    const row = schedule[0]!;
    const { state } = await store.read(circleId);
    const nonPayer = state.slots.find((s) => s.spot === 5)!.holderId!;

    t.clock.set(kuwait(row.dueDate));
    await refreshAuth(t, members);
    await twice(); // due-today reminders
    for (const m of members)
      if (m.id !== nonPayer) await pay(t, m, { purpose: 'CONTRIBUTION', circleId, month: 1 });

    t.clock.set(kuwait(row.payoutDate));
    const afterPayout = await twice();
    expect(afterPayout.payouts).toBe(1);

    t.clock.set(kuwait(row.defaultsOn));
    await twice();
    const { state: after } = await store.read(circleId);
    expect(after.members.find((m) => m.memberId === nonPayer)?.status).toBe('DEFAULTED_PRE_PAYOUT');
  });

  it('a failed transfer is retried later and paid exactly once', async () => {
    const extra = await signUp(t, 'Refund Me');
    await pay(t, extra, { monthlyKwd: 100 }, '/circles/queue');
    const list = (await t.http.get('/circles').set(extra.auth).expect(200)).body as {
      id: string;
      status: string;
    }[];
    const forming = list.find((c) => c.status === 'FORMING')!;
    t.gateway.failNextTransfers = 1;
    await t.http.delete(`/circles/queue/${forming.id}`).set(extra.auth).expect(204);
    const db = t.get<DbService>(DbService).db;
    const pending = (
      await db.execute(sql`SELECT status, attempts FROM refunds WHERE user_id = ${extra.id}`)
    ).rows as { status: string; attempts: number }[];
    expect(pending).toEqual([{ status: 'PENDING', attempts: 1 }]);
    const disb = t.get<DisbursementService>(DisbursementService);
    await disb.flush();
    await disb.flush();
    const done = (await db.execute(sql`SELECT status FROM refunds WHERE user_id = ${extra.id}`))
      .rows as { status: string }[];
    expect(done).toEqual([{ status: 'SENT' }]);
    expect(t.gateway.transfers.filter((x) => x.userId === extra.id)).toHaveLength(1);
  });

  it('two webhooks racing for the same payment apply it once', async () => {
    const m = await signUp(t, 'Racer');
    const intent = await t.http
      .post('/circles/queue')
      .set(m.auth)
      .set('Idempotency-Key', idemKey())
      .send({ monthlyKwd: 100 })
      .expect(201);
    const id = intent.body.payment.id as string;
    const { body, signature } = t.gateway.buildWebhook({
      type: 'charge.succeeded',
      eventId: 'e',
      providerRef: `mockch_${id}`,
      paymentId: id,
      amount: 30_000n, // 3% organising fee of a 1,000 KWD pot
      paidAt: t.clock.now().toISOString(),
    });
    await Promise.all([
      t.http
        .post('/payments/webhook')
        .set('content-type', 'application/json')
        .set('x-sanad-signature', signature)
        .send(body),
      t.http
        .post('/payments/webhook')
        .set('content-type', 'application/json')
        .set('x-sanad-signature', signature)
        .send(body),
    ]);
    const db = t.get<DbService>(DbService).db;
    const joins = (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM ledger_transactions WHERE type = 'FEE_PAID' AND member_id = ${m.id}`,
      )
    ).rows as { n: number }[];
    expect(joins[0]!.n).toBe(1);
  });
});
