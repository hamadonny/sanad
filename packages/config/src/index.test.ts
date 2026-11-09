import { describe, expect, it } from 'vitest';
import {
  defaultConfig,
  diffConfig,
  parseConfig,
  validateConfig,
  type SanadConfig,
} from './index.js';

const clone = (): SanadConfig => structuredClone(defaultConfig);

function issuesFor(mutate: (c: SanadConfig) => void): string[] {
  const c = clone();
  mutate(c);
  const r = validateConfig(c);
  return r.ok ? [] : r.issues;
}

describe('config schema', () => {
  it('accepts the launch defaults', () => {
    expect(parseConfig(defaultConfig)).toEqual(defaultConfig);
    expect(validateConfig(defaultConfig).ok).toBe(true);
  });

  it('launch defaults match the founding model (D-017)', () => {
    expect(defaultConfig.schemaVersion).toBe(2);
    expect(defaultConfig.organizingFee.ofPotBps).toBe(300);
    expect(defaultConfig.auction.allowTier0Bidding).toBe(true);
    expect(defaultConfig.auction.minBidBpsBySpot).toEqual([3_000, 2_000, 1_000]);
    expect(defaultConfig.risk.tiers.map((t) => t.holdbackBps)).toEqual([3_000, 2_500, 2_000]);
    expect(defaultConfig.fees).toEqual({
      replacementOfPotBps: 300,
      recoveryOfRecoveredBps: 1_000,
      spotExchangeOfPotBps: 100,
      fastPayoutKwd: 2,
      privateCircleSetupKwd: 5,
      companySeatKwd: 1,
    });
    expect(defaultConfig.defaults.prePayoutDefaultPenaltyDestination).toBe('charity');
  });

  it('rejects N outside 4..24', () => {
    expect(issuesFor((c) => (c.circle.membersPerCircle = 3)).length).toBeGreaterThan(0);
    expect(issuesFor((c) => (c.circle.membersPerCircle = 25)).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'prioritySpots',
      (c: SanadConfig) => (
        (c.circle.prioritySpots = 10),
        (c.auction.minBidBpsBySpot = Array(10).fill(100))
      ),
    ],
    ['minBidBpsBySpot', (c: SanadConfig) => (c.auction.minBidBpsBySpot = [3_000])],
    ['gracePeriodDays', (c: SanadConfig) => (c.contributions.gracePeriodDays = 15)],
    ['payoutOffsetDays', (c: SanadConfig) => (c.circle.payoutOffsetDays = 20)],
    ['ofPotBps', (c: SanadConfig) => (c.organizingFee.ofPotBps = 0)],
    ['minBidBpsBySpot', (c: SanadConfig) => (c.risk.tiers[0]!.holdbackBps = 10_000)],
    ['tiers', (c: SanadConfig) => (c.risk.tiers[1]!.tier = 2)],
    ['allowedMonthlyAmountsKwd', (c: SanadConfig) => c.circle.allowedMonthlyAmountsKwd.push(1000)],
  ])('rejects an invalid %s', (path, mutate) => {
    const issues = issuesFor(mutate);
    expect(issues.join('\n')).toContain(path);
  });

  it('penalties can only go to charity', () => {
    expect(
      issuesFor((c) => ((c.defaults as { prePayoutDefaultPenaltyDestination: string }).prePayoutDefaultPenaltyDestination = 'revenue')).length,
    ).toBeGreaterThan(0);
  });

  it('parseConfig throws on invalid input', () => {
    expect(() => parseConfig({})).toThrow();
  });
});

describe('diffConfig', () => {
  it('lists leaf changes only', () => {
    const next = clone();
    next.contributions.gracePeriodDays = 5;
    next.circle.allowedMonthlyAmountsKwd = [100];
    expect(diffConfig(defaultConfig, next)).toEqual([
      { path: 'circle.allowedMonthlyAmountsKwd', before: [50, 100, 250, 500], after: [100] },
      { path: 'contributions.gracePeriodDays', before: 3, after: 5 },
    ]);
    expect(diffConfig(defaultConfig, clone())).toEqual([]);
    expect(diffConfig(1, 2)).toEqual([{ path: '(root)', before: 1, after: 2 }]);
  });
});
