/**
 * Property-based tests (spec §5.14, §17): random circles, random default patterns and random
 * config within allowed ranges. After every run:
 *  - every transaction balances (cash side and claims side separately);
 *  - money in = money out + fund change + revenue + charity + payables (cash identity);
 *  - nothing is left in pots, held fees, holdbacks or refunds payable;
 *  - each payout uses exactly one full pot (payout + bid + holdback = N × M);
 *  - refund ≤ entry fee for every member [SHARIAH];
 *  - the fund is only ever debited by advances, refunds and revenue release;
 *  - each slot's contributions total N × M (incl. replacements);
 *  - release formula = the circle's net fund movement.
 */
import { defaultConfig, parseConfig, type SanadConfig } from '@sanad/config';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS } from './ledger.js';
import { kwd, sum } from './money.js';
import {
  fixtureSeed,
  runScenario,
  type Behavior,
  type Scenario,
  type ScenarioMember,
} from './scenario.js';

const FUND_DEBIT_TYPES = new Set([
  'FUND_ADVANCE',
  'COMPLETION_REFUND',
  'DEFAULTER_REFUND',
  'REVENUE_RELEASE',
]);

const configArb = fc
  .record({
    n: fc.integer({ min: 4, max: 14 }),
    p: fc.integer({ min: 0, max: 3 }),
    grace: fc.integer({ min: 0, max: 5 }),
    latePenaltyBps: fc.integer({ min: 0, max: 1_000 }),
    prePenaltyBps: fc.integer({ min: 0, max: 2_000 }),
    destination: fc.constantFrom('charity' as const, 'fund' as const),
    holdbacks: fc.tuple(fc.integer({ min: 0, max: 2_000 }), fc.integer({ min: 0, max: 1_000 })),
    maxLate: fc.integer({ min: 0, max: 3 }),
    cutoff: fc.integer({ min: 0, max: 3 }),
    useGenericRefunds: fc.boolean(),
  })
  .map((r): SanadConfig => {
    const c = structuredClone(defaultConfig);
    c.circle.membersPerCircle = r.n;
    c.circle.prioritySpots = Math.min(r.p, r.n - 1);
    c.auction.minBidBpsBySpot = [3_000, 2_000, 1_000].slice(0, c.circle.prioritySpots);
    c.contributions.gracePeriodDays = r.grace;
    c.contributions.latePenaltyBps = r.latePenaltyBps;
    c.defaults.prePayoutDefaultPenaltyBps = r.prePenaltyBps;
    c.defaults.prePayoutDefaultPenaltyDestination = r.destination;
    c.risk.tiers[0]!.holdbackBps = r.holdbacks[0];
    c.risk.tiers[1]!.holdbackBps = r.holdbacks[1];
    c.refunds.maxLatePaymentsForRefund = r.maxLate;
    c.replacement.replacementCutoffMonths = r.cutoff;
    if (r.useGenericRefunds) c.refunds.explicitTables = {};
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
        otherPoolBalance: kwd(100_000),
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

        ledger.assertBalanced();
        expect(state.status).toBe('CLOSED');

        // Nothing left in pass-through/payable accounts.
        expect(ledger.balance(ACCOUNTS.pot(sc.circleId))).toBe(0n);
        expect(ledger.balance(ACCOUNTS.entryFeesHeld(sc.circleId))).toBe(0n);
        expect(ledger.balance(ACCOUNTS.holdbacks)).toBe(0n);
        expect(ledger.balance(ACCOUNTS.refunds)).toBe(0n);

        // Cash identity: money held = fund + revenue + charity (+ payables, all zero now).
        expect(ledger.balance(ACCOUNTS.gateway)).toBe(
          ledger.balance(ACCOUNTS.fund) +
            ledger.balance(ACCOUNTS.revenue) +
            ledger.balance(ACCOUNTS.charity),
        );

        // Payouts always use exactly one full pot.
        const byMonth = new Map<number, bigint>();
        for (const t of ledger.transactions()) {
          if (t.type === 'PAYOUT' || t.type === 'BID_REVENUE' || t.type === 'HOLDBACK_HELD') {
            const debit =
              t.entries.find((e) => e.account === ACCOUNTS.pot(sc.circleId))?.amount ?? 0n;
            byMonth.set(t.month as number, (byMonth.get(t.month as number) ?? 0n) + debit);
          }
        }
        for (const v of byMonth.values()) expect(v).toBe(pot);

        // [SHARIAH] completion refund never exceeds the entry fee.
        for (const t of ledger.transactions().filter((x) => x.type === 'COMPLETION_REFUND')) {
          const m = state.members.find((x) => x.memberId === t.memberId);
          expect(
            -(t.entries.find((e) => e.account === ACCOUNTS.refunds)?.amount ?? 0n),
          ).toBeLessThanOrEqual(m?.entryFeePaid ?? 0n);
        }

        // Fund never pays operating costs.
        for (const t of ledger.transactions()) {
          if (t.entries.some((e) => e.account === ACCOUNTS.fund && e.amount > 0n))
            expect(FUND_DEBIT_TYPES.has(t.type)).toBe(true);
        }

        // Every slot's month is settled; replacements pay N × M in total.
        for (const sl of state.slots) expect(Object.keys(sl.months)).toHaveLength(n);
        const rep = state.members.find((m) => m.isReplacement);
        if (rep) expect(rep.contributionsPaid).toBe(pot);

        // Release formula equals the circle's net fund movement (other circles' money excluded).
        expect(ledger.balance(ACCOUNTS.fund)).toBe(
          state.stats.pendingRelease +
            (state.stats.absorbedByPool > 0n ? -state.stats.absorbedByPool : 0n),
        );

        // Total in = total out + what stays inside.
        const inflow = sum(
          ledger
            .transactions()
            .flatMap((t) =>
              t.entries
                .filter((e) => e.account === ACCOUNTS.gateway && e.amount > 0n)
                .map((e) => e.amount),
            ),
        );
        const outflow = sum(
          ledger
            .transactions()
            .flatMap((t) =>
              t.entries
                .filter((e) => e.account === ACCOUNTS.gateway && e.amount < 0n)
                .map((e) => -e.amount),
            ),
        );
        expect(inflow - outflow).toBe(ledger.balance(ACCOUNTS.gateway));
      }),
      { numRuns: Number(process.env.PROPERTY_RUNS ?? 300) },
    );
  }, 600_000);
});
