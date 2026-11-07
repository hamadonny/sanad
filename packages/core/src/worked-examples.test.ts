/**
 * Spec §5.14 worked examples as fixtures.
 * Setup: N = 10, M = 100 KWD, Pot = 1,000 KWD, members A–J.
 * A wins spot 1 with a 45 KWD bid; B (tier 0) is drawn into spot 2 (10% holdback = 100 KWD).
 *
 * NOTE (open question Q1 for the founder): the spec says A is tier 1, but tier 1 carries a 5%
 * holdback on spots 1..P, which would make A's payout 905 (not 955). The spec's numbers only
 * work if A — and whoever is drawn into spot 3 — has no holdback, so these fixtures use tier 2
 * for everyone except B. Example 1b shows the tier-1 variant.
 */
import { defaultConfig } from '@sanad/config';
import { describe, expect, it } from 'vitest';
import type { CircleEffect } from './circle.js';
import { ACCOUNTS, type Ledger, type TransactionType } from './ledger.js';
import { kwd, sum, type Fils } from './money.js';
import { findSeed, runScenario, type Scenario, type ScenarioMember } from './scenario.js';

const config = defaultConfig;
const CIRCLE = 'circle-5-14';
const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/** Seed that draws B into spot 2 and H into spot 8 (A takes spot 1 by auction). */
const SEED = findSeed(
  'worked-example',
  { circleId: CIRCLE, memberIds: IDS.slice(1), spots: [2, 3, 4, 5, 6, 7, 8, 9, 10] },
  (spotOf) => spotOf.get('B') === 2 && spotOf.get('H') === 8,
);

function members(
  overrides: Partial<Record<string, Partial<ScenarioMember>>> = {},
): ScenarioMember[] {
  return IDS.map((id) => ({
    id,
    tier: id === 'B' ? 0 : 2,
    ...(id === 'A' ? { bid: { spot: 1, amount: kwd(45) } } : {}),
    ...overrides[id],
  }));
}

function scenario(extra: Partial<Scenario> = {}): Scenario {
  return {
    config,
    circleId: CIRCLE,
    monthly: kwd(100),
    members: members(),
    seed: SEED,
    otherPoolBalance: kwd(20_000),
    ...extra,
  };
}

const sumType = (ledger: Ledger, type: TransactionType, account: string, memberId?: string): Fils =>
  sum(
    ledger
      .transactions()
      .filter((t) => t.type === type && (memberId === undefined || t.memberId === memberId))
      .flatMap((t) =>
        t.entries
          .filter((e) => e.account === account)
          .map((e) => (e.amount < 0n ? -e.amount : e.amount)),
      ),
  );

const payoutTo = (effects: CircleEffect[], memberId: string) =>
  effects.find((e) => e.kind === 'PAYOUT_SENT' && e.memberId === memberId);

const spotOf = (r: ReturnType<typeof runScenario>, id: string) =>
  r.state.members.find((m) => m.memberId === id)?.spot;

const closing = (effects: CircleEffect[]) => {
  const c = effects.find((e) => e.kind === 'CIRCLE_CLOSED');
  if (c?.kind !== 'CIRCLE_CLOSED') throw new Error('circle did not close');
  return c.summary;
};

/** Money that left the platform (payouts, holdback releases, refunds) + what stayed inside. */
function moneyCheck(ledger: Ledger) {
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
  return { inflow, outflow, held: ledger.balance(ACCOUNTS.gateway) };
}

describe('§5.14 setup', () => {
  it('draw places A, B and H as the examples require', () => {
    const r = runScenario(scenario());
    expect(spotOf(r, 'A')).toBe(1);
    expect(spotOf(r, 'B')).toBe(2);
    expect(spotOf(r, 'H')).toBe(8);
  });
});

describe('§5.14 Example 1 — everyone pays', () => {
  const r = runScenario(scenario());
  const { ledger, effects } = r;

  it('pays A 955 (bid 45 deducted) and B 900 (holdback 100)', () => {
    expect(payoutTo(effects, 'A')).toMatchObject({ month: 1, amount: kwd(955) });
    expect(payoutTo(effects, 'B')).toMatchObject({ month: 2, amount: kwd(900) });
  });

  it('pays spots 3–10 the full 1,000 each (8,000)', () => {
    const others = effects.filter((e) => e.kind === 'PAYOUT_SENT' && e.month >= 3);
    expect(others).toHaveLength(8);
    expect(sum(others.map((e) => (e.kind === 'PAYOUT_SENT' ? e.amount : 0n)))).toBe(kwd(8_000));
  });

  it('releases B’s 100 holdback at closing', () => {
    expect(sumType(ledger, 'HOLDBACK_RELEASED', ACCOUNTS.gateway, 'B')).toBe(kwd(100));
  });

  it('refunds 400 (spots 6–7: 50 each; 8–10: 100 each)', () => {
    const bySpot = r.state.members
      .map((m) => [m.spot, m.refundDue] as const)
      .sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(bySpot.map(([, v]) => v)).toEqual([
      0n,
      0n,
      0n,
      0n,
      0n,
      kwd(50),
      kwd(50),
      kwd(100),
      kwd(100),
      kwd(100),
    ]);
    expect(sumType(ledger, 'COMPLETION_REFUND', ACCOUNTS.refunds)).toBe(kwd(400));
  });

  it('revenue = 45 bid + 600 release', () => {
    expect(sumType(ledger, 'BID_REVENUE', ACCOUNTS.revenue)).toBe(kwd(45));
    expect(sumType(ledger, 'REVENUE_RELEASE', ACCOUNTS.revenue)).toBe(kwd(600));
    expect(ledger.balance(ACCOUNTS.revenue)).toBe(kwd(645));
    expect(closing(effects)).toMatchObject({
      releaseDue: kwd(600),
      released: kwd(600),
      blocked: 0n,
    });
  });

  it('balances: 955 + 900 + 8,000 + 100 + 400 + 45 + 600 = 11,000 = 1,000 + 10,000', () => {
    const { inflow, outflow, held } = moneyCheck(ledger);
    expect(inflow).toBe(kwd(11_000));
    expect(outflow).toBe(kwd(955 + 900 + 8_000 + 100 + 400));
    expect(held).toBe(kwd(645)); // 45 bid + 600 release = platform revenue, still held
    expect(ledger.balance(ACCOUNTS.fund)).toBe(0n);
    ledger.assertBalanced();
  });
});

describe('§5.14 Example 1b — A is tier 1 (5% holdback, see Q1)', () => {
  const r = runScenario(scenario({ members: members({ A: { tier: 1 } }) }));
  it('A receives 905 and gets 50 back at closing; totals still balance', () => {
    expect(payoutTo(r.effects, 'A')).toMatchObject({ amount: kwd(905) });
    expect(sumType(r.ledger, 'HOLDBACK_RELEASED', ACCOUNTS.gateway, 'A')).toBe(kwd(50));
    expect(moneyCheck(r.ledger).inflow).toBe(kwd(11_000));
    expect(r.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(645));
  });
});

describe('§5.14 Example 2 — post-payout default', () => {
  const r = runScenario(
    scenario({ members: members({ B: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 2 } } }) }),
  );
  const { ledger, effects } = r;

  it('B received 900 in month 2', () => {
    expect(payoutTo(effects, 'B')).toMatchObject({ month: 2, amount: kwd(900) });
  });

  it('fund covers 8 × 100 = 800; holdback 100 forfeited → net loss 700', () => {
    expect(sumType(ledger, 'FUND_ADVANCE', ACCOUNTS.fund, 'B')).toBe(kwd(800));
    expect(sumType(ledger, 'HOLDBACK_FORFEITED', ACCOUNTS.fund, 'B')).toBe(kwd(100));
  });

  it('release = 1,000 − 400 − (800 − 0 − 100) = −100 → 0; pool absorbs 100', () => {
    expect(closing(effects)).toMatchObject({
      entryFeesCollected: kwd(1_000),
      completionRefunds: kwd(400),
      lossesCovered: kwd(800),
      forfeitedHoldbacks: kwd(100),
      releaseDue: 0n,
      released: 0n,
      absorbedByPool: kwd(100),
    });
    expect(ledger.balance(ACCOUNTS.revenue)).toBe(kwd(45));
    expect(ledger.balance(ACCOUNTS.fund)).toBe(kwd(-100));
  });

  it('B is banned and a legal case shows 800 owed, 700 net of holdback', () => {
    expect(effects).toContainEqual({
      kind: 'MEMBER_BANNED',
      memberId: 'B',
      reason: 'POST_PAYOUT_DEFAULT',
    });
    expect(effects).toContainEqual({
      kind: 'LEGAL_CASE_OPENED',
      memberId: 'B',
      grossOwed: kwd(800),
      holdbackApplied: kwd(100),
      netClaim: kwd(700),
    });
    expect(r.state.members.find((m) => m.memberId === 'B')?.refundDue).toBe(0n);
    expect(ledger.balance(ACCOUNTS.losses)).toBe(kwd(700));
    expect(ledger.balance(ACCOUNTS.receivable('B'))).toBe(0n);
    ledger.assertBalanced();
  });

  it('a later recovery is credited back to the fund', () => {
    const rec = runScenario(
      scenario({
        members: members({ B: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 2 } } }),
        recoveries: { B: kwd(300) },
      }),
    );
    expect(rec.ledger.balance(ACCOUNTS.fund)).toBe(kwd(200));
    expect(rec.ledger.balance(ACCOUNTS.recoveries)).toBe(kwd(300));
    rec.ledger.assertBalanced();
  });
});

describe('§5.14 Example 3 — pre-payout default', () => {
  const r = runScenario(
    scenario({ members: members({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }) }),
  );
  const { ledger, effects } = r;

  it('fund covers months 5, 6, 7, 9, 10 (500); month-8 pot (900) returns to the fund', () => {
    const advances = ledger.transactions().filter((t) => t.type === 'FUND_ADVANCE');
    expect(advances.map((t) => t.month)).toEqual([5, 6, 7, 9, 10]);
    expect(sumType(ledger, 'FUND_ADVANCE', ACCOUNTS.fund)).toBe(kwd(500));
    expect(sumType(ledger, 'POT_RETURNED', ACCOUNTS.fund)).toBe(kwd(900));
    expect(payoutTo(effects, 'H')).toBeUndefined();
  });

  it('H is refunded the 400 they paid (penalty 0%); entry fee forfeited', () => {
    expect(sumType(ledger, 'DEFAULTER_REFUND', ACCOUNTS.refunds, 'H')).toBe(kwd(400));
    expect(sumType(ledger, 'COMPLETION_REFUND', ACCOUNTS.refunds, 'H')).toBe(0n);
  });

  it('refunds 300 (spots 6, 7, 9, 10); release 700; revenue 745', () => {
    expect(sumType(ledger, 'COMPLETION_REFUND', ACCOUNTS.refunds)).toBe(kwd(300));
    expect(closing(effects)).toMatchObject({
      releaseDue: kwd(700),
      released: kwd(700),
      lossesCovered: 0n,
    });
    expect(ledger.balance(ACCOUNTS.revenue)).toBe(kwd(745));
    expect(ledger.balance(ACCOUNTS.fund)).toBe(0n);
    ledger.assertBalanced();
  });

  it('H is banned (banOnPrePayoutDefault) and spot 8 is offered for replacement', () => {
    expect(effects).toContainEqual({
      kind: 'MEMBER_BANNED',
      memberId: 'H',
      reason: 'PRE_PAYOUT_DEFAULT',
    });
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'SPOT_VACATED', spot: 8, memberId: 'H' }),
    );
  });
});

describe('§5.14 Example 4 — replacement', () => {
  const r = runScenario(
    scenario({
      members: members({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }),
      replacements: [{ replaces: 'H', memberId: 'R', tier: 2, afterMonth: 6 }],
    }),
  );
  const { ledger, effects } = r;

  it('R pays entry fee 100 + 600 catch-up, then 100 in months 7–10, and receives 1,000 in month 8', () => {
    expect(sumType(ledger, 'ENTRY_FEE_PAID', ACCOUNTS.gateway, 'R')).toBe(kwd(100));
    const rPaid = sum(
      ledger
        .transactions()
        .filter((t) => t.type === 'CONTRIBUTION_PAID' && t.memberId === 'R')
        .flatMap((t) =>
          t.entries.filter((e) => e.account === ACCOUNTS.gateway).map((e) => e.amount),
        ),
    );
    expect(rPaid).toBe(kwd(1_000)); // 600 catch-up + 4 × 100 = N × M
    expect(payoutTo(effects, 'R')).toMatchObject({ month: 8, amount: kwd(1_000) });
  });

  it('H is still refunded 400; the fund ends neutral for the vacancy', () => {
    expect(sumType(ledger, 'DEFAULTER_REFUND', ACCOUNTS.refunds, 'H')).toBe(kwd(400));
    expect(sumType(ledger, 'FUND_ADVANCE', ACCOUNTS.fund)).toBe(kwd(200)); // months 5, 6
    expect(closing(effects).lossesCovered).toBe(0n);
  });

  it('R (spot 8) earns the 100% refund; release = 1,100 − 400 = 700; revenue 745', () => {
    expect(r.state.members.find((m) => m.memberId === 'R')?.refundDue).toBe(kwd(100));
    expect(closing(effects)).toMatchObject({
      entryFeesCollected: kwd(1_100),
      completionRefunds: kwd(400),
      released: kwd(700),
    });
    expect(ledger.balance(ACCOUNTS.revenue)).toBe(kwd(745));
    ledger.assertBalanced();
  });
});

describe('§5.14 Example 5 — no bids at all', () => {
  const tiers: Record<string, 0 | 1 | 2> = {
    A: 0,
    B: 0,
    C: 0,
    D: 1,
    E: 1,
    F: 2,
    G: 2,
    H: 2,
    I: 2,
    J: 2,
  };
  const r = runScenario(
    scenario({
      members: IDS.map((id) => ({ id, tier: tiers[id] as 0 | 1 | 2 })),
      seed: findSeed(
        'example-5',
        { circleId: CIRCLE, memberIds: IDS, spots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        (s) => s.get('A') === 1 && s.get('D') === 3,
      ),
    }),
  );

  it('randomises every spot and earns no priority revenue', () => {
    expect(r.state.winners).toEqual([]);
    expect(r.ledger.transactions().some((t) => t.type === 'BID_REVENUE')).toBe(false);
  });

  it('applies holdbacks to tier-0/1 members drawn into spots 1–3 only', () => {
    const hb = new Map(
      r.ledger
        .transactions()
        .filter((t) => t.type === 'HOLDBACK_HELD')
        .map((t) => [
          t.memberId,
          -(t.entries.find((e) => e.account === ACCOUNTS.holdbacks)?.amount ?? 0n),
        ]),
    );
    expect(hb.get('A')).toBe(kwd(100)); // tier 0, spot 1
    expect(hb.get('D')).toBe(kwd(50)); // tier 1, spot 3
    for (const m of r.state.members) {
      if ((m.spot as number) > 3) expect(hb.has(m.memberId)).toBe(false);
    }
    expect(r.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(600));
    r.ledger.assertBalanced();
  });
});
