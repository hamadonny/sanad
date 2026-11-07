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

  it('launch defaults match the spec', () => {
    expect(defaultConfig.auction.allowTier0Bidding).toBe(true);
    expect(defaultConfig.auction.minBidBpsBySpot).toEqual([3_000, 2_000, 1_000]);
    expect(defaultConfig.refunds.explicitTables['10']).toEqual([
      0, 0, 0, 0, 0, 5_000, 5_000, 10_000, 10_000, 10_000,
    ]);
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
    ['refunds', (c: SanadConfig) => (c.refunds.fullRefundSpotShareBps = 9_000)],
    ['explicitTables', (c: SanadConfig) => (c.refunds.explicitTables['10'] = [0, 10_000])],
    ['resumeFundRatioBps', (c: SanadConfig) => (c.risk.resumeFundRatioBps = 100)],
    ['tiers', (c: SanadConfig) => (c.risk.tiers[1]!.tier = 2)],
    ['allowedMonthlyAmountsKwd', (c: SanadConfig) => c.circle.allowedMonthlyAmountsKwd.push(1000)],
  ])('rejects an invalid %s', (path, mutate) => {
    const issues = issuesFor(mutate);
    expect(issues.join('\n')).toContain(path);
  });

  it('rejects a refund above 100% of the entry fee', () => {
    expect(issuesFor((c) => (c.refunds.explicitTables['10']![9] = 10_001)).length).toBeGreaterThan(
      0,
    );
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
