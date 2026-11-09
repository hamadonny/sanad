/**
 * Full lifecycle through the HTTP API (spec §17): FORMING → AUCTION → DRAWING → ACTIVE →
 * CLOSING → CLOSED for each organiser-model worked example (D-017), with mock providers, a real Postgres
 * database, the real scheduler tick and a time-travelling clock.
 *
 * Each run is also replayed through the pure core engine (`runScenario`) with the same seed
 * and ids, and the two ledgers must agree — the API adds persistence, not different maths.
 */
import { defaultConfig } from '@sanad/config';
import { ACCOUNTS, findSeed, kwd, runScenario, type Behavior, type Fils } from '@sanad/core';
import { eq, sql } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CircleStore } from '../src/circles/circle-store.js';
import { DbService } from '../src/db/db.service.js';
import { circles, payouts, refunds, trustProfiles } from '../src/db/schema.js';
import { LedgerRepository } from '../src/ledger/ledger.repository.js';
import { SchedulerService } from '../src/jobs/scheduler.service.js';
import {
  adminAuth,
  binary,
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

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

interface MemberSpec {
  name: string;
  tier: 0 | 1 | 2;
  bid?: { spot: number; amountKwd: number };
  behavior?: Behavior;
}

interface ApiScenario {
  members: MemberSpec[];
  forceSpots?: Record<string, number>;
  replacement?: { replaces: string; afterMonth: number };
}

interface RunResult {
  circleId: string;
  members: Map<string, Member>;
  balance: (account: string) => Promise<Fils>;
  payoutTo: (name: string) => Promise<Fils | undefined>;
  holdbackReleasedTo: (name: string) => Promise<Fils>;
  refundTo: (name: string) => Promise<Fils>;
  t: TestApp;
  replacement?: Member;
}

const examples = (overrides: Partial<Record<string, Partial<MemberSpec>>> = {}): MemberSpec[] =>
  NAMES.map((name) => ({
    name,
    tier: name === 'B' ? 0 : 2,
    ...(name === 'A' ? { bid: { spot: 1, amountKwd: 45 } } : {}),
    ...overrides[name],
  }));

async function runApi(t: TestApp, sc: ApiScenario): Promise<RunResult> {
  const db = t.get<DbService>(DbService).db;
  const store = t.get<CircleStore>(CircleStore);
  const scheduler = t.get<SchedulerService>(SchedulerService);
  const ledger = t.get<LedgerRepository>(LedgerRepository);
  t.clock.set(kuwait('2027-01-03'));

  const members = new Map<string, Member>();
  const nameOf = new Map<string, string>();
  for (const spec of sc.members) {
    const m = await signUp(t, `${spec.name} Tester`);
    members.set(spec.name, m);
    nameOf.set(m.id, spec.name);
    if (spec.tier > 0)
      await db
        .update(trustProfiles)
        .set({ completedCircles: spec.tier })
        .where(eq(trustProfiles.userId, m.id));
  }

  // Deterministic draw that reproduces the example's spot assignment.
  const winners = sc.members.filter((m) => m.bid);
  t.seeds.chooser = ({ circleId, memberIds }) => {
    const winnerIds = new Set(winners.map((w) => members.get(w.name)!.id));
    const taken = new Set(winners.map((w) => w.bid!.spot));
    return findSeed(
      'api-example',
      {
        circleId,
        memberIds: memberIds.filter((id) => !winnerIds.has(id)),
        spots: Array.from({ length: 10 }, (_, i) => i + 1).filter((s) => !taken.has(s)),
      },
      (spotOf) =>
        Object.entries(sc.forceSpots ?? {}).every(
          ([name, spot]) => spotOf.get(members.get(name)!.id) === spot,
        ),
    );
  };

  for (const spec of sc.members) {
    const m = members.get(spec.name)!;
    const intent = await t.http
      .post('/circles/queue')
      .set(m.auth)
      .set('Idempotency-Key', idemKey())
      .send({ monthlyKwd: 100 })
      .expect(201);
    await t.http
      .post(`/payments/dev/${intent.body.payment.id as string}/confirm`)
      .set(m.auth)
      .expect(200);
  }
  const [circle] = await db.select({ id: circles.id, status: circles.status }).from(circles);
  expect(circle!.status).toBe('AUCTION');
  const circleId = circle!.id;

  for (const w of winners) {
    await t.http
      .post(`/circles/${circleId}/auction/bids`)
      .set(members.get(w.name)!.auth)
      .send({ spot: w.bid!.spot, amountFils: String(kwd(w.bid!.amountKwd)) })
      .expect(201);
  }

  t.clock.advance(48 * 3_600_000 + 60_000);
  await refreshAuth(t, members.values());
  const drawn = await scheduler.tick();
  expect(drawn.drawn).toBe(1);

  const schedule = (
    await t.http.get(`/circles/${circleId}/schedule`).set(members.get('A')!.auth).expect(200)
  ).body.rows as { month: number; dueDate: string; payoutDate: string; defaultsOn: string }[];
  const behaviorOf = (id: string): Behavior | undefined =>
    sc.members.find((m) => members.get(m.name)!.id === id)?.behavior;
  const pays = (id: string, k: number): 'ON_TIME' | 'LATE' | 'NO' => {
    const b = behaviorOf(id) ?? { kind: 'PAYS_ALL' };
    if (b.kind === 'STOPS_AFTER' && k > b.lastPaidMonth) return 'NO';
    return b.lateMonths?.includes(k) ? 'LATE' : 'ON_TIME';
  };
  const activeHolders = async () => {
    const { state } = await store.read(circleId);
    return state.slots.flatMap((s) =>
      s.holderId && state.members.find((m) => m.memberId === s.holderId)?.status === 'ACTIVE'
        ? [s.holderId]
        : [],
    );
  };
  const auth = (id: string) => everyone().find((m) => m.id === id)!;

  let replacement: Member | undefined;
  const everyone = () => [...members.values(), ...(replacement ? [replacement] : [])];
  const at = async (d: Date) => {
    t.clock.set(d);
    await refreshAuth(t, everyone());
  };
  for (const row of schedule) {
    await at(kuwait(row.dueDate));
    for (const id of await activeHolders())
      if (pays(id, row.month) === 'ON_TIME')
        await pay(t, auth(id), { purpose: 'CONTRIBUTION', circleId, month: row.month });
    await at(kuwait(row.payoutDate));
    await scheduler.tick();
    await at(kuwait(row.payoutDate, '18:00'));
    for (const id of await activeHolders())
      if (pays(id, row.month) === 'LATE')
        await pay(t, auth(id), { purpose: 'CONTRIBUTION', circleId, month: row.month });
    await at(kuwait(row.defaultsOn));
    await scheduler.tick();
    if (sc.replacement && sc.replacement.afterMonth === row.month) {
      replacement = await signUp(t, 'R Replacement');
      await db
        .update(trustProfiles)
        .set({ completedCircles: 2 })
        .where(eq(trustProfiles.userId, replacement.id));
      nameOf.set(replacement.id, 'R');
      const offers = (await t.http.get('/circles/replacements').set(replacement.auth).expect(200))
        .body as { circleId: string; spot: number; payNow: { fils: string } }[];
      expect(offers).toHaveLength(1);
      expect(offers[0]!.payNow.fils).toBe(String(kwd(30 + 100 * sc.replacement.afterMonth)));
      await pay(t, replacement, { purpose: 'REPLACEMENT', circleId, spot: offers[0]!.spot });
    }
  }
  const { state } = await store.read(circleId);
  expect(state.status).toBe('CLOSED');

  const memberId = (name: string) => (name === 'R' ? replacement!.id : members.get(name)!.id);
  const one = async (sumOf: ReturnType<typeof sql<string>>) =>
    BigInt(((await db.execute(sumOf)).rows[0] as { s: string | null }).s ?? '0');
  return {
    circleId,
    members,
    t,
    ...(replacement ? { replacement } : {}),
    balance: (account) => ledger.balance(db, account),
    payoutTo: async (name) => {
      const [p] = await db
        .select()
        .from(payouts)
        .where(sql`${payouts.userId} = ${memberId(name)} AND ${payouts.kind} = 'POT'`);
      expect(p?.status ?? 'SENT').toBe('SENT');
      return p?.amountFils;
    },
    holdbackReleasedTo: (name) =>
      one(
        sql`SELECT SUM(amount_fils)::text AS s FROM payouts WHERE user_id = ${memberId(name)} AND kind = 'HOLDBACK_RELEASE' AND status = 'SENT'`,
      ),
    refundTo: (name) =>
      one(
        sql`SELECT SUM(amount_fils)::text AS s FROM refunds WHERE user_id = ${memberId(name)} AND status = 'SENT'`,
      ),
  };
}

/** Replay in the pure engine and compare key balances. */
async function crossCheck(r: RunResult, sc: ApiScenario) {
  const store = r.t.get<CircleStore>(CircleStore);
  const { state } = await store.read(r.circleId);
  const seed = (
    await r.t.http.get(`/circles/${r.circleId}/draw`).set(r.members.get('A')!.auth).expect(200)
  ).body.revealedSeed as string;
  const core = runScenario({
    config: defaultConfig,
    circleId: r.circleId,
    monthly: kwd(100),
    seed,
    members: sc.members.map((m) => ({
      id: r.members.get(m.name)!.id,
      tier: m.tier,
      ...(m.bid ? { bid: { spot: m.bid.spot, amount: kwd(m.bid.amountKwd) } } : {}),
      ...(m.behavior ? { behavior: m.behavior } : {}),
    })),
    ...(sc.replacement && r.replacement
      ? {
          replacements: [
            {
              replaces: r.members.get(sc.replacement.replaces)!.id,
              memberId: r.replacement.id,
              tier: 2 as const,
              afterMonth: sc.replacement.afterMonth,
            },
          ],
        }
      : {}),
  });
  for (const account of [
    ACCOUNTS.revenue,
    ACCOUNTS.charity,
    ACCOUNTS.receivablesControl,
    ACCOUNTS.holdbacks,
    ACCOUNTS.refunds,
    ACCOUNTS.pot(r.circleId),
  ]) {
    expect(await r.balance(account), account).toBe(core.ledger.balance(account));
  }
  expect(state.stats).toEqual(core.state.stats);
  const db = r.t.get<DbService>(DbService).db;
  const totals = (await db.execute(sql`SELECT SUM(amount_fils)::text AS s FROM ledger_entries`))
    .rows[0] as { s: string };
  expect(BigInt(totals.s)).toBe(0n);
  await r.t.get<LedgerRepository>(LedgerRepository).assertBalanced(db);
}

describe.skipIf(!dbAvailable)('API lifecycle — organiser-model worked examples', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t?.close();
  });

  it('Example 1 — everyone pays', async () => {
    const sc: ApiScenario = { members: examples(), forceSpots: { B: 2, H: 8 } };
    const r = await runApi(t, sc);
    expect(await r.payoutTo('A')).toBe(kwd(755)); // 1,000 − 45 bid − 200 holdback
    expect(await r.payoutTo('B')).toBe(kwd(700)); // tier 0: 30% holdback
    expect(await r.payoutTo('H')).toBe(kwd(1000));
    expect(await r.holdbackReleasedTo('B')).toBe(kwd(300));
    expect(await r.balance(ACCOUNTS.revenue)).toBe(kwd(345)); // 300 organising fees + 45 bid
    const refundTotal = (await Promise.all(NAMES.map((n) => r.refundTo(n)))).reduce(
      (a, b) => a + b,
      0n,
    );
    expect(refundTotal).toBe(0n);
    // Trust profiles: everyone completed a circle; B (tier 0) moves up.
    const me = await t.http.get('/me').set(r.members.get('B')!.auth).expect(200);
    expect(me.body.trust).toMatchObject({ completedCircles: 1, tier: 1 });
    await crossCheck(r, sc);
  });

  it('Example 2 — post-payout default: holdback spread, B banned, legal case 800/500', async () => {
    const sc: ApiScenario = {
      members: examples({ B: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 2 } } }),
      forceSpots: { B: 2, H: 8 },
    };
    const r = await runApi(t, sc);
    expect(await r.payoutTo('B')).toBe(kwd(700));
    expect(await r.balance(ACCOUNTS.revenue)).toBe(kwd(345));
    expect(await r.balance(ACCOUNTS.receivablesControl)).toBe(kwd(500));
    const legal = (
      await t.http
        .get('/admin/legal/cases')
        .set(await adminAuth(t, ['legal']))
        .expect(200)
    ).body as {
      id: string;
      grossOwed: { fils: string };
      netClaim: { fils: string };
      userId: string;
    }[];
    expect(legal).toHaveLength(1);
    expect(legal[0]).toMatchObject({
      userId: r.members.get('B')!.id,
      grossOwed: { fils: String(kwd(800)) },
      netClaim: { fils: String(kwd(500)) },
    });
    const me = await t.http.get('/me').set(r.members.get('B')!.auth).expect(200);
    expect(me.body).toMatchObject({ status: 'BANNED', trust: { banned: true, defaults: 1 } });
    // Banned members cannot join again.
    const again = await t.http
      .post('/circles/queue')
      .set(r.members.get('B')!.auth)
      .set('Idempotency-Key', idemKey())
      .send({ monthlyKwd: 100 });
    expect(again.status).toBe(403);

    // Admin dashboard views over the same data (Phase 4).
    const sa = await adminAuth(t);
    const legalAdmin = await adminAuth(t, ['legal']);
    const ov = (await t.http.get('/admin/overview').set(sa).expect(200)).body;
    expect(ov).toMatchObject({
      openLegalCases: 1,
      failedDisbursements: 0,
      revenue: { total: { fils: String(kwd(345)) } },
      memberShortfall: { fils: String(kwd(500)) },
      openClaims: { fils: String(kwd(500)) },
    });
    expect(ov.monthlyVolume.fils).toMatch(/^\d+$/);
    const circle = (await t.http.get(`/admin/circles/${r.circleId}`).set(sa).expect(200)).body;
    expect(circle.roster).toHaveLength(10);
    expect(circle.schedule).toHaveLength(10);
    expect(circle.draw.revealedSeed).toMatch(/^[0-9a-f]+$/);
    expect(circle.ledger.length).toBeGreaterThan(10);
    const b = r.members.get('B')!;
    const member = (await t.http.get(`/admin/members/${b.id}`).set(sa).expect(200)).body;
    expect(member).toMatchObject({
      user: { status: 'BANNED' },
      tier: null,
      trust: { defaults: 1 },
    });
    expect(member.payments.length).toBeGreaterThan(0);
    const caseId = legal[0]!.id as string;
    const file = (await t.http.get(`/admin/legal/cases/${caseId}/file`).set(legalAdmin).expect(200))
      .body;
    expect(file.member.civilIdNumber).toMatch(/^\d{12}$/);
    expect(file.contract).not.toBeNull();
    expect(file.payouts[0]).toMatchObject({ kind: 'POT', status: 'SENT' });
    expect(file.schedule).toHaveLength(10);
    const audit = (await t.http.get('/admin/audit?action=legal.').set(sa).expect(200)).body;
    expect(audit.map((a: { action: string }) => a.action)).toContain('legal.case_file');
    // finance-only exports; legal cannot export, viewer cannot read case files
    const fin = await adminAuth(t, ['finance']);
    const csv = await t.http.get('/admin/export/ledger').set(fin).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toContain('seq,created_at,type');
    await t.http.get('/admin/export/ledger').set(legalAdmin).expect(403);
    const revenue = (await t.http.get('/admin/finance/revenue').set(fin).expect(200)).body;
    expect(revenue.rows).toHaveLength(1);
    // Sanad earns its fees either way; members bear what B's holdback did not cover.
    expect(revenue.rows[0]).toMatchObject({
      organizingFees: { fils: String(kwd(300)) },
      bidRevenue: { fils: String(kwd(45)) },
      revenue: { fils: String(kwd(345)) },
      holdbacksApplied: { fils: String(kwd(300)) },
      memberShortfall: { fils: String(kwd(500)) },
    });
    await t.http
      .get(`/admin/legal/cases/${caseId}/file`)
      .set(await adminAuth(t, ['viewer']))
      .expect(403);
    // Phase 5: addendum acknowledged by the member; case file as PDF and ZIP.
    const add = (await t.http.get(`/circles/${r.circleId}/addendum`).set(b.auth).expect(200)).body;
    expect(add).toMatchObject({ spot: 2, months: 10, acknowledged: false });
    expect(add.expectedPayout.fils).toBe(String(kwd(700)));
    await t.http
      .post(`/circles/${r.circleId}/addendum/ack`)
      .set(b.auth)
      .send({ documentHash: 'f'.repeat(64) })
      .expect(422);
    const acked = (
      await t.http
        .post(`/circles/${r.circleId}/addendum/ack`)
        .set(b.auth)
        .send({ documentHash: add.documentHash })
        .expect(200)
    ).body;
    expect(acked.acknowledged).toBe(true);
    const addPdf = await t.http
      .get(`/circles/${r.circleId}/addendum/pdf`)
      .set(b.auth)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((addPdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const casePdf = await t.http
      .get(`/admin/legal/cases/${caseId}/file.pdf`)
      .set(legalAdmin)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((casePdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const zip = await t.http
      .get(`/admin/legal/cases/${caseId}/file.zip`)
      .set(legalAdmin)
      .buffer(true)
      .parse(binary)
      .expect(200);
    const names = Object.keys(unzipSync(new Uint8Array(zip.body as Buffer)));
    expect(names).toEqual(
      expect.arrayContaining(['case-file.pdf', 'case-file.json', 'signed/sanad-contract-v1.pdf']),
    );
    expect(names.some((n) => n.startsWith('signed/sanad-addendum-'))).toBe(true);
    await crossCheck(r, sc);
  });

  it('Example 3 — pre-payout default: H refunded 400, revenue 345', async () => {
    const sc: ApiScenario = {
      members: examples({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }),
      forceSpots: { B: 2, H: 8 },
    };
    const r = await runApi(t, sc);
    expect(await r.payoutTo('H')).toBeUndefined();
    expect(await r.refundTo('H')).toBe(kwd(400));
    expect(await r.balance(ACCOUNTS.revenue)).toBe(kwd(345));
    // months 5–7 were paid 900 and then topped up from month 8's pot
    const db = t.get<DbService>(DbService).db;
    const topUps = await db.select().from(payouts).where(eq(payouts.kind, 'TOP_UP'));
    expect(topUps.map((p) => p.amountFils)).toEqual([kwd(100), kwd(100), kwd(100)]);
    expect(topUps.every((p) => p.status === 'SENT')).toBe(true);
    await crossCheck(r, sc);
  });

  it('Example 4 — replacement R takes spot 8 after month 6', async () => {
    const sc: ApiScenario = {
      members: examples({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }),
      forceSpots: { B: 2, H: 8 },
      replacement: { replaces: 'H', afterMonth: 6 },
    };
    const r = await runApi(t, sc);
    expect(await r.payoutTo('R')).toBe(kwd(1000));
    expect(await r.refundTo('H')).toBe(kwd(400));
    expect(await r.refundTo('R')).toBe(0n);
    expect(await r.balance(ACCOUNTS.revenue)).toBe(kwd(375)); // + 30 replacement fee
    await crossCheck(r, sc);
  });

  it('Example 5 — no bids: everything drawn, no priority revenue', async () => {
    const tiers: Record<string, 0 | 1 | 2> = {
      A: 0,
      B: 0,
      C: 0,
      D: 1,
      E: 1,
      F: 2,
      G: 2,
      H: 2,
      I: 2,
      J: 2,
    };
    const sc: ApiScenario = {
      members: NAMES.map((name) => ({ name, tier: tiers[name]! })),
      forceSpots: { A: 1, D: 3 },
    };
    const r = await runApi(t, sc);
    expect(await r.payoutTo('A')).toBe(kwd(700)); // tier 0 → 30% holdback
    expect(await r.payoutTo('D')).toBe(kwd(750)); // tier 1 → 25% holdback
    expect(await r.balance(ACCOUNTS.revenue)).toBe(kwd(300));
    await crossCheck(r, sc);
  });
});

describe.skipIf(!dbAvailable)('API lifecycle — forming, leaving, cancellation, webhooks', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    t.clock.set(kuwait('2027-01-03'));
  });
  afterEach(async () => {
    await t?.close();
  });

  it('leaving during FORMING refunds the organising fee in full', async () => {
    const m = await signUp(t, 'Leaver One');
    await pay(t, m, { monthlyKwd: 100 }, '/circles/queue');
    const list = (await t.http.get('/circles').set(m.auth).expect(200)).body as {
      id: string;
      joined: number;
    }[];
    expect(list[0]!.joined).toBe(1);
    await t.http.delete(`/circles/queue/${list[0]!.id}`).set(m.auth).expect(204);
    expect(await refundSum(t, m.id)).toBe(kwd(30));
    expect(t.gateway.transfers.filter((x) => x.kind === 'refund')).toHaveLength(1);
  });

  it('a circle that does not fill in 14 days is cancelled and refunded', async () => {
    const a = await signUp(t, 'Early Bird');
    const b = await signUp(t, 'Second Bird');
    await pay(t, a, { monthlyKwd: 50 }, '/circles/queue');
    await pay(t, b, { monthlyKwd: 50 }, '/circles/queue');
    t.clock.advance(15 * 86_400_000);
    const r = await t.get<SchedulerService>(SchedulerService).tick();
    expect(r.cancelled).toBe(1);
    expect(await refundSum(t, a.id)).toBe(kwd(15)); // 3% of a 500 KWD pot
    expect(await refundSum(t, b.id)).toBe(kwd(15));
  });

  it('tier 0 cannot join above 100 KWD; contract must be signed first', async () => {
    const m = await signUp(t, 'New Person');
    const r = await t.http
      .post('/circles/queue')
      .set(m.auth)
      .set('Idempotency-Key', idemKey())
      .send({ monthlyKwd: 250 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('AMOUNT_ABOVE_TIER');
    const unsigned = await signUp(t, 'No Signature', { sign: false });
    const u = await t.http
      .post('/circles/queue')
      .set(unsigned.auth)
      .set('Idempotency-Key', idemKey())
      .send({ monthlyKwd: 100 });
    expect(u.body.code).toBe('CONTRACT_NOT_SIGNED');
    const options = (await t.http.get('/circles/options').set(m.auth).expect(200)).body as {
      options: {
        monthly: { kwd: string };
        available: boolean;
        blockers: string[];
        organizingFee: { kwd: string };
      }[];
    };
    expect(options.options.map((o) => [o.monthly.kwd, o.available])).toEqual([
      ['50.000', true],
      ['100.000', true],
      ['250.000', false],
      ['500.000', false],
    ]);
    expect(options.options[1]!.organizingFee.kwd).toBe('30.000');
  });

  it('payment intents are idempotent and webhooks are verified and replay-safe', async () => {
    const m = await signUp(t, 'Careful Payer');
    const key = idemKey();
    const a = await t.http
      .post('/circles/queue')
      .set(m.auth)
      .set('Idempotency-Key', key)
      .send({ monthlyKwd: 100 })
      .expect(201);
    const b = await t.http
      .post('/circles/queue')
      .set(m.auth)
      .set('Idempotency-Key', key)
      .send({ monthlyKwd: 100 })
      .expect(201);
    expect(b.body.payment.id).toBe(a.body.payment.id);
    await t.http.post('/circles/queue').set(m.auth).send({ monthlyKwd: 100 }).expect(422);

    const id = a.body.payment.id as string;
    const event = {
      type: 'charge.succeeded' as const,
      eventId: 'evt1',
      providerRef: `mockch_${id}`,
      paymentId: id,
      amount: kwd(30),
      paidAt: t.clock.now().toISOString(),
    };
    const { body } = t.gateway.buildWebhook(event);
    await t.http
      .post('/payments/webhook')
      .set('content-type', 'application/json')
      .set('x-sanad-signature', 'bad')
      .send(body)
      .expect(401);
    const signed = t.gateway.buildWebhook(event);
    await t.http
      .post('/payments/webhook')
      .set('content-type', 'application/json')
      .set('x-sanad-signature', signed.signature)
      .send(signed.body)
      .expect(200);
    await t.http
      .post('/payments/webhook')
      .set('content-type', 'application/json')
      .set('x-sanad-signature', signed.signature)
      .send(signed.body)
      .expect(200);
    const list = (await t.http.get('/payments').set(m.auth).expect(200)).body as {
      status: string;
    }[];
    expect(list.map((p) => p.status)).toEqual(['APPLIED']);
    const circlesList = (await t.http.get('/circles').set(m.auth).expect(200)).body as unknown[];
    expect(circlesList).toHaveLength(1);
    const receipt = await t.http.get(`/payments/${id}/receipt`).set(m.auth).expect(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
  });
});

async function refundSum(t: TestApp, userId: string): Promise<Fils> {
  const db = t.get<DbService>(DbService).db;
  const rows = await db.select().from(refunds).where(eq(refunds.userId, userId));
  return rows.filter((r) => r.status === 'SENT').reduce((a, r) => a + r.amountFils, 0n);
}
