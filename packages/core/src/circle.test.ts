import { defaultConfig, type SanadConfig } from '@sanad/config';
import { describe, expect, it } from 'vitest';
import {
  amountOwed,
  applyCircleEvent,
  canReplace,
  circleRevenue,
  circleShortfall,
  createCircle,
  monthCredits,
  openClaim,
  replacementCost,
  type CircleEffect,
  type CircleEvent,
  type CircleState,
} from './circle.js';
import { commitmentFor } from './draw.js';
import { ACCOUNTS, Ledger } from './ledger.js';
import { kwd } from './money.js';
import { fixtureSeed } from './scenario.js';

const cfg = defaultConfig;
const SEED = fixtureSeed('circle-test');
const START = '2027-01-01T09:00:00.000Z';
const AFTER = '2027-01-05T09:00:00.000Z';
const IDS = ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10'];
const POT = 'circle_pot:c1';

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
  start(): this {
    return this.apply({ type: 'AUCTION_STARTED', at: START, commitment: commitmentFor(SEED) });
  }
  toActive(opts: { bids?: [string, number, number][]; tiers?: Record<string, 0 | 1 | 2> } = {}) {
    this.fill(opts.tiers).start();
    for (const [memberId, spot, amount] of opts.bids ?? []) {
      this.apply({
        type: 'BID_PLACED',
        memberId,
        spot,
        amount: kwd(amount),
        at: '2027-01-01T10:00:00.000Z',
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
  member(id: string) {
    return this.state.members.find((m) => m.memberId === id)!;
  }
  pay(memberId: string, month: number, late = false): this {
    return this.apply({ type: 'CONTRIBUTION_PAID', memberId, month, late });
  }
  payAll(month: number, except: string[] = []): this {
    for (const sl of this.state.slots) {
      const id = sl.holderId;
      const active = this.state.members.find((m) => m.memberId === id)?.status === 'ACTIVE';
      if (id && active && !except.includes(id) && sl.months[month] === undefined)
        this.pay(id, month);
    }
    return this;
  }
  month(k: number, except: string[] = []): this {
    return this.payAll(k, except).apply({ type: 'PAYOUT_DUE', month: k });
  }
  months(from: number, to: number, except: string[] = []): this {
    for (let k = from; k <= to; k += 1) this.month(k, except);
    return this;
  }
  close(): this {
    return this.apply({ type: 'CLOSE' });
  }
  /** Money sent to a member through the gateway (payouts, top-ups, released holdbacks). */
  received(memberId: string, types = ['PAYOUT', 'TOP_UP']): bigint {
    return this.ledger
      .transactions()
      .filter((t) => types.includes(t.type) && t.memberId === memberId)
      .reduce(
        (a, t) => a - (t.entries.find((e) => e.account === ACCOUNTS.gateway)?.amount ?? 0n),
        0n,
      );
  }
  effectsOf(kind: CircleEffect['kind']) {
    return this.effects.filter((e) => e.kind === kind);
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

  it('holds the 3% organising fee, refunds leavers, rejects duplicates and overflow', () => {
    const h = new Harness().fill();
    expect(h.ledger.balance(ACCOUNTS.feesHeld('c1'))).toBe(kwd(300));
    expect(h.member('m01').feePaid).toBe(kwd(30));
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
    expect(h.ledger.balance(ACCOUNTS.feesHeld('c1'))).toBe(kwd(270));
    expect(() => h.apply({ type: 'MEMBER_LEFT', memberId: 'm01' })).toThrow(/not queued/);
    expect(() => h.apply({ type: 'MEMBER_LEFT', memberId: 'nobody' })).toThrow(/UNKNOWN_MEMBER/);
    expect(() => h.start()).toThrow(/NOT_FULL/);
    h.apply({ type: 'MEMBER_JOINED', memberId: 'm11', tier: 1 });
    expect(() => h.apply({ type: 'AUCTION_STARTED', at: START, commitment: 'nope' })).toThrow(
      /INVALID_COMMITMENT/,
    );
  });

  it('cancellation refunds every queued member (FORMING or AUCTION only)', () => {
    const h = new Harness().fill().apply({ type: 'CANCELLED' });
    expect(h.state.status).toBe('CANCELLED');
    expect(h.ledger.balance(ACCOUNTS.feesHeld('c1'))).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.gateway)).toBe(0n);
    const a = new Harness().fill().apply({ type: 'MEMBER_LEFT', memberId: 'm03' });
    a.apply({ type: 'MEMBER_JOINED', memberId: 'm11', tier: 2 }).start();
    a.apply({ type: 'CANCELLED' });
    expect(a.ledger.balance(ACCOUNTS.feesHeld('c1'))).toBe(0n);
    expect(a.state.status).toBe('CANCELLED');
    expect(() => new Harness().toActive().apply({ type: 'CANCELLED' })).toThrow(/INVALID_STATE/);
  });
});

describe('circle: AUCTION & DRAW', () => {
  it('assigns auction winners their spots, draws the rest, and earns the organising fees', () => {
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
    expect(h.ledger.balance(ACCOUNTS.feesHeld('c1'))).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(300));
    expect(h.state.stats.organizingFees).toBe(kwd(300));
    expect(h.state.seed).toBe(SEED);
  });

  it('enforces eligibility, timing and the commitment', () => {
    const noTier0 = structuredClone(cfg);
    noTier0.auction.allowTier0Bidding = false;
    const h = new Harness(noTier0).fill({ m01: 0 }).start();
    expect(() =>
      h.apply({ type: 'BID_PLACED', memberId: 'm01', spot: 1, amount: kwd(30), at: START }),
    ).toThrow(/NOT_ELIGIBLE/);
    expect(() => h.apply({ type: 'MEMBER_LEFT', memberId: 'm02' })).toThrow(/INVALID_STATE/);
    expect(() => h.apply({ type: 'AUCTION_CLOSED', at: '2027-01-02T00:00:00.000Z' })).toThrow(
      /AUCTION_OPEN/,
    );
    h.apply({ type: 'AUCTION_CLOSED', at: AFTER });
    expect(() => h.apply({ type: 'DRAW_EXECUTED', seed: fixtureSeed('other') })).toThrow(
      /COMMITMENT_MISMATCH/,
    );
  });
});

describe('circle: a clean circle', () => {
  it('pays each recipient pot − bid − holdback, releases holdbacks at closing, earns fees + bids', () => {
    const h = new Harness().toActive({ bids: [['m05', 1, 45]] }).months(1, 10);
    expect(h.state.status).toBe('CLOSING');
    // spot 1: 1,000 − 45 bid − 200 holdback (tier 2 = 20% of the pot)
    expect(h.member('m05').payoutAmount).toBe(kwd(755));
    expect(h.member(h.holder(2)).payoutAmount).toBe(kwd(800));
    expect(h.member(h.holder(4)).payoutAmount).toBe(kwd(1000));
    expect(h.ledger.balance(ACCOUNTS.holdbacks)).toBe(kwd(600));
    h.close();
    expect(h.state.status).toBe('CLOSED');
    expect(h.ledger.balance(ACCOUNTS.holdbacks)).toBe(0n);
    expect(h.ledger.balance(POT)).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(345));
    expect(circleRevenue(h.state.stats)).toBe(kwd(345));
    expect(h.received('m05', ['PAYOUT', 'TOP_UP', 'HOLDBACK_RELEASED'])).toBe(kwd(955));
    const closed = h.effectsOf('CIRCLE_CLOSED')[0];
    expect(closed?.kind === 'CIRCLE_CLOSED' && closed.summary).toMatchObject({
      organizingFees: kwd(300),
      bidRevenue: kwd(45),
      revenue: kwd(345),
      holdbacksReleased: kwd(600),
      shortfall: 0n,
    });
    h.ledger.assertBalanced();
  });
});

describe('circle: late money', () => {
  it('pays out what was collected, then forwards the late payment as a top-up', () => {
    const c = structuredClone(cfg);
    c.contributions.latePenaltyBps = 200;
    const h = new Harness(c).toActive();
    const late = h.holder(6);
    h.month(1, [late]);
    expect(h.state.slots.find((s) => s.spot === 6)?.months[1]).toEqual({ state: 'LATE' });
    expect(h.member(h.holder(1)).payoutAmount).toBe(kwd(700)); // 900 collected − 200 holdback
    expect(amountOwed(h.state, late)).toBe(kwd(100));
    h.pay(late, 1, true);
    expect(h.effectsOf('TOP_UP_SENT')).toEqual([
      { kind: 'TOP_UP_SENT', memberId: h.holder(1), month: 1, amount: kwd(100) },
    ]);
    expect(h.member(h.holder(1)).payoutAmount).toBe(kwd(800));
    expect(h.ledger.balance(ACCOUNTS.charity)).toBe(kwd(2)); // penalty → charity, never revenue
    expect(h.member(late).latePayments).toBe(1);
    expect(amountOwed(h.state, late)).toBe(0n);
  });

  it('takes the bid and holdback from the first money in when a month is short', () => {
    const h = new Harness().toActive({ bids: [['m05', 1, 600]] });
    const others = IDS.filter((x) => x !== 'm05');
    // Only the recipient pays month 1: 100 collected, all of it goes to the 600 bid.
    h.month(1, others);
    expect(h.member('m05').payoutAmount).toBe(0n);
    expect(h.effectsOf('PAYOUT_SENT')).toHaveLength(0);
    for (const id of others.slice(0, 6)) h.pay(id, 1, true);
    // 600 more: 500 finish the bid, 100 start the 200 holdback.
    expect(h.state.monthRecords[1]).toMatchObject({ bidTaken: kwd(600), holdbackTaken: kwd(100) });
    expect(h.member('m05').payoutAmount).toBe(0n);
    for (const id of others.slice(6)) h.pay(id, 1, true);
    // 300 more: 100 finishes the holdback, then 100 + 100 reach the recipient.
    expect(h.effectsOf('PAYOUT_SENT')).toEqual([
      { kind: 'PAYOUT_SENT', memberId: 'm05', month: 1, amount: kwd(100) },
    ]);
    expect(h.member('m05').payoutAmount).toBe(kwd(200));
    expect(monthCredits(h.state, 1)).toBe(kwd(1000));
  });

  it('holds the recipient’s payout until they pay their own month', () => {
    const h = new Harness().toActive();
    const r = h.holder(2);
    h.month(1).month(2, [r]);
    expect(h.effectsOf('PAYOUT_HELD')).toEqual([{ kind: 'PAYOUT_HELD', memberId: r, month: 2 }]);
    expect(h.state.heldPayouts).toEqual([2]);
    h.pay(r, 2, true);
    expect(h.state.heldPayouts).toEqual([]);
    expect(h.member(r).payoutAmount).toBe(kwd(800));
  });

  it('accepts payment in advance and refuses paying twice or out of range', () => {
    const h = new Harness().toActive();
    const id = h.holder(9);
    h.pay(id, 4);
    expect(() => h.pay(id, 4)).toThrow(/ALREADY_PAID/);
    expect(() => h.pay(id, 11)).toThrow(/INVALID_MONTH/);
    expect(() => h.apply({ type: 'PAYOUT_DUE', month: 2 })).toThrow(/OUT_OF_ORDER/);
    h.months(1, 4);
    expect(h.member(h.holder(4)).payoutAmount).toBe(kwd(1000));
  });

  it('refuses to close while an active member still owes a month', () => {
    const h = new Harness().toActive();
    const late = h.holder(7);
    h.months(1, 9).month(10, [late]);
    expect(h.state.status).toBe('CLOSING');
    expect(() => h.close()).toThrow(/MEMBER_UNRESOLVED/);
    h.pay(late, 10, true).close();
    expect(h.state.status).toBe('CLOSED');
  });
});

describe('circle: default after payout (no guarantee)', () => {
  it('spreads the holdback over the months owed, opens a claim, and members bear the rest', () => {
    const h = new Harness().toActive();
    const d = h.holder(1);
    h.month(1).month(2, [d]);
    expect(h.member(h.holder(2)).payoutAmount).toBe(kwd(700)); // 900 − 200 holdback
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    const m = h.member(d);
    expect(m.status).toBe('DEFAULTED_POST_PAYOUT');
    expect(m.claimGross).toBe(kwd(900)); // months 2..10
    expect(m.holdbackApplied).toBe(kwd(200));
    expect(openClaim(m)).toBe(kwd(700));
    expect(amountOwed(h.state, d)).toBe(kwd(700));
    expect(h.effectsOf('LEGAL_CASE_OPENED')).toEqual([
      {
        kind: 'LEGAL_CASE_OPENED',
        memberId: d,
        grossOwed: kwd(900),
        holdbackApplied: kwd(200),
        netClaim: kwd(700),
      },
    ]);
    expect(h.effectsOf('MEMBER_BANNED')).toHaveLength(1);
    // 200,000 fils over 9 months: 22,223 for months 2–3, 22,222 for the rest.
    const cells = h.state.slots.find((s) => s.spot === 1)!.months;
    expect(cells[2]).toEqual({ state: 'COVERED', covered: 22_223n, source: 'HOLDBACK' });
    expect(cells[10]).toEqual({ state: 'COVERED', covered: 22_222n, source: 'HOLDBACK' });
    // month 2 was already paid out → its share is forwarded straight away
    expect(h.member(h.holder(2)).payoutAmount).toBe(kwd(700) + 22_223n);
    expect(h.ledger.balance(ACCOUNTS.receivable(d))).toBe(kwd(700));
    expect(() => h.pay(d, 3)).toThrow(/INVALID_STATE/);

    h.months(3, 10).close();
    expect(h.ledger.balance(POT)).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.holdbacks)).toBe(0n);
    expect(circleShortfall(h.state)).toBe(kwd(700));
    expect(h.member(h.holder(5)).payoutAmount).toBe(kwd(900) + 22_222n);

    // Legal recovery after closing: 10% fee to Sanad, 90% forwarded to the affected months.
    h.apply({ type: 'RECOVERY', memberId: d, amount: kwd(500), reference: 'court-1' });
    expect(h.state.stats.recoveryFees).toBe(kwd(50));
    expect(openClaim(h.member(d))).toBe(kwd(200));
    expect(circleShortfall(h.state)).toBe(kwd(250));
    expect(h.member(h.holder(5)).payoutAmount).toBe(kwd(950) + 22_222n);
    expect(h.ledger.balance(ACCOUNTS.receivable(d))).toBe(kwd(200));
    expect(h.ledger.balance(POT)).toBe(0n);
    expect(() =>
      h.apply({ type: 'RECOVERY', memberId: d, amount: kwd(201), reference: 'court-2' }),
    ).toThrow(/INVALID_AMOUNT/);
    expect(() =>
      h.apply({ type: 'RECOVERY', memberId: h.holder(3), amount: kwd(1), reference: 'x' }),
    ).toThrow(/INVALID_STATE/);
    h.ledger.assertBalanced();
  });

  it('refunds holdback beyond what is owed', () => {
    // Spot 3 tier 0 (30% = 300) defaulting at month 10 owes only one month (100).
    const h = new Harness();
    h.toActive({ tiers: Object.fromEntries(IDS.map((id) => [id, 0])) });
    const d = h.holder(3);
    h.months(1, 9).month(10, [d]);
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(h.member(d).holdbackApplied).toBe(kwd(100));
    expect(h.member(d).refundDue).toBe(kwd(200));
    expect(openClaim(h.member(d))).toBe(0n);
    expect(h.effectsOf('REFUND_DUE')).toEqual([
      { kind: 'REFUND_DUE', memberId: d, amount: kwd(200), reason: 'EXCESS_HOLDBACK' },
    ]);
    h.close();
    expect(circleShortfall(h.state)).toBe(0n);
    expect(h.ledger.balance(POT)).toBe(0n);
  });

  it('late money for a defaulter’s own month pays down their debt instead of reaching them', () => {
    const h = new Harness().toActive();
    const d = h.holder(1);
    const x = h.holder(6);
    h.month(1, [x]).month(2, [d]);
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(openClaim(h.member(d))).toBe(kwd(700));
    h.pay(x, 1, true);
    expect(h.member(d).payoutAmount).toBe(kwd(700));
    expect(openClaim(h.member(d))).toBe(kwd(600));
    expect(h.ledger.balance(ACCOUNTS.receivable(d))).toBe(kwd(600));
    h.months(3, 10).close();
    expect(h.ledger.balance(POT)).toBe(0n);
    h.ledger.assertBalanced();
  });

  it('rejects a default with nothing overdue', () => {
    const h = new Harness().toActive().month(1);
    expect(() => h.apply({ type: 'MEMBER_DEFAULTED', memberId: h.holder(4) })).toThrow(
      /NOTHING_OVERDUE/,
    );
  });
});

describe('circle: default before payout', () => {
  it('the vacant spot’s own pot repairs the months it missed, then refunds the defaulter', () => {
    const c = structuredClone(cfg);
    c.defaults.prePayoutDefaultPenaltyBps = 1_000;
    const h = new Harness(c).toActive();
    const d = h.holder(8);
    h.months(1, 3).month(4, [d]);
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(h.member(d).status).toBe('DEFAULTED_PRE_PAYOUT');
    expect(h.effectsOf('SPOT_VACATED')).toEqual([
      { kind: 'SPOT_VACATED', spot: 8, memberId: d, replaceableUntilMonthsSettled: 6 },
    ]);
    h.months(5, 7);
    // months 4–7 were paid out 100 short
    expect(h.member(h.holder(4)).payoutAmount).toBe(kwd(900));
    expect(circleShortfall(h.state)).toBe(kwd(600)); // months 4,5,6,7,9,10
    h.month(8); // nobody receives: 900 collected
    expect(h.member(h.holder(4)).payoutAmount).toBe(kwd(1000));
    expect(h.member(h.holder(7)).payoutAmount).toBe(kwd(1000));
    // 400 forwarded, 200 kept for months 9–10, 300 = the defaulter's own 3 months
    expect(h.member(d).refundDue).toBe(kwd(270));
    expect(h.ledger.balance(ACCOUNTS.charity)).toBe(kwd(30));
    h.months(9, 10);
    expect(h.member(h.holder(9)).payoutAmount).toBe(kwd(1000));
    expect(circleShortfall(h.state)).toBe(0n);
    h.close();
    expect(h.ledger.balance(POT)).toBe(0n);
    expect(() =>
      h.apply({ type: 'REFUND_PAID', memberId: d, amount: kwd(271), reference: 'r1' }),
    ).toThrow(/INVALID_AMOUNT/);
    h.apply({ type: 'REFUND_PAID', memberId: d, amount: kwd(70), reference: 'r1' });
    h.apply({ type: 'REFUND_PAID', memberId: d });
    expect(h.ledger.balance(ACCOUNTS.refunds)).toBe(0n);
    expect(() => h.apply({ type: 'REFUND_PAID', memberId: d })).toThrow(/NOTHING_DUE/);
    h.ledger.assertBalanced();
  });

  it('a recipient who never pays their own month: the month is distributed when they default', () => {
    const h = new Harness().toActive();
    const d = h.holder(5);
    h.months(1, 4).month(5, [d]);
    expect(h.state.heldPayouts).toEqual([5]);
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(h.state.heldPayouts).toEqual([]);
    expect(h.member(d).refundDue).toBe(kwd(400)); // 900 − 500 kept for months 6–10
    expect(h.state.monthRecords[5]?.recipientId).toBeNull();
    h.months(6, 10).close();
    expect(circleShortfall(h.state)).toBe(0n);
    expect(h.ledger.balance(POT)).toBe(0n);
  });

  it('a member who prepaid their own month can still default before payout; a 100% penalty refunds nothing', () => {
    const c = structuredClone(cfg);
    c.defaults.prePayoutDefaultPenaltyBps = 10_000;
    const h = new Harness(c).toActive();
    const d = h.holder(9);
    h.pay(d, 9).month(1, [d]);
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(h.state.slots.find((s) => s.spot === 9)?.months[9]).toEqual({ state: 'PAID' });
    h.months(2, 10).close();
    expect(h.member(d).refundDue).toBe(0n);
    expect(h.effectsOf('REFUND_DUE')).toHaveLength(0);
    expect(h.ledger.balance(ACCOUNTS.charity)).toBe(kwd(100));
    expect(circleShortfall(h.state)).toBe(0n);
  });

  it('ban after a pre-payout default is configurable', () => {
    const c = structuredClone(cfg);
    c.defaults.banOnPrePayoutDefault = false;
    const h = new Harness(c).toActive();
    const d = h.holder(8);
    h.month(1, [d]).apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(h.effectsOf('MEMBER_BANNED')).toHaveLength(0);
  });
});

describe('circle: replacement', () => {
  it('replacement pays catch-up + 3% fee; the defaulter is bought out; short months are topped up', () => {
    const h = new Harness().toActive();
    const d = h.holder(8);
    h.months(1, 3).month(4, [d]);
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(canReplace(h.state, cfg, 8)).toBe(true);
    expect(replacementCost(h.state, cfg, 8)).toEqual({
      catchUp: kwd(400),
      fee: kwd(30),
      months: 4,
    });
    h.apply({ type: 'REPLACEMENT_JOINED', memberId: 'r01', tier: 1, spot: 8 });
    expect(h.holder(8)).toBe('r01');
    expect(h.member('r01')).toMatchObject({ isReplacement: true, replacesMemberId: d });
    expect(h.member(d).refundDue).toBe(kwd(300));
    expect(h.member(h.holder(4)).payoutAmount).toBe(kwd(1000));
    expect(h.state.stats.replacementFees).toBe(kwd(30));
    h.months(5, 10).close();
    expect(h.member('r01').payoutAmount).toBe(kwd(1000));
    expect(h.member('r01').contributionsPaid).toBe(kwd(1000));
    expect(circleShortfall(h.state)).toBe(0n);
    expect(h.ledger.balance(POT)).toBe(0n);
    expect(h.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(330));
    h.ledger.assertBalanced();
  });

  it('enforces vacancy, cutoff and uniqueness', () => {
    const h = new Harness().toActive();
    const d = h.holder(5);
    h.months(1, 2).month(3, [d]);
    expect(canReplace(h.state, cfg, 5)).toBe(false); // not vacant yet
    h.apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(() =>
      h.apply({ type: 'REPLACEMENT_JOINED', memberId: 'm02', tier: 1, spot: 5 }),
    ).toThrow(/ALREADY_JOINED/);
    h.month(4);
    expect(canReplace(h.state, cfg, 5)).toBe(false); // only 1 month before its payout
    expect(() =>
      h.apply({ type: 'REPLACEMENT_JOINED', memberId: 'r01', tier: 1, spot: 5 }),
    ).toThrow(/REPLACEMENT_CLOSED/);
  });
});

describe('circle: state guards', () => {
  it('queries handle unknown members and spots; references are validated', () => {
    const h = new Harness().toActive();
    expect(amountOwed(h.state, 'nobody')).toBe(0n);
    expect(() => replacementCost(h.state, cfg, 11)).toThrow(/INVALID_SPOT/);
    const d = h.holder(1);
    h.month(1).month(2, [d]).apply({ type: 'MEMBER_DEFAULTED', memberId: d });
    expect(() =>
      h.apply({ type: 'RECOVERY', memberId: d, amount: kwd(1), reference: 'bad ref' }),
    ).toThrow(/INVALID_ID/);
    expect(amountOwed(h.state, h.holder(3))).toBe(0n);
  });

  it('rejects events in the wrong state', () => {
    const h = new Harness().fill();
    expect(() => h.apply({ type: 'PAYOUT_DUE', month: 1 })).toThrow(/INVALID_STATE/);
    expect(() => h.close()).toThrow(/INVALID_STATE/);
    expect(() => h.apply({ type: 'DRAW_EXECUTED', seed: SEED })).toThrow(/INVALID_STATE/);
    expect(() => h.apply({ type: 'REFUND_PAID', memberId: 'm01' })).toThrow(/NOTHING_DUE/);
  });
});
