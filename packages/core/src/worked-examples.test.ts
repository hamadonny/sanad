/**
 * Worked examples for the organiser model (D-017) as fixtures.
 * Setup: N = 10, M = 100 KWD, Pot = 1,000 KWD, members A–J, organising fee 3% of the pot (30).
 * A wins spot 1 with a 45 KWD bid; B (tier 0, 30% holdback) is drawn into spot 2; everyone else
 * is tier 2 (20% holdback on spots 1–3). H is drawn into spot 8.
 *
 * Sanad guarantees nothing: each month's recipient gets what was collected for that month,
 * minus their bid and holdback. When someone defaults, their holdback and later recoveries
 * repair what they owe; what cannot be recovered is borne by the months they left short.
 */
import { defaultConfig } from '@sanad/config';
import { describe, expect, it } from 'vitest';
import { circleShortfall, openClaim, type CircleEffect } from './circle.js';
import { ACCOUNTS, type Ledger } from './ledger.js';
import { kwd, sum } from './money.js';
import { findSeed, runScenario, type Scenario, type ScenarioMember } from './scenario.js';

const config = defaultConfig;
const CIRCLE = 'organiser-examples';
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
  return { config, circleId: CIRCLE, monthly: kwd(100), members: members(), seed: SEED, ...extra };
}

const KWD = (n: number) => BigInt(Math.round(n * 1000));

const memberOf = (r: ReturnType<typeof runScenario>, id: string) =>
  r.state.members.find((m) => m.memberId === id)!;

const holderOf = (r: ReturnType<typeof runScenario>, spot: number) =>
  r.state.slots.find((s) => s.spot === spot)!.holderId as string;

const closing = (effects: CircleEffect[]) => {
  const c = effects.find((e) => e.kind === 'CIRCLE_CLOSED');
  if (c?.kind !== 'CIRCLE_CLOSED') throw new Error('circle did not close');
  return c.summary;
};

/** Money that came in, went out, and stayed inside (= revenue + charity). */
function moneyCheck(ledger: Ledger) {
  const gw = ledger
    .transactions()
    .flatMap((t) => t.entries.filter((e) => e.account === ACCOUNTS.gateway));
  return {
    inflow: sum(gw.filter((e) => e.amount > 0n).map((e) => e.amount)),
    outflow: sum(gw.filter((e) => e.amount < 0n).map((e) => -e.amount)),
    held: ledger.balance(ACCOUNTS.gateway),
  };
}

describe('setup', () => {
  it('draw places A, B and H as the examples require', () => {
    const r = runScenario(scenario());
    expect(memberOf(r, 'A').spot).toBe(1);
    expect(memberOf(r, 'B').spot).toBe(2);
    expect(memberOf(r, 'H').spot).toBe(8);
  });
});

describe('Example 1 — everyone pays', () => {
  const r = runScenario(scenario());

  it('pays A 755 (45 bid, 200 holdback), B 700 (300 holdback), spot 3 800, spots 4–10 1,000', () => {
    expect(memberOf(r, 'A').payoutAmount).toBe(kwd(755));
    expect(memberOf(r, 'B').payoutAmount).toBe(kwd(700));
    expect(memberOf(r, holderOf(r, 3)).payoutAmount).toBe(kwd(800));
    for (let spot = 4; spot <= 10; spot += 1)
      expect(memberOf(r, holderOf(r, spot)).payoutAmount).toBe(kwd(1000));
  });

  it('releases all 700 of holdbacks at closing', () => {
    expect(closing(r.effects).holdbacksReleased).toBe(kwd(700));
    expect(r.ledger.balance(ACCOUNTS.holdbacks)).toBe(0n);
  });

  it('revenue = 300 organising fees + 45 bid = 345; nobody is short', () => {
    expect(closing(r.effects)).toMatchObject({
      organizingFees: kwd(300),
      bidRevenue: kwd(45),
      revenue: kwd(345),
      shortfall: 0n,
    });
    expect(r.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(345));
  });

  it('balances: 10,000 + 300 in = 755 + 700 + 800 + 7,000 + 700 out + 345 kept', () => {
    const m = moneyCheck(r.ledger);
    expect(m.inflow).toBe(kwd(10_300));
    expect(m.outflow).toBe(kwd(755 + 700 + 800 + 7_000 + 700));
    expect(m.held).toBe(kwd(345));
    r.ledger.assertBalanced();
  });
});

describe('Example 2 — default after payout', () => {
  const r = runScenario(
    scenario({
      members: members({ B: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 2 } } }),
      recoveries: { B: kwd(200) },
    }),
  );
  const B = memberOf(r, 'B');

  it('B received 700 in month 2, then owed months 3–10 (800)', () => {
    expect(B.payoutAmount).toBe(kwd(700));
    expect(B.status).toBe('DEFAULTED_POST_PAYOUT');
    expect(B.claimGross).toBe(kwd(800));
  });

  it('B’s 300 holdback is spread equally: 37.5 per owed month', () => {
    expect(B.holdbackApplied).toBe(kwd(300));
    const cells = r.state.slots.find((s) => s.spot === 2)!.months;
    for (let mo = 3; mo <= 10; mo += 1) expect(cells[mo]?.state).toBe('COVERED');
    // month 3 was paid out short (700 = 900 − 200 holdback) and then topped up
    expect(memberOf(r, holderOf(r, 3)).payoutAmount).toBe(KWD(700 + 37.5 + 22.5));
    expect(memberOf(r, holderOf(r, 4)).payoutAmount).toBe(KWD(900 + 37.5 + 22.5));
  });

  it('a legal case is opened for 500 (800 owed − 300 holdback); B is banned', () => {
    expect(r.effects).toContainEqual({
      kind: 'LEGAL_CASE_OPENED',
      memberId: 'B',
      grossOwed: kwd(800),
      holdbackApplied: kwd(300),
      netClaim: kwd(500),
    });
    expect(r.effects).toContainEqual({
      kind: 'MEMBER_BANNED',
      memberId: 'B',
      reason: 'POST_PAYOUT_DEFAULT',
    });
  });

  it('a 200 recovery: 20 fee to Sanad, 180 forwarded (22.5 per month); 320 still short', () => {
    expect(r.state.stats.recoveryFees).toBe(kwd(20));
    expect(openClaim(B)).toBe(kwd(300));
    expect(circleShortfall(r.state)).toBe(kwd(320));
    expect(r.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(365));
    expect(r.ledger.balance(ACCOUNTS.pot(CIRCLE))).toBe(0n);
    r.ledger.assertBalanced();
  });
});

describe('Example 3 — default before payout', () => {
  const r = runScenario(
    scenario({ members: members({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }) }),
  );

  it('months 5–7 were first paid out 100 short, then repaired from month 8’s pot', () => {
    for (const spot of [5, 6, 7]) {
      const id = holderOf(r, spot);
      expect(r.effects).toContainEqual({
        kind: 'PAYOUT_SENT',
        memberId: id,
        month: spot,
        amount: kwd(900),
      });
      expect(r.effects).toContainEqual({
        kind: 'TOP_UP_SENT',
        memberId: id,
        month: spot,
        amount: kwd(100),
      });
      expect(memberOf(r, id).payoutAmount).toBe(kwd(1000));
    }
  });

  it('month 8 (900 collected): 300 repairs months 5–7, 200 kept for 9–10, H gets back 400', () => {
    expect(r.state.monthRecords[8]?.recipientId).toBeNull();
    expect(memberOf(r, 'H').refundDue).toBe(kwd(400));
    expect(memberOf(r, holderOf(r, 9)).payoutAmount).toBe(kwd(1000));
    expect(memberOf(r, holderOf(r, 10)).payoutAmount).toBe(kwd(1000));
    expect(circleShortfall(r.state)).toBe(0n);
  });

  it('H is banned and spot 8 was offered for replacement; revenue unchanged at 345', () => {
    expect(r.effects).toContainEqual({
      kind: 'MEMBER_BANNED',
      memberId: 'H',
      reason: 'PRE_PAYOUT_DEFAULT',
    });
    expect(r.effects).toContainEqual({
      kind: 'SPOT_VACATED',
      spot: 8,
      memberId: 'H',
      replaceableUntilMonthsSettled: 6,
    });
    expect(r.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(345));
    r.ledger.assertBalanced();
  });
});

describe('Example 4 — replacement', () => {
  const r = runScenario(
    scenario({
      members: members({ H: { behavior: { kind: 'STOPS_AFTER', lastPaidMonth: 4 } } }),
      replacements: [{ replaces: 'H', memberId: 'R', tier: 1, afterMonth: 6 }],
    }),
  );
  const R = memberOf(r, 'R');

  it('R pays 600 catch-up + 30 replacement fee, then months 7–10, and receives 1,000 in month 8', () => {
    expect(R.contributionsPaid).toBe(kwd(1000));
    expect(R.feePaid).toBe(kwd(30));
    expect(R.payoutAmount).toBe(kwd(1000));
  });

  it('H is bought out (400 back); months 5–6 are topped up; nobody is short', () => {
    expect(memberOf(r, 'H').refundDue).toBe(kwd(400));
    expect(memberOf(r, holderOf(r, 5)).payoutAmount).toBe(kwd(1000));
    expect(memberOf(r, holderOf(r, 6)).payoutAmount).toBe(kwd(1000));
    expect(circleShortfall(r.state)).toBe(0n);
  });

  it('revenue = 300 + 45 + 30 = 375', () => {
    expect(closing(r.effects).revenue).toBe(kwd(375));
    r.ledger.assertBalanced();
  });
});

describe('Example 5 — no bids at all', () => {
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

  it('randomises every spot and earns only the organising fees', () => {
    expect(r.state.winners).toEqual([]);
    expect(r.ledger.transactions().some((t) => t.type === 'BID_REVENUE')).toBe(false);
    expect(r.ledger.balance(ACCOUNTS.revenue)).toBe(kwd(300));
  });

  it('applies holdbacks by tier to spots 1–3 only', () => {
    const hb = new Map(
      r.ledger
        .transactions()
        .filter((t) => t.type === 'HOLDBACK_HELD')
        .map((t) => [
          t.memberId,
          -(t.entries.find((e) => e.account === ACCOUNTS.holdbacks)?.amount ?? 0n),
        ]),
    );
    expect(hb.get('A')).toBe(kwd(300)); // tier 0, spot 1
    expect(hb.get('D')).toBe(kwd(250)); // tier 1, spot 3
    for (const m of r.state.members) {
      if ((m.spot as number) > 3) expect(hb.has(m.memberId)).toBe(false);
    }
    r.ledger.assertBalanced();
  });
});
