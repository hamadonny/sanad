/**
 * Property-based tests: random circles, random default patterns and random config within
 * allowed ranges, under the organiser model (D-017). After every run:
 *  - every transaction balances (cash side and claims side separately);
 *  - nothing is left in pots, held fees, holdbacks or refunds payable;
 *  - money held = Sanad's revenue + charity (Sanad holds no fund);
 *  - no month pays out more than it collected, nor more than one full pot;
 *  - revenue = organising + replacement fees + bids + recovery fees;
 *  - with no post-payout default, nobody is short (vacancies repair themselves);
 *  - a pre-payout defaulter never gets back more than they paid;
 *  - each slot's months are all settled; replacements pay N × M in total.
 */
import { defaultConfig, parseConfig, type SanadConfig } from '@sanad/config';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { circleRevenue, circleShortfall, monthCredits } from './circle.js';
import { ACCOUNTS } from './ledger.js';
import { kwd, sum } from './money.js';
import {
  fixtureSeed,
  runScenario,
  type Behavior,
  type Scenario,
  type ScenarioMember,
} from './scenario.js';

const configArb = fc
  .record({
    n: fc.integer({ min: 4, max: 14 }),
    p: fc.integer({ min: 0, max: 3 }),
    grace: fc.integer({ min: 0, max: 5 }),
    latePenaltyBps: fc.integer({ min: 0, max: 1_000 }),
    prePenaltyBps: fc.integer({ min: 0, max: 2_000 }),
    holdbacks: fc.tuple(
      fc.integer({ min: 0, max: 3_000 }),
      fc.integer({ min: 0, max: 2_500 }),
      fc.integer({ min: 0, max: 2_000 }),
    ),
    cutoff: fc.integer({ min: 0, max: 3 }),
    feeBps: fc.integer({ min: 1, max: 1_000 }),
  })
  .map((r): SanadConfig => {
    const c = structuredClone(defaultConfig);
    c.circle.membersPerCircle = r.n;
    c.circle.prioritySpots = Math.min(r.p, r.n - 1);
    c.auction.minBidBpsBySpot = [3_000, 2_000, 1_000].slice(0, c.circle.prioritySpots);
    c.contributions.gracePeriodDays = r.grace;
    c.contributions.latePenaltyBps = r.latePenaltyBps;
    c.defaults.prePayoutDefaultPenaltyBps = r.prePenaltyBps;
    c.risk.tiers[0]!.holdbackBps = r.holdbacks[0];
    c.risk.tiers[1]!.holdbackBps = r.holdbacks[1];
    c.risk.tiers[2]!.holdbackBps = r.holdbacks[2];
    c.replacement.replacementCutoffMonths = r.cutoff;
    c.organizingFee.ofPotBps = r.feeBps;
    return parseConfig(c);
  });

const scenarioArb: fc.Arbitrary<Scenario> = configArb.chain((config) => {
  const n = config.circle.membersPerCircle;
  const behavior: fc.Arbitrary<Behavior> = fc.oneof(
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('PAYS_ALL' as const),
        lateMonths: fc.subarray(
          Array.from({ length: n }, (_, i) => i + 1),
          { maxLength: 4 },
        ),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('STOPS_AFTER' as const),
        lastPaidMonth: fc.integer({ min: 0, max: n - 1 }),
        lateMonths: fc.subarray(
          Array.from({ length: n }, (_, i) => i + 1),
          { maxLength: 2 },
        ),
      }),
    },
  );
  const member = fc.record({
    tier: fc.constantFrom(0 as const, 1 as const, 2 as const),
    behavior,
    bidExtraBps: fc.integer({ min: 0, max: 3_000 }),
    wantsSpot: fc.integer({ min: 0, max: config.circle.prioritySpots }),
  });
  return fc
    .record({
      members: fc.array(member, { minLength: n, maxLength: n }),
      monthlyKwd: fc.constantFrom(50, 100),
      seedLabel: fc.string({ minLength: 1, maxLength: 8 }),
      replaceAfter: fc.option(fc.integer({ min: 1, max: n }), { nil: undefined }),
    })
    .map(({ members, monthlyKwd, seedLabel, replaceAfter }) => {
      const monthly = kwd(monthlyKwd);
      const taken = new Set<number>();
      const ms: ScenarioMember[] = members.map((m, i) => {
        const id = `m${String(i).padStart(2, '0')}`;
        const spot = m.wantsSpot;
        // One uncontested bid per priority spot keeps bids valid; holdback cap ⇒ ≤ pot − holdback.
        if (spot > 0 && !taken.has(spot)) {
          taken.add(spot);
          const min =
            (monthly * BigInt(config.auction.minBidBpsBySpot[spot - 1] as number)) / 10_000n;
          const amount = min + (monthly * BigInt(m.bidExtraBps)) / 10_000n;
          return { id, tier: m.tier, behavior: m.behavior, bid: { spot, amount } };
        }
        return { id, tier: m.tier, behavior: m.behavior };
      });
      const stopper = ms.find((m) => m.behavior?.kind === 'STOPS_AFTER');
      return {
        config,
        circleId: 'prop',
        monthly,
        members: ms,
        seed: fixtureSeed(seedLabel),
        ...(stopper && replaceAfter !== undefined
          ? {
              replacements: [
                {
                  replaces: stopper.id,
                  memberId: 'rep',
                  tier: 2 as const,
                  afterMonth: replaceAfter,
                },
              ],
            }
          : {}),
      };
    });
});

describe('ledger invariants (property-based)', () => {
  it('hold for random circles, defaults and config', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { state, ledger } = runScenario(sc);
        const n = state.n;
        const pot = state.monthly * BigInt(n);
        const potAcc = ACCOUNTS.pot(sc.circleId);

        ledger.assertBalanced();
        expect(state.status).toBe('CLOSED');

        // Nothing left in pass-through/payable accounts.
        expect(ledger.balance(potAcc)).toBe(0n);
        expect(ledger.balance(ACCOUNTS.feesHeld(sc.circleId))).toBe(0n);
        expect(ledger.balance(ACCOUNTS.holdbacks)).toBe(0n);
        expect(ledger.balance(ACCOUNTS.refunds)).toBe(0n);

        // Sanad holds no fund: money kept = revenue + charity.
        expect(ledger.balance(ACCOUNTS.gateway)).toBe(
          ledger.balance(ACCOUNTS.revenue) + ledger.balance(ACCOUNTS.charity),
        );
        expect(ledger.balance(ACCOUNTS.revenue)).toBe(circleRevenue(state.stats));

        // No month hands out more than it collected, and never more than one pot.
        for (let m = 1; m <= n; m += 1) {
          const r = state.monthRecords[m];
          expect(r?.status).toBe('DONE');
          const out = r!.bidTaken + r!.holdbackTaken + r!.out;
          expect(out).toBe(monthCredits(state, m));
          expect(out).toBeLessThanOrEqual(pot);
          if (r!.recipientId !== null) {
            const rec = state.members.find((x) => x.memberId === r!.recipientId)!;
            if (rec.status === 'ACTIVE') expect(rec.payoutAmount).toBe(r!.out);
          }
        }

        // Defaults hurt members only after a post-payout default.
        const shortfall = circleShortfall(state);
        expect(shortfall).toBeGreaterThanOrEqual(0n);
        if (!state.members.some((m) => m.status === 'DEFAULTED_POST_PAYOUT'))
          expect(shortfall).toBe(0n);

        for (const m of state.members) {
          if (m.status === 'DEFAULTED_PRE_PAYOUT')
            expect(m.contributionsReturned).toBeLessThanOrEqual(m.contributionsPaid);
          expect(m.refundPaid).toBe(m.refundDue);
        }

        // Every slot's month is settled; replacements pay N × M in total.
        for (const sl of state.slots) expect(Object.keys(sl.months)).toHaveLength(n);
        const rep = state.members.find((m) => m.isReplacement);
        if (rep?.status === 'ACTIVE') expect(rep.contributionsPaid).toBe(pot);

        // Total in = total out + what stays inside.
        const gw = ledger
          .transactions()
          .flatMap((t) => t.entries.filter((e) => e.account === ACCOUNTS.gateway));
        const inflow = sum(gw.filter((e) => e.amount > 0n).map((e) => e.amount));
        const outflow = sum(gw.filter((e) => e.amount < 0n).map((e) => -e.amount));
        expect(inflow - outflow).toBe(ledger.balance(ACCOUNTS.gateway));
      }),
      { numRuns: Number(process.env.PROPERTY_RUNS ?? 300) },
    );
  }, 600_000);
});
