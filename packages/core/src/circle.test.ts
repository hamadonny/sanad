import { defaultConfig, type SanadConfig } from '@sanad/config';
import { describe, expect, it } from 'vitest';
import {
  amountOwed,
  applyCircleEvent,
  canReplace,
  circleExposure,
  createCircle,
  type CircleEffect,
  type CircleEvent,
  type CircleState,
} from './circle.js';
import { commitmentFor } from './draw.js';
import { ACCOUNTS, Ledger } from './ledger.js';
import { kwd } from './money.js';
import { fixtureSeed, runScenario, type ScenarioMember } from './scenario.js';

const cfg = defaultConfig;
const SEED = fixtureSeed('circle-test');
const START = '2027-01-01T09:00:00.000Z';
const AFTER = '2027-01-05T09:00:00.000Z';
const IDS = ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10'];

class Harness {
  state: CircleState;
  ledger = new Ledger();
  effects: CircleEffect[] = [];
  constructor(
    readonly config: SanadConfig = cfg,
    monthly = kwd(100),
  ) {
    this.state = createCircle(config, { circleId: 'c1', configVersion: 1, monthly });
  }
  apply(e: CircleEvent): this {
    const r = applyCircleEvent(this.state, e, this.config);
    this.ledger.postAll(r.transactions);
    this.effects.push(...r.effects);
    this.state = r.state;
    return this;
  }
  fill(tiers: Record<string, 0 | 1 | 2> = {}): this {
    for (const id of IDS) this.apply({ type: 'MEMBER_JOINED', memberId: id, tier: tiers[id] ?? 2 });
    return this;
  }
  toActive(opts: { paused?: boolean; bids?: [string, number, number][] } = {}): this {
    this.fill().apply({
      type: 'AUCTION_STARTED',
      at: START,
      commitment: commitmentFor(SEED),
      priorityAuctionsPaused: opts.paused ?? false,
    });
    for (const [memberId, spot, amount] of opts.bids ?? []) {
      this.apply({
        type: 'BID_PLACED',
        memberId,
        spot,
        amount: kwd(amount),
        at: '2027-01-01T10:00:00.000Z',
        priorityAuctionsPaused: false,
      });
    }
    return this.apply({ type: 'AUCTION_CLOSED', at: AFTER }).apply({
      type: 'DRAW_EXECUTED',
      seed: SEED,
    });
  }
  holder(spot: number): string {
    return this.state.slots.find((s) => s.spot === spot)?.holderId as string;
  }
  payAll(month: number, except: string[] = []): this {
    for (const sl of this.state.slots) {
      const id = sl.holderId;
      const active = this.state.members.find((m) => m.memberId === id)?.status === 'ACTIVE';
      if (id && active && !except.includes(id) && sl.months[month] === undefined)
        this.apply({ type: 'CONTRIBUTION_PAID', memberId: id, month, late: false });
    }
    return this;
  }
  month(k: number, except: string[] = []): this {
    return this.payAll(k, except).apply({ type: 'PAYOUT_DUE', month: k });
  }
  close(pool = kwd(50_000), reserve = kwd(5_000)): this {
    return this.apply({
      type: 'CLOSE',
      poolFundBalance: pool + this.ledger.balance(ACCOUNTS.fund),
      minimumReserve: reserve,
    });
  }
}

describe('circle: FORMING', () => {
  it('validates creation', () => {
    expect(() =>
      createCircle(cfg, { circleId: 'bad id', configVersion: 1, monthly: kwd(100) }),
    ).toThrow(/INVALID_ID/);
    expect(() => createCircle(cfg, { circleId: 'c', configVersion: 1, monthly: kwd(75) })).toThrow(
      /AMOUNT_NOT_OFFERED/,
    );
  });

  it('holds entry fees, refunds leavers, rejects duplicates and overflow', () => {
    const h = new Harness().fill();
    expect(h.ledger.balance(ACCOUNTS.entryFeesHeld('c1'))).toBe(kwd(1000));
    expect(() => h.apply({ type: 'MEMBER_JOINED', memberId: 'm01', tier: 0 })).toThrow(
      /ALREADY_JOINED/,
    );
    expect(() => h.apply({ type: 'MEMBER_JOINED', memberId: 'm11', tier: 0 })).toThrow(
      /CIRCLE_FULL/,
    );
    expect(() => h.apply({ type: 'MEMBER_JOINED', memberId: 'x y', tier: 0 })).toThrow(
      /INVALID_ID/,
    );
    h.apply({ type: 'MEMBER_LEFT', memberId: 'm01' });
    expect(h.ledger.balance(ACCOUNTS.entryFeesHeld('c1'))).toBe(kwd(900));
    expect(() => h.apply({ type: 'MEMBER_LEFT', memberId: 'm01' })).toThrow(/not queued/);
    expect(() => h.apply({ type: 'MEMBER_LEFT', memberId: 'nobody' })).toThrow(/UNKNOWN_MEMBER/);
    expect(() =>
      h.apply({
        type: 'AUCTION_STARTED',
        at: START,
        commitment: commitmentFor(SEED),
        priorityAuctionsPaused: false,
      }),
    ).toThrow(/NOT_FULL/);
    h.apply({ type: 'MEMBER_JOINED', memberId: 'm11', tier: 1 });
    expect(() =>
      h.apply({
        type: 'AUCTION_STARTED',
        at: START,
        commitment: 'nope',
        priorityAuctionsPaused: false,
      }),
    ).toThrow(/INVALID_COMMITMENT/);
  });

  it('cancellation refunds every queued member (FORMING or AUCTION only)', () => {
    const h = new Harness().fill().apply({ type: 'CANCELLED' });
    expect(h.state.status).toBe('CANCELLED');
    expect(h.ledger.balance(ACCOUNTS.entryFeesHeld('c1'))).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.gateway)).toBe(0n);
    const a = new Harness().fill().apply({
      type: 'AUCTION_STARTED',
      at: START,
      commitment: commitmentFor(SEED),
      priorityAuctionsPaused: false,
    });
    a.apply({ type: 'CANCELLED' });
    expect(a.state.status).toBe('CANCELLED');
    expect(() => new Harness().toActive().apply({ type: 'CANCELLED' })).toThrow(/INVALID_STATE/);
  });
});

describe('circle: AUCTION & DRAW', () => {
  it('assigns auction winners their spots and draws the rest', () => {
    const h = new Harness().toActive({
      bids: [
        ['m05', 1, 45],
        ['m07', 2, 20],
      ],
    });
    expect(h.holder(1)).toBe('m05');
    expect(h.holder(2)).toBe('m07');
    expect(new Set(h.state.slots.map((s) => s.holderId)).size).toBe(10);
    expect(h.state.status).toBe('ACTIVE');
    expect(h.ledger.balance(ACCOUNTS.fund)).toBe(kwd(1000));
    expect(h.state.seed).toBe(SEED);
  });

  it('enforces eligibility, pause, timing and the commitment', () => {
    const noTier0 = structuredClone(cfg);
    noTier0.auction.allowTier0Bidding = false;
    const h = new Harness(noTier0).fill({ m01: 0 }).apply({
      type: 'AUCTION_STARTED',
      at: START,
      commitment: commitmentFor(SEED),
      priorityAuctionsPaused: false,
    });
    const bid = (memberId: string, paused = false) => ({
      type: 'BID_PLACED' as const,
      memberId,
      spot: 1,
      amount: kwd(30),
      at: '2027-01-01T10:00:00.000Z',
      priorityAuctionsPaused: paused,
    });
    expect(() => h.apply(bid('m01'))).toThrow(/NOT_ELIGIBLE/);
    expect(() => h.apply(bid('m02', true))).toThrow(/AUCTIONS_PAUSED/);
    expect(() => h.apply({ type: 'AUCTION_CLOSED', at: '2027-01-02T00:00:00.000Z' })).toThrow(
      /AUCTION_OPEN/,
    );
    h.apply({ type: 'AUCTION_CLOSED', at: AFTER });
    expect(() => h.apply({ type: 'DRAW_EXECUTED', seed: fixtureSeed('other') })).toThrow(
      /COMMITMENT_MISMATCH/,
    );
  });

  it('a breaker-paused auction has no priority spots: everything is drawn', () => {
    const h = new Harness().toActive({ paused: true });
    expect(h.state.auction?.spots).toEqual([]);
    expect(h.state.winners).toEqual([]);
  });

  it('rejects members leaving after FORMING', () => {
    const h = new Harness().fill().apply({
      type: 'AUCTION_STARTED',
      at: START,
      commitment: commitmentFor(SEED),
      priorityAuctionsPaused: false,
    });
    expect(() => h.apply({ type: 'MEMBER_LEFT', memberId: 'm01' })).toThrow(/INVALID_STATE/);
  });
});

describe('circle: ACTIVE', () => {
  it('validates contributions and payout order', () => {
    const h = new Harness().toActive();
    const id = h.holder(3);
    expect(() =>
      h.apply({ type: 'CONTRIBUTION_PAID', memberId: id, month: 11, late: false }),
    ).toThrow(/INVALID_MONTH/);
    h.apply({ type: 'CONTRIBUTION_PAID', memberId: id, month: 1, late: false });
    expect(() =>
      h.apply({ type: 'CONTRIBUTION_PAID', memberId: id, month: 1, late: false }),
    ).toThrow(/ALREADY_PAID/);
    expect(() => h.apply({ type: 'PAYOUT_DUE', month: 2 })).toThrow(/OUT_OF_ORDER/);
  });

  it('accepts payment in advance', () => {
    const h = new Harness().toActive();
    const id = h.holder(9);
    h.apply({ type: 'CONTRIBUTION_PAID', memberId: id, month: 4, late: false });
    h.month(1).month(2).month(3).month(4);
    expect(h.ledger.transactions().filter((t) => t.type === 'FUND_ADVANCE')).toHaveLength(0);
  });

  it('late payer repays the fund advance; late penalty goes to charity, never revenue', () => {
    const c = structuredClone(cfg);
    c.contributions.latePenaltyBps = 200;
    const h = new Harness(c).toActive();
    const late = h.holder(5);
    h.month(1, [late]);
    expect(amountOwed(h.state, late)).toBe(kwd(100));
    expect(h.ledger.balance(ACCOUNTS.receivable(late))).toBe(kwd(100));
    h.apply({ type: 'CONTRIBUTION_PAID', memberId: late, month: 1, late: true });
    expect(amountOwed(h.state, late)).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.receivable(late))).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.charity)).toBe(kwd(2));
    expect(h.ledger.balance(ACCOUNTS.revenue)).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.fund)).toBe(kwd(1000));
  });

  it('holds the receiver’s payout until they pay their own month', () => {
    const h = new Harness().toActive();
    const r1 = h.holder(1);
    h.month(1, [r1]);
    expect(h.effects).toContainEqual({ kind: 'PAYOUT_HELD', memberId: r1, month: 1 });
    expect(h.state.heldPayouts).toEqual([1]);
    h.apply({ type: 'CONTRIBUTION_PAID', memberId: r1, month: 1, late: true });
    expect(h.state.heldPayouts).toEqual([]);
    expect(h.effects).toContainEqual({
      kind: 'PAYOUT_SENT',
      memberId: r1,
      month: 1,
      amount: kwd(1000),
    });
  });

  it('a receiver who never pays their own month defaults pre-payout; the pot returns to the fund', () => {
    const h = new Harness().toActive();
    const r3 = h.holder(3);
    h.month(1).month(2).month(3, [r3]);
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: r3 });
    expect(h.state.heldPayouts).toEqual([]);
    expect(
      h.ledger
        .transactions()
        .find((t) => t.type === 'POT_RETURNED')
        ?.entries.find((e) => e.account === ACCOUNTS.fund)?.amount,
    ).toBe(-kwd(900));
  });

  it('rejects a default with nothing overdue and payments from defaulters', () => {
    const h = new Harness().toActive();
    expect(() => h.apply({ type: 'MEMBER_DEFAULTED', memberId: h.holder(4) })).toThrow(
      /NOTHING_OVERDUE/,
    );
    const d = h.holder(6);
    h.month(1, [d]).apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(() =>
      h.apply({ type: 'CONTRIBUTION_PAID', memberId: d, month: 2, late: false }),
    ).toThrow(/cannot pay/);
    expect(() => h.apply({ type: 'MEMBER_DEFAULTED', memberId: d })).toThrow(/INVALID_STATE/);
    expect(() =>
      h.apply({ type: 'CONTRIBUTION_PAID', memberId: 'ghost', month: 2, late: false }),
    ).toThrow(/UNKNOWN_MEMBER/);
  });

  it('exposure counts unpaid future months of members already paid out', () => {
    const h = new Harness().toActive();
    expect(circleExposure(h.state)).toBe(0n);
    h.month(1);
    expect(circleExposure(h.state)).toBe(kwd(900));
    h.month(2);
    expect(circleExposure(h.state)).toBe(kwd(1600));
  });
});

describe('circle: replacement', () => {
  it('enforces vacancy, cutoff and uniqueness', () => {
    const h = new Harness().toActive();
    const d = h.holder(4);
    expect(canReplace(h.state, cfg, 4)).toBe(false);
    expect(() => h.apply({ type: 'REPLACEMENT_JOINED', memberId: 'r1', tier: 2, spot: 4 })).toThrow(
      /REPLACEMENT_CLOSED/,
    );
    h.month(1, [d]).apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(canReplace(h.state, cfg, 4)).toBe(true);
    h.month(2);
    expect(canReplace(h.state, cfg, 4)).toBe(true); // 4 − 2 = 2 ≥ cutoff
    h.month(3);
    expect(canReplace(h.state, cfg, 4)).toBe(false);
    expect(() =>
      h.apply({ type: 'REPLACEMENT_JOINED', memberId: h.holder(5), tier: 2, spot: 4 }),
    ).toThrow(/ALREADY_JOINED/);
    expect(() =>
      h.apply({ type: 'REPLACEMENT_JOINED', memberId: 'bad id', tier: 2, spot: 4 }),
    ).toThrow(/INVALID_ID/);
  });

  it('catch-up includes months the defaulter prepaid, so the replacement pays N × M in total', () => {
    const h = new Harness().toActive();
    const d = h.holder(7);
    h.apply({ type: 'CONTRIBUTION_PAID', memberId: d, month: 5, late: false }); // prepaid
    h.month(1, [d]).apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    h.month(2).apply({ type: 'REPLACEMENT_JOINED', memberId: 'rep', tier: 0, spot: 7 });
    const catchUp = h.ledger
      .transactions()
      .find((t) => t.memberId === 'rep' && t.type === 'CONTRIBUTION_PAID');
    expect(catchUp?.entries.find((e) => e.account === ACCOUNTS.gateway)?.amount).toBe(kwd(300)); // months 1, 2 and prepaid 5
    for (let k = 3; k <= 10; k += 1) h.month(k);
    h.close();
    const rep = h.state.members.find((m) => m.memberId === 'rep');
    expect(rep?.contributionsPaid).toBe(kwd(1000));
    h.ledger.assertBalanced();
  });
});

describe('circle: CLOSING', () => {
  it('refuses to close with unsettled months or unresolved debtors', () => {
    const h = new Harness().toActive();
    for (let k = 1; k <= 9; k += 1) h.month(k);
    const late = h.holder(3);
    h.month(10, [late]);
    expect(h.state.status).toBe('CLOSING');
    expect(() => h.close()).toThrow(/MEMBER_UNRESOLVED/);
    h.apply({ type: 'CONTRIBUTION_PAID', memberId: late, month: 10, late: true });
    h.close();
    expect(h.state.status).toBe('CLOSED');
  });

  it('too many late payments forfeit the completion refund (holdback still released)', () => {
    const h = new Harness().toActive();
    const lateMember = h.holder(9);
    for (let k = 1; k <= 10; k += 1) {
      h.month(k, k <= 3 ? [lateMember] : []);
      if (k <= 3)
        h.apply({ type: 'CONTRIBUTION_PAID', memberId: lateMember, month: k, late: true });
    }
    h.close();
    expect(h.state.members.find((m) => m.memberId === lateMember)?.refundDue).toBe(0n);
    expect(h.state.members.find((m) => m.memberId === h.holder(10))?.refundDue).toBe(kwd(100));
  });

  it('blocks a release that would breach the reserve, then retries', () => {
    const h = new Harness().toActive();
    for (let k = 1; k <= 10; k += 1) h.month(k);
    h.apply({ type: 'CLOSE', poolFundBalance: kwd(5_600), minimumReserve: kwd(5_000) });
    expect(h.state.stats.released).toBe(kwd(200));
    expect(h.state.stats.pendingRelease).toBe(kwd(400));
    expect(h.effects).toContainEqual({ kind: 'RELEASE_BLOCKED', amount: kwd(400) });
    h.apply({ type: 'RELEASE_RETRY', poolFundBalance: kwd(5_300), minimumReserve: kwd(5_000) });
    expect(h.state.stats.pendingRelease).toBe(kwd(100));
    h.apply({ type: 'RELEASE_RETRY', poolFundBalance: kwd(9_000), minimumReserve: kwd(5_000) });
    expect(h.state.stats.pendingRelease).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(600));
    expect(() =>
      h.apply({ type: 'RELEASE_RETRY', poolFundBalance: kwd(9_000), minimumReserve: 0n }),
    ).toThrow(/NOTHING_PENDING/);
  });

  it('pays refunds once', () => {
    const h = new Harness().toActive();
    for (let k = 1; k <= 10; k += 1) h.month(k);
    h.close();
    const id = h.holder(10);
    h.apply({ type: 'REFUND_PAID', memberId: id });
    expect(() => h.apply({ type: 'REFUND_PAID', memberId: id })).toThrow(/NOTHING_DUE/);
    expect(() => h.apply({ type: 'REFUND_PAID', memberId: h.holder(1) })).toThrow(/NOTHING_DUE/);
  });
});

describe('circle: defaults configuration', () => {
  const members = (stopper: string): ScenarioMember[] =>
    IDS.map((id) => ({
      id,
      tier: 2,
      ...(id === stopper ? { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 1 } as const } : {}),
    }));

  it('pre-payout penalty can go to charity or stay in the fund; ban is configurable', () => {
    for (const destination of ['charity', 'fund'] as const) {
      const c = structuredClone(cfg);
      c.defaults.prePayoutDefaultPenaltyBps = 1_000;
      c.defaults.prePayoutDefaultPenaltyDestination = destination;
      c.defaults.banOnPrePayoutDefault = false;
      const seed = fixtureSeed('penalty');
      const probe = runScenario({
        config: c,
        circleId: 'p1',
        monthly: kwd(100),
        members: members('none'),
        seed,
      });
      const lastSpot = probe.state.members.find((m) => m.spot === 10)?.memberId as string;
      const r = runScenario({
        config: c,
        circleId: 'p1',
        monthly: kwd(100),
        members: members(lastSpot),
        seed,
        otherPoolBalance: kwd(50_000),
      });
      const d = r.state.members.find((m) => m.memberId === lastSpot);
      expect(d?.status).toBe('DEFAULTED_PRE_PAYOUT');
      expect(d?.refundDue).toBe(kwd(90)); // paid 100, 10% penalty
      expect(r.ledger.balance(ACCOUNTS.charity)).toBe(destination === 'charity' ? kwd(10) : 0n);
      expect(r.effects.some((e) => e.kind === 'MEMBER_BANNED')).toBe(false);
      r.ledger.assertBalanced();
    }
  });

  it('recoveries: before closing reduce the claim; are capped at the open claim; only for post-payout defaulters', () => {
    const h = new Harness().toActive();
    const r1 = h.holder(1);
    h.month(1).month(2, [r1]).apply({ type: 'MEMBER_DEFAULTED', memberId: r1 });
    expect(() =>
      h.apply({ type: 'RECOVERY', memberId: h.holder(5), amount: kwd(1), reference: 'x' }),
    ).toThrow(/post-payout/);
    h.apply({ type: 'RECOVERY', memberId: r1, amount: kwd(250), reference: 'court-1' });
    expect(h.ledger.balance(ACCOUNTS.receivable(r1))).toBe(-kwd(150)); // 100 advanced − 250 recovered (claim continues to accrue)
    expect(() =>
      h.apply({ type: 'RECOVERY', memberId: r1, amount: kwd(700), reference: 'court-2' }),
    ).toThrow(/INVALID_AMOUNT/);
    for (let k = 3; k <= 10; k += 1) h.month(k);
    h.close();
    expect(h.ledger.balance(ACCOUNTS.receivable(r1))).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.losses)).toBe(kwd(650)); // 900 owed − 250 recovered
    h.ledger.assertBalanced();
  });

  it('rejects events in the wrong state', () => {
    const h = new Harness();
    expect(() => h.apply({ type: 'PAYOUT_DUE', month: 1 })).toThrow(/INVALID_STATE/);
    expect(() => h.apply({ type: 'CLOSE', poolFundBalance: 0n, minimumReserve: 0n })).toThrow(
      /INVALID_STATE/,
    );
    expect(() => h.apply({ type: 'DRAW_EXECUTED', seed: SEED })).toThrow(/INVALID_STATE/);
    expect(() => h.apply({ type: 'AUCTION_CLOSED', at: AFTER })).toThrow(/INVALID_STATE/);
    expect(() =>
      h.apply({
        type: 'BID_PLACED',
        memberId: 'm01',
        spot: 1,
        amount: 1n,
        at: AFTER,
        priorityAuctionsPaused: false,
      }),
    ).toThrow(/INVALID_STATE/);
  });
});
