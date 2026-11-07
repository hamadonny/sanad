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
  tierMix: [0, 0, 1], // tier 2: no holdbacks
  postPayoutDefaultRate: d,
  prePayoutDefaultRate: 0,
  latePaymentRate: 0,
  recoveryRate: 0,
  bidRate: 0,
  initialFundKwd: 1_000_000,
});

describe('Monte Carlo simulation', () => {
  it('sanity: N=10, M=100, immediate post-payout default rate d, 0% recovery → loss ≈ d × 4,500 KWD', () => {
    const d = 0.2;
    const s = simulate(sanity(d));
    expect(s.meanLossPerCircleKwd).toBeGreaterThan(d * 4_500 * 0.9);
    expect(s.meanLossPerCircleKwd).toBeLessThan(d * 4_500 * 1.1);
  }, 60_000);

  it('no defaults → no losses; revenue = released entry fees (600 per 100-KWD circle)', () => {
    const s = simulate({ ...sanity(0), runs: 2, circles: 3 });
    expect(s.meanLossPerCircleKwd).toBe(0);
    expect(s.meanRevenuePerCircleKwd).toBe(600);
    expect(s.probabilityFundBelowReserve).toBe(0);
    expect(s.fundRatioOverTime.length).toBe(12);
  });

  it('runs the default mix with bids, late payments, pre-payout defaults and recoveries', () => {
    const p = {
      ...defaultSimulationParams(defaultConfig),
      runs: 3,
      circles: 6,
      postPayoutDefaultRate: [0.3, 0.3, 0.3],
      prePayoutDefaultRate: 0.2,
      initialFundKwd: 0,
    };
    const run = simulateRun(p, 0);
    expect(run.circlesClosed).toBe(6);
    expect(run.series.length).toBe(15);
    expect(run.everBelowReserve).toBe(true); // starts with an empty fund, below the 5,000 KWD floor
    const s = simulate(p);
    expect(s.runs).toBe(3);
    expect(Number.isFinite(s.meanRevenuePerCircleKwd)).toBe(true);
  });

  it('a stressed pool trips the circuit breaker', () => {
    const p = {
      ...defaultSimulationParams(defaultConfig),
      runs: 1,
      circles: 8,
      postPayoutDefaultRate: 0.9,
      initialFundKwd: 0,
      recoveryRate: 0,
    };
    expect(simulateRun(p, 0).breakerTrippedMonths).toBeGreaterThan(0);
  });

  it('PRNG is deterministic', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
