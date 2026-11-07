import { defaultConfig, type SanadConfig } from '@sanad/config';
import { describe, expect, it } from 'vitest';
import { kwd } from './money.js';
import {
  breakerRestrictions,
  fundRatioBps,
  minimumReserve,
  nextBreakerState,
  releasable,
} from './risk.js';
import {
  canBid,
  circleRules,
  completionRefundAmount,
  holdbackAmount,
  holdbackBps,
  isAllowedMonthly,
  minBidForSpot,
  payoutAmount,
  refundBpsForSpot,
  refundTable,
  tierConfig,
} from './rules.js';
import {
  addDays,
  addMonths,
  buildSchedule,
  daysBetween,
  dueDayFor,
  installmentStatus,
  kuwaitDate,
} from './schedule.js';
import { computeTier, joinBlockers, maxMonthlyForTier, type JoinRequest } from './tiers.js';

const cfg = defaultConfig;
const with_ = (mutate: (c: SanadConfig) => void): SanadConfig => {
  const c = structuredClone(cfg);
  mutate(c);
  return c;
};

describe('circle rules', () => {
  it('derives pot, entry fee, increment and late penalty', () => {
    expect(circleRules(cfg, kwd(100))).toEqual({
      n: 10,
      p: 3,
      monthly: kwd(100),
      pot: kwd(1000),
      entryFee: kwd(100),
      minIncrement: kwd(5),
      latePenalty: 0n,
    });
    expect(() => circleRules(cfg, 0n)).toThrow(/INVALID_MONTHLY/);
  });

  it('checks allowed amounts', () => {
    expect(isAllowedMonthly(cfg, kwd(250))).toBe(true);
    expect(isAllowedMonthly(cfg, kwd(75))).toBe(false);
  });

  it('minimum bids are 30/20/10% of M', () => {
    expect([1, 2, 3].map((s) => minBidForSpot(cfg, kwd(100), s))).toEqual([
      kwd(30),
      kwd(20),
      kwd(10),
    ]);
    expect(() => minBidForSpot(cfg, kwd(100), 4)).toThrow(/NOT_PRIORITY_SPOT/);
    const broken = with_((c) => (c.auction.minBidBpsBySpot = []));
    expect(() => minBidForSpot(broken, kwd(100), 1)).toThrow(/CONFIG/);
  });

  it('holdback applies only to priority spots, by tier', () => {
    expect(holdbackBps(cfg, 0, 1)).toBe(1_000n);
    expect(holdbackBps(cfg, 1, 3)).toBe(500n);
    expect(holdbackBps(cfg, 2, 2)).toBe(0n);
    expect(holdbackBps(cfg, 0, 4)).toBe(0n);
    expect(holdbackAmount(kwd(1000), 1_000n)).toBe(kwd(100));
    expect(() =>
      tierConfig(
        with_((c) => (c.risk.tiers = c.risk.tiers.slice(0, 1))),
        2,
      ),
    ).toThrow(/CONFIG/);
  });

  it('tier-0 bidding follows allowTier0Bidding', () => {
    expect(canBid(cfg, 0)).toBe(true);
    expect(
      canBid(
        with_((c) => (c.auction.allowTier0Bidding = false)),
        0,
      ),
    ).toBe(false);
    expect(canBid(cfg, 1)).toBe(true);
  });

  it('payout = pot − bid − holdback, never negative', () => {
    expect(payoutAmount(kwd(1000), kwd(45), 0n)).toBe(kwd(955));
    expect(payoutAmount(kwd(1000), 0n, kwd(100))).toBe(kwd(900));
    expect(() => payoutAmount(kwd(1000), kwd(950), kwd(100))).toThrow(/NEGATIVE_PAYOUT/);
  });

  it('refund table for N = 10 matches the spec', () => {
    expect(refundTable(cfg, 10)).toEqual([
      0n,
      0n,
      0n,
      0n,
      0n,
      5_000n,
      5_000n,
      10_000n,
      10_000n,
      10_000n,
    ]);
  });

  it('generic refund rule for other N: last ceil(30%) → 100%, ceil(20%) before → 50%', () => {
    const generic = with_((c) => (c.refunds.explicitTables = {}));
    expect(refundTable(generic, 10)).toEqual(refundTable(cfg, 10));
    expect(refundTable(generic, 4)).toEqual([0n, 5_000n, 10_000n, 10_000n]); // 2 full, 1 half
    expect(refundTable(generic, 12)).toEqual([
      0n,
      0n,
      0n,
      0n,
      0n,
      5_000n,
      5_000n,
      5_000n,
      10_000n,
      10_000n,
      10_000n,
      10_000n,
    ]);
    expect(() => refundBpsForSpot(cfg, 10, 11)).toThrow(/INVALID_SPOT/);
    const short = with_((c) => (c.refunds.explicitTables = { '10': [0] }));
    expect(() => refundBpsForSpot(short, 10, 5)).toThrow(/CONFIG/);
  });

  it('[SHARIAH] refund never exceeds the entry fee', () => {
    expect(completionRefundAmount(kwd(100), 5_000n)).toBe(kwd(50));
    expect(completionRefundAmount(101n, 5_000n)).toBe(50n); // rounds down; remainder stays in fund
    expect(() => completionRefundAmount(kwd(100), 10_001n)).toThrow(/REFUND_EXCEEDS_FEE/);
  });
});

describe('trust tiers & join eligibility', () => {
  const clean = { completedCircles: 0, latePayments: 0, defaults: 0, banned: false };
  it('computes tiers', () => {
    expect(computeTier(cfg, clean)).toEqual({ kind: 'tier', tier: 0 });
    expect(computeTier(cfg, { ...clean, completedCircles: 1, latePayments: 2 })).toEqual({
      kind: 'tier',
      tier: 1,
    });
    expect(computeTier(cfg, { ...clean, completedCircles: 1, latePayments: 3 })).toEqual({
      kind: 'tier',
      tier: 0,
    });
    expect(computeTier(cfg, { ...clean, completedCircles: 2, latePayments: 9 })).toEqual({
      kind: 'tier',
      tier: 2,
    });
    expect(computeTier(cfg, { ...clean, defaults: 1, completedCircles: 5 })).toEqual({
      kind: 'banned',
    });
    expect(computeTier(cfg, { ...clean, banned: true })).toEqual({ kind: 'banned' });
    expect(maxMonthlyForTier(cfg, 1)).toBe(kwd(250));
  });

  const base: JoinRequest = {
    profile: clean,
    monthly: kwd(100),
    activeCircles: 0,
    identityVerified: true,
    contractSigned: true,
    civilIdExpiry: '2030-01-01',
    today: '2027-01-01',
    circuitBreakerTripped: false,
  };

  it('allows a verified tier-0 member at 100 KWD', () => {
    expect(joinBlockers(cfg, base)).toEqual([]);
  });

  it('lists every blocker', () => {
    expect(
      joinBlockers(cfg, {
        ...base,
        profile: { ...clean, banned: true },
        identityVerified: false,
        contractSigned: false,
        civilIdExpiry: '2026-12-31',
        monthly: kwd(75),
        activeCircles: 2,
        circuitBreakerTripped: true,
      }),
    ).toEqual([
      'BANNED',
      'IDENTITY_NOT_VERIFIED',
      'CONTRACT_NOT_SIGNED',
      'CIVIL_ID_EXPIRED',
      'AMOUNT_NOT_OFFERED',
      'TOO_MANY_ACTIVE_CIRCLES',
    ]);
    expect(joinBlockers(cfg, { ...base, monthly: kwd(250), circuitBreakerTripped: true })).toEqual([
      'AMOUNT_ABOVE_TIER',
      'PAUSED_BY_CIRCUIT_BREAKER',
    ]);
  });
});

describe('schedule (Asia/Kuwait dates)', () => {
  it('date helpers', () => {
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01');
    expect(addMonths('2027-11-15', 3)).toBe('2028-02-15');
    expect(() => addMonths('2027-01-31', 1)).toThrow(/day ≤ 28/);
    expect(daysBetween('2027-01-01', '2027-01-16')).toBe(15);
    expect(() => addDays('2027/01/01', 1)).toThrow(/INVALID_DATE/);
    // 22:30 UTC on Jan 1 is already Jan 2 in Kuwait (UTC+3)
    expect(kuwaitDate(new Date('2027-01-01T22:30:00Z'))).toBe('2027-01-02');
  });

  it('due day = start day capped at 28', () => {
    expect(dueDayFor(cfg, '2027-01-31')).toBe(28);
    expect(dueDayFor(cfg, '2027-01-09')).toBe(9);
  });

  it('builds N rows with grace, payout and default dates', () => {
    const rows = buildSchedule(cfg, '2027-01-30', 10);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({
      month: 1,
      dueDate: '2027-01-28',
      graceEndsOn: '2027-01-31',
      payoutDate: '2027-02-02',
      defaultsOn: '2027-02-12',
    });
    expect(rows[9]?.dueDate).toBe('2027-10-28');
  });

  it('installment status', () => {
    const row = buildSchedule(cfg, '2027-01-10', 1)[0]!;
    expect(installmentStatus(row, '2027-01-09')).toBe('UPCOMING');
    expect(installmentStatus(row, '2027-01-10')).toBe('DUE');
    expect(installmentStatus(row, '2027-01-13')).toBe('DUE');
    expect(installmentStatus(row, '2027-01-14')).toBe('LATE');
    expect(installmentStatus(row, '2027-01-25')).toBe('DEFAULTED');
    expect(installmentStatus(row, '2027-01-30', '2027-01-13')).toBe('PAID');
    expect(installmentStatus(row, '2027-01-30', '2027-01-20')).toBe('PAID_LATE');
  });
});

describe('risk controls', () => {
  it('fund ratio', () => {
    expect(fundRatioBps(kwd(250), kwd(1000))).toBe(2_500n);
    expect(fundRatioBps(kwd(100), 0n)).toBeNull();
    expect(fundRatioBps(-5n, kwd(10))).toBe(0n);
  });

  it('minimum reserve = max(5,000 KWD, 25% × exposure)', () => {
    expect(minimumReserve(cfg, kwd(1000))).toBe(kwd(5000));
    expect(minimumReserve(cfg, kwd(100_000))).toBe(kwd(25_000));
    expect(minimumReserve(cfg, -1n)).toBe(kwd(5000));
  });

  it('circuit breaker trips below 25% and resumes at 35%', () => {
    expect(nextBreakerState(cfg, 'NORMAL', 2_499n)).toBe('TRIPPED');
    expect(nextBreakerState(cfg, 'NORMAL', 2_500n)).toBe('NORMAL');
    expect(nextBreakerState(cfg, 'TRIPPED', 3_000n)).toBe('TRIPPED');
    expect(nextBreakerState(cfg, 'TRIPPED', 3_500n)).toBe('NORMAL');
    expect(nextBreakerState(cfg, 'TRIPPED', null)).toBe('NORMAL');
    expect(breakerRestrictions(cfg, 'TRIPPED')).toEqual({
      priorityAuctionsPaused: true,
      maxNewCircleMonthly: kwd(100),
      alertRoles: ['super_admin', 'finance'],
    });
    expect(breakerRestrictions(cfg, 'NORMAL').priorityAuctionsPaused).toBe(false);
  });

  it('release never takes the fund below the reserve', () => {
    expect(releasable(kwd(600), kwd(10_000), kwd(5_000))).toEqual({
      release: kwd(600),
      blocked: 0n,
    });
    expect(releasable(kwd(600), kwd(5_200), kwd(5_000))).toEqual({
      release: kwd(200),
      blocked: kwd(400),
    });
    expect(releasable(kwd(600), kwd(4_000), kwd(5_000))).toEqual({
      release: 0n,
      blocked: kwd(600),
    });
    expect(releasable(0n, kwd(10_000), kwd(5_000))).toEqual({ release: 0n, blocked: 0n });
  });
});
