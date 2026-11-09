import { defaultConfig, type SanadConfig } from '@sanad/config';
import { describe, expect, it } from 'vitest';
import { kwd } from './money.js';
import {
  canBid,
  circleRules,
  holdbackAmount,
  holdbackBps,
  isAllowedMonthly,
  minBidForSpot,
  payoutAmount,
  recoveryFee,
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
  it('derives pot, organising fee (3% of pot), replacement fee, increment and late penalty', () => {
    expect(circleRules(cfg, kwd(100))).toEqual({
      n: 10,
      p: 3,
      monthly: kwd(100),
      pot: kwd(1000),
      organizingFee: kwd(30),
      replacementFee: kwd(30),
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
    expect(holdbackBps(cfg, 0, 1)).toBe(3_000n);
    expect(holdbackBps(cfg, 1, 3)).toBe(2_500n);
    expect(holdbackBps(cfg, 2, 2)).toBe(2_000n);
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

  it('[SHARIAH] recovery fee is 10% of what is recovered, rounded down', () => {
    expect(recoveryFee(cfg, kwd(500))).toBe(kwd(50));
    expect(recoveryFee(cfg, 9n)).toBe(0n);
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
      }),
    ).toEqual([
      'BANNED',
      'IDENTITY_NOT_VERIFIED',
      'CONTRACT_NOT_SIGNED',
      'CIVIL_ID_EXPIRED',
      'AMOUNT_NOT_OFFERED',
      'TOO_MANY_ACTIVE_CIRCLES',
    ]);
    expect(joinBlockers(cfg, { ...base, monthly: kwd(250) })).toEqual(['AMOUNT_ABOVE_TIER']);
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
      dueDate: '2027-02-28',
      graceEndsOn: '2027-03-03',
      payoutDate: '2027-03-05',
      defaultsOn: '2027-03-15',
    });
    expect(rows[9]?.dueDate).toBe('2027-11-28');
    expect(buildSchedule(cfg, '2027-01-09', 2)[0]?.dueDate).toBe('2027-01-09');
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
