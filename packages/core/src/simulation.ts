/**
 * Monte Carlo simulation of a pool of circles sharing one Guarantee Fund (spec §5.15).
 *
 * Each run starts `circles` circles (one every `startEveryMonths`), samples member behaviour
 * after the draw, and drives every circle month by month through the real engine against one
 * shared ledger. Closings use the live pool balance and minimum reserve, so blocked releases
 * and the circuit breaker behave as in production.
 *
 * Randomness here only decides *behaviour* (who defaults, who is late). Money is still integer
 * fils computed by the engine.
 */
import type { SanadConfig } from '@sanad/config';
import { circleExposure, type CircleState } from './circle.js';
import { ACCOUNTS, Ledger } from './ledger.js';
import { kwd, type Fils } from './money.js';
import { fundRatioBps, minimumReserve, nextBreakerState, type BreakerState } from './risk.js';
import type { Tier } from './rules.js';
import { CircleDriver, fixtureSeed, type Behavior, type ScenarioMember } from './scenario.js';

export interface SimulationParams {
  config: SanadConfig;
  runs: number;
  circles: number;
  startEveryMonths: number;
  /** Weights per monthly amount in whole KWD, e.g. { 100: 3, 250: 1 }. */
  monthlyMix: Readonly<Record<number, number>>;
  /** Weights for tiers 0, 1, 2. */
  tierMix: readonly [number, number, number];
  /**
   * Probability a member defaults right after receiving their payout. A single number applies
   * to every spot; an array gives one value per spot (index 0 = spot 1).
   */
  postPayoutDefaultRate: number | readonly number[];
  /** Probability a member defaults before their payout (at a uniformly random earlier month). */
  prePayoutDefaultRate: number;
  /** Probability any single contribution is paid late (but within the default threshold). */
  latePaymentRate: number;
  /** Share of a defaulter's open claim recovered after closing (0..1). */
  recoveryRate: number;
  /** Probability each priority spot receives one bid at the minimum. */
  bidRate: number;
  initialFundKwd: number;
  seed: number;
}

export const defaultSimulationParams = (config: SanadConfig): SimulationParams => ({
  config,
  runs: 200,
  circles: 24,
  startEveryMonths: 1,
  monthlyMix: { 50: 2, 100: 4, 250: 1 },
  tierMix: [6, 3, 1],
  postPayoutDefaultRate: 0.02,
  prePayoutDefaultRate: 0.01,
  latePaymentRate: 0.05,
  recoveryRate: 0.3,
  bidRate: 0.6,
  initialFundKwd: 10_000,
  seed: 42,
});

export interface MonthPoint {
  month: number;
  fund: Fils;
  exposure: Fils;
  reserve: Fils;
  ratioBps: bigint | null;
}

export interface RunResult {
  revenue: Fils;
  losses: Fils;
  circlesClosed: number;
  everBelowReserve: boolean;
  breakerTrippedMonths: number;
  series: MonthPoint[];
}

export interface SimulationSummary {
  runs: number;
  circlesPerRun: number;
  meanRevenuePerCircleKwd: number;
  meanLossPerCircleKwd: number;
  probabilityFundBelowReserve: number;
  meanBreakerTrippedMonths: number;
  /** Median and 5th percentile fund ratio (%) per month across runs; null = no exposure. */
  fundRatioOverTime: { month: number; medianPct: number | null; p5Pct: number | null }[];
}

/** Small, fast, seedable PRNG (mulberry32). Not for security — behaviour sampling only. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pickWeighted<T>(rand: () => number, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = rand() * total;
  for (const [item, w] of items) {
    x -= w;
    if (x < 0) return item;
  }
  return (items[items.length - 1] as readonly [T, number])[0];
}

const rateForSpot = (rate: number | readonly number[], spot: number): number =>
  typeof rate === 'number' ? rate : (rate[spot - 1] ?? 0);

function sampleBehavior(
  p: SimulationParams,
  rand: () => number,
  spot: number,
  n: number,
): Behavior {
  const lateMonths = Array.from({ length: n }, (_, i) => i + 1).filter(
    () => rand() < p.latePaymentRate,
  );
  if (spot < n && rand() < rateForSpot(p.postPayoutDefaultRate, spot)) {
    // Pays through their own payout month, then stops.
    return {
      kind: 'STOPS_AFTER',
      lastPaidMonth: spot,
      lateMonths: lateMonths.filter((m) => m <= spot && m !== spot),
    };
  }
  if (spot > 1 && rand() < p.prePayoutDefaultRate) {
    const lastPaid = Math.floor(rand() * (spot - 1)); // 0..spot-2 → defaults before their month
    return { kind: 'STOPS_AFTER', lastPaidMonth: lastPaid, lateMonths: [] };
  }
  return { kind: 'PAYS_ALL', lateMonths };
}

interface LiveCircle {
  driver: CircleDriver;
  startMonth: number;
  done: boolean;
}

export function simulateRun(p: SimulationParams, runIndex: number): RunResult {
  const rand = mulberry32(p.seed + runIndex * 7_919);
  const { config } = p;
  const n = config.circle.membersPerCircle;
  const ledger = new Ledger();
  const initialFund = kwd(p.initialFundKwd);
  const mix = Object.entries(p.monthlyMix).map(([k, w]) => [Number(k), w] as const);
  const tiers = ([0, 1, 2] as const).map((t) => [t, p.tierMix[t]] as const);
  const live: LiveCircle[] = [];
  const series: MonthPoint[] = [];
  let breaker: BreakerState = 'NORMAL';
  let breakerTrippedMonths = 0;
  let everBelow = false;

  const fund = () => initialFund + ledger.balance(ACCOUNTS.fund);
  const exposure = () =>
    live.reduce(
      (acc, c) => acc + (c.driver.state.status === 'CLOSED' ? 0n : circleExposure(c.driver.state)),
      0n,
    );

  const lastMonth = (p.circles - 1) * p.startEveryMonths + n;
  for (let t = 0; t < lastMonth; t += 1) {
    // Start new circles this month.
    if (t % p.startEveryMonths === 0 && live.length < p.circles) {
      const idx = live.length;
      let monthlyKwd = pickWeighted(rand, mix);
      if (breaker === 'TRIPPED')
        monthlyKwd = Math.min(monthlyKwd, config.risk.breakerMaxMonthlyKwd);
      const monthly = kwd(monthlyKwd);
      const pot = monthly * BigInt(n);
      const members: ScenarioMember[] = Array.from({ length: n }, (_, i) => {
        // Tier limits: members whose tier cannot join this amount are bumped to the lowest tier that can.
        let tier: Tier = pickWeighted(rand, tiers);
        while (kwd(config.risk.tiers[tier]?.maxMonthlyKwd ?? 0) < monthly && tier < 2)
          tier = (tier + 1) as Tier;
        return { id: `r${runIndex}c${idx}m${String(i).padStart(2, '0')}`, tier };
      });
      for (let spot = 1; spot <= config.circle.prioritySpots; spot += 1) {
        const bidder = members[spot - 1] as ScenarioMember;
        const canBidTier = bidder.tier === 0 ? config.auction.allowTier0Bidding : true;
        if (canBidTier && rand() < p.bidRate) {
          const min =
            (monthly * BigInt(config.auction.minBidBpsBySpot[spot - 1] as number)) / 10_000n;
          if (min < pot) members[spot - 1] = { ...bidder, bid: { spot, amount: min } };
        }
      }
      const driver = new CircleDriver(config, ledger, `r${runIndex}c${idx}`, monthly);
      driver.form(members, fixtureSeed(`sim-${p.seed}-${runIndex}-${idx}`), {
        auctionsPaused: breaker === 'TRIPPED',
      });
      for (const sl of driver.state.slots) {
        driver.behaviorOf.set(sl.holderId as string, sampleBehavior(p, rand, sl.spot, n));
      }
      live.push({ driver, startMonth: t, done: false });
    }

    for (const c of live) {
      if (c.done) continue;
      const k = t - c.startMonth + 1;
      if (k >= 1 && k <= n) c.driver.runMonth(k);
      if (k === n) {
        const before = fund();
        c.driver.close(before, minimumReserve(config, exposure()));
        for (const m of c.driver.state.members) {
          if (m.status !== 'DEFAULTED_POST_PAYOUT' || p.recoveryRate <= 0) continue;
          const applied = m.holdbackForfeited < m.claimGross ? m.holdbackForfeited : m.claimGross;
          const open = m.claimGross - applied - m.claimRecovered;
          const amount = (open * BigInt(Math.round(p.recoveryRate * 10_000))) / 10_000n;
          if (amount > 0n)
            c.driver.apply({ type: 'RECOVERY', memberId: m.memberId, amount, reference: 'sim' });
        }
        c.done = true;
        // Retry blocked releases of earlier circles.
        for (const other of live) {
          if (
            other.driver.state.status === 'CLOSED' &&
            other.driver.state.stats.pendingRelease > 0n
          ) {
            other.driver.apply({
              type: 'RELEASE_RETRY',
              poolFundBalance: fund(),
              minimumReserve: minimumReserve(config, exposure()),
            });
          }
        }
      }
    }

    const f = fund();
    const e = exposure();
    const reserve = minimumReserve(config, e);
    const ratio = fundRatioBps(f, e);
    breaker = nextBreakerState(config, breaker, ratio);
    if (breaker === 'TRIPPED') breakerTrippedMonths += 1;
    if (f < reserve) everBelow = true;
    series.push({ month: t + 1, fund: f, exposure: e, reserve, ratioBps: ratio });
  }

  ledger.assertBalanced();
  let revenue = 0n;
  let losses = 0n;
  for (const c of live) {
    const st: CircleState = c.driver.state;
    revenue += st.stats.bidRevenue + st.stats.released;
    const lossesCovered =
      st.stats.advances -
      st.stats.advanceRepayments -
      st.stats.potReturned -
      st.stats.catchUp +
      st.stats.defaulterRefunds;
    losses += lossesCovered - st.stats.recoveries - st.stats.forfeitedHoldbacks;
  }
  return {
    revenue,
    losses,
    circlesClosed: live.length,
    everBelowReserve: everBelow,
    breakerTrippedMonths,
    series,
  };
}

const toKwd = (f: Fils): number => Number(f) / 1_000;

function percentile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i] as number;
}

export function simulate(p: SimulationParams): SimulationSummary {
  const results = Array.from({ length: p.runs }, (_, r) => simulateRun(p, r));
  const totalCircles = results.reduce((a, r) => a + r.circlesClosed, 0);
  const months = results[0]?.series.length ?? 0;
  const fundRatioOverTime = Array.from({ length: months }, (_, i) => {
    const ratios = results
      .map((r) => r.series[i]?.ratioBps)
      .filter((x): x is bigint => x !== null && x !== undefined)
      .map((x) => Number(x) / 100)
      .sort((a, b) => a - b);
    return {
      month: i + 1,
      medianPct: ratios.length ? percentile(ratios, 0.5) : null,
      p5Pct: ratios.length ? percentile(ratios, 0.05) : null,
    };
  });
  return {
    runs: p.runs,
    circlesPerRun: p.circles,
    meanRevenuePerCircleKwd: toKwd(results.reduce((a, r) => a + r.revenue, 0n)) / totalCircles,
    meanLossPerCircleKwd: toKwd(results.reduce((a, r) => a + r.losses, 0n)) / totalCircles,
    probabilityFundBelowReserve: results.filter((r) => r.everBelowReserve).length / p.runs,
    meanBreakerTrippedMonths: results.reduce((a, r) => a + r.breakerTrippedMonths, 0) / p.runs,
    fundRatioOverTime,
  };
}
