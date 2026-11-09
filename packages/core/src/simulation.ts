/**
 * Monte Carlo simulation of many circles under the organiser model (D-017).
 *
 * Each run starts `circles` circles (one every `startEveryMonths`), samples member behaviour
 * after the draw, and drives every circle month by month through the real engine against one
 * shared ledger. Sanad guarantees nothing, so the questions are: how much does Sanad earn per
 * circle, and how much do honest members end up short when someone defaults?
 *
 * Randomness here only decides *behaviour* (who defaults, who is late). Money is still integer
 * fils computed by the engine.
 */
import type { SanadConfig } from '@sanad/config';
import { circleRevenue, circleShortfall, openClaim } from './circle.js';
import { ACCOUNTS, Ledger } from './ledger.js';
import { kwd, type Fils } from './money.js';
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
  seed: 42,
});

export interface RunResult {
  revenue: Fils;
  /** Money honest members are short at the end (after holdbacks and recoveries). */
  shortfall: Fils;
  /** Total volume paid out (payouts + top-ups). */
  paidOut: Fils;
  circlesClosed: number;
  circlesWithShortfall: number;
}

export interface SimulationSummary {
  runs: number;
  circlesPerRun: number;
  meanRevenuePerCircleKwd: number;
  meanShortfallPerCircleKwd: number;
  /** Share of all money paid out that members did not receive because of defaults. */
  shortfallShareOfPayoutsPct: number;
  probabilityCircleHasShortfall: number;
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

export function simulateRun(p: SimulationParams, runIndex: number): RunResult {
  const rand = mulberry32(p.seed + runIndex * 7_919);
  const { config } = p;
  const n = config.circle.membersPerCircle;
  const ledger = new Ledger();
  const mix = Object.entries(p.monthlyMix).map(([k, w]) => [Number(k), w] as const);
  const tiers = ([0, 1, 2] as const).map((t) => [t, p.tierMix[t]] as const);
  const live: { driver: CircleDriver; startMonth: number; done: boolean }[] = [];

  const lastMonth = (p.circles - 1) * p.startEveryMonths + n;
  for (let t = 0; t < lastMonth; t += 1) {
    if (t % p.startEveryMonths === 0 && live.length < p.circles) {
      const idx = live.length;
      const monthly = kwd(pickWeighted(rand, mix));
      const pot = monthly * BigInt(n);
      const members: ScenarioMember[] = Array.from({ length: n }, (_, i) => {
        // Members whose tier cannot join this amount are bumped to the lowest tier that can.
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
      driver.form(members, fixtureSeed(`sim-${p.seed}-${runIndex}-${idx}`));
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
        c.driver.close();
        for (const { memberId } of c.driver.state.members) {
          // Re-read each time: one recovery can top up (and so pay down) another defaulter.
          const m = c.driver.state.members.find((x) => x.memberId === memberId);
          const open = m ? openClaim(m) : 0n;
          if (open === 0n || p.recoveryRate <= 0) continue;
          const amount = (open * BigInt(Math.round(p.recoveryRate * 10_000))) / 10_000n;
          if (amount > 0n) c.driver.apply({ type: 'RECOVERY', memberId, amount, reference: 'sim' });
        }
        c.driver.payRefunds();
        c.done = true;
      }
    }
  }

  ledger.assertBalanced();
  let revenue = 0n;
  let shortfall = 0n;
  let withShortfall = 0;
  for (const c of live) {
    const st = c.driver.state;
    revenue += circleRevenue(st.stats);
    const sf = circleShortfall(st);
    shortfall += sf;
    if (sf > 0n) withShortfall += 1;
  }
  const paidOut = ledger
    .transactions()
    .filter((x) => x.type === 'PAYOUT' || x.type === 'TOP_UP')
    .reduce(
      (a, x) => a + (x.entries.find((e) => e.account === ACCOUNTS.gateway)?.amount ?? 0n),
      0n,
    );
  return {
    revenue,
    shortfall,
    paidOut: -paidOut,
    circlesClosed: live.length,
    circlesWithShortfall: withShortfall,
  };
}

const toKwd = (f: Fils): number => Number(f) / 1_000;

export function simulate(p: SimulationParams): SimulationSummary {
  const results = Array.from({ length: p.runs }, (_, r) => simulateRun(p, r));
  const totalCircles = results.reduce((a, r) => a + r.circlesClosed, 0);
  const shortfall = results.reduce((a, r) => a + r.shortfall, 0n);
  const paidOut = results.reduce((a, r) => a + r.paidOut, 0n);
  return {
    runs: p.runs,
    circlesPerRun: p.circles,
    meanRevenuePerCircleKwd: toKwd(results.reduce((a, r) => a + r.revenue, 0n)) / totalCircles,
    meanShortfallPerCircleKwd: toKwd(shortfall) / totalCircles,
    shortfallShareOfPayoutsPct:
      paidOut > 0n ? (toKwd(shortfall) / toKwd(paidOut + shortfall)) * 100 : 0,
    probabilityCircleHasShortfall:
      results.reduce((a, r) => a + r.circlesWithShortfall, 0) / totalCircles,
  };
}
