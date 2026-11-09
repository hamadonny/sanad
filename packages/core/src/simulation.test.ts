import { defaultConfig } from '@sanad/config';
import { describe, expect, it } from 'vitest';
import {
  defaultSimulationParams,
  mulberry32,
  simulate,
  simulateRun,
  type SimulationParams,
} from './simulation.js';

const sanity = (d: number): SimulationParams => ({
  ...defaultSimulationParams(defaultConfig),
  runs: 60,
  circles: 10,
  monthlyMix: { 100: 1 },
  tierMix: [0, 0, 1], // tier 2: 20% holdback on spots 1–3
  postPayoutDefaultRate: d,
  prePayoutDefaultRate: 0,
  latePaymentRate: 0,
  recoveryRate: 0,
  bidRate: 0,
});

describe('Monte Carlo simulation (organiser model)', () => {
  it('sanity: N=10, M=100, post-payout default rate d, no recovery → shortfall ≈ d × 3,900 KWD', () => {
    // Spot s owes (10 − s) × 100; spots 1–3 lose 200 KWD of holdback first:
    // 700 + 600 + 500 + 600 + 500 + 400 + 300 + 200 + 100 = 3,900.
    const d = 0.2;
    const s = simulate(sanity(d));
    expect(s.meanShortfallPerCircleKwd).toBeGreaterThan(d * 3_900 * 0.85);
    expect(s.meanShortfallPerCircleKwd).toBeLessThan(d * 3_900 * 1.15);
  }, 60_000);

  it('no defaults → no shortfall; revenue = organising fees (300 per 100-KWD circle)', () => {
    const s = simulate({ ...sanity(0), runs: 2, circles: 3 });
    expect(s.meanShortfallPerCircleKwd).toBe(0);
    expect(s.probabilityCircleHasShortfall).toBe(0);
    expect(s.meanRevenuePerCircleKwd).toBe(300);
  });

  it('recoveries shrink the shortfall', () => {
    const none = simulate({ ...sanity(0.3), runs: 10 });
    const half = simulate({ ...sanity(0.3), runs: 10, recoveryRate: 0.5 });
    expect(half.meanShortfallPerCircleKwd).toBeLessThan(none.meanShortfallPerCircleKwd);
    // Sanad earns the 10% recovery fee on top of the organising fees.
    expect(half.meanRevenuePerCircleKwd).toBeGreaterThan(none.meanRevenuePerCircleKwd);
  }, 60_000);

  it('runs the default mix with bids, late payments, pre-payout defaults and recoveries', () => {
    const p = {
      ...defaultSimulationParams(defaultConfig),
      runs: 3,
      circles: 6,
      postPayoutDefaultRate: [0.3, 0.3, 0.3],
      prePayoutDefaultRate: 0.2,
    };
    const run = simulateRun(p, 0);
    expect(run.circlesClosed).toBe(6);
    expect(run.paidOut).toBeGreaterThan(0n);
    const s = simulate(p);
    expect(s.runs).toBe(3);
    expect(Number.isFinite(s.meanRevenuePerCircleKwd)).toBe(true);
    expect(s.shortfallShareOfPayoutsPct).toBeGreaterThanOrEqual(0);
  });

  it('PRNG is deterministic', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
