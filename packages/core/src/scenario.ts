/**
 * Scenario runner: drives a whole circle from FORMING to CLOSED through the real engine.
 * Used by the worked-example fixtures, the property tests and the Monte Carlo simulation.
 * It is a test/simulation harness — the API drives the same events from real payments and jobs.
 *
 * Month timeline used here (mirrors the production job order):
 *   1. on-time contributions for month k
 *   2. PAYOUT_DUE(k)  (fund advances anything missing; receiver's own month missing → held)
 *   3. late contributions for month k (repay advances / release a held payout)
 *   4. defaults (members whose behaviour stops at k)
 *   5. replacements scheduled after month k
 */
import type { SanadConfig } from '@sanad/config';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  applyCircleEvent,
  canReplace,
  createCircle,
  type CircleEffect,
  type CircleEvent,
  type CircleState,
} from './circle.js';
import { commitmentFor, runDraw } from './draw.js';
import { ACCOUNTS, Ledger } from './ledger.js';
import type { Fils } from './money.js';
import { minimumReserve } from './risk.js';
import type { Tier } from './rules.js';

export type Behavior =
  | { kind: 'PAYS_ALL'; lateMonths?: readonly number[] }
  /** Pays months 1..lastPaidMonth, then never again → DEFAULTED at month lastPaidMonth + 1. */
  | { kind: 'STOPS_AFTER'; lastPaidMonth: number; lateMonths?: readonly number[] };

export interface ScenarioMember {
  id: string;
  tier: Tier;
  bid?: { spot: number; amount: Fils };
  behavior?: Behavior;
}

export interface ScenarioReplacement {
  /** Joins the spot vacated by this member, right after month `afterMonth`. */
  replaces: string;
  memberId: string;
  tier: Tier;
  afterMonth: number;
  behavior?: Behavior;
}

export interface Scenario {
  config: SanadConfig;
  circleId: string;
  monthly: Fils;
  members: readonly ScenarioMember[];
  seed: string;
  replacements?: readonly ScenarioReplacement[];
  /** Money already in the pooled fund from other circles (affects release blocking). */
  otherPoolBalance?: Fils;
  /** Exposure elsewhere in the pool (affects the minimum reserve). */
  otherExposure?: Fils;
  /** Post-closing legal recoveries per member. */
  recoveries?: Readonly<Record<string, Fils>>;
  /** Default false: also run REFUND_PAID for every member owed a refund. */
  skipRefundPayments?: boolean;
}

export interface ScenarioResult {
  state: CircleState;
  ledger: Ledger;
  effects: CircleEffect[];
  events: CircleEvent[];
}

const T0 = Date.UTC(2027, 0, 1, 9, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/** Deterministic seed for fixtures: SHA-256 of a label. */
export function fixtureSeed(label: string): string {
  return bytesToHex(sha256(utf8ToBytes(label)));
}

/** First fixture seed (label `${prefix}-${i}`) whose draw satisfies `predicate`. */
export function findSeed(
  prefix: string,
  input: { circleId: string; memberIds: readonly string[]; spots: readonly number[] },
  predicate: (spotOf: ReadonlyMap<string, number>) => boolean,
  maxTries = 10_000,
): string {
  for (let i = 0; i < maxTries; i += 1) {
    const seed = fixtureSeed(`${prefix}-${i}`);
    const result = runDraw({ seed, ...input });
    if (predicate(new Map(result.map((a) => [a.memberId, a.spot])))) return seed;
  }
  throw new Error(`no seed found in ${maxTries} tries`);
}

function pays(b: Behavior | undefined, month: number): 'ON_TIME' | 'LATE' | 'NO' {
  const behavior = b ?? { kind: 'PAYS_ALL' };
  if (behavior.kind === 'STOPS_AFTER' && month > behavior.lastPaidMonth) return 'NO';
  return behavior.lateMonths?.includes(month) ? 'LATE' : 'ON_TIME';
}

function defaultsAt(b: Behavior | undefined, n: number): number | null {
  return b?.kind === 'STOPS_AFTER' && b.lastPaidMonth < n ? b.lastPaidMonth + 1 : null;
}

/**
 * Drives one circle through the engine, posting to a (possibly shared) ledger.
 * `runScenario` and the Monte Carlo simulation both use it, so they follow identical steps.
 */
export class CircleDriver {
  state: CircleState;
  readonly effects: CircleEffect[] = [];
  readonly events: CircleEvent[] = [];
  readonly behaviorOf = new Map<string, Behavior | undefined>();

  constructor(
    readonly config: SanadConfig,
    readonly ledger: Ledger,
    circleId: string,
    monthly: Fils,
  ) {
    this.state = createCircle(config, { circleId, configVersion: 1, monthly });
  }

  apply(e: CircleEvent): void {
    const r = applyCircleEvent(this.state, e, this.config);
    this.ledger.postAll(r.transactions);
    this.effects.push(...r.effects);
    this.events.push(e);
    this.state = r.state;
  }

  /** FORMING → AUCTION → DRAWING → ACTIVE. */
  form(
    members: readonly ScenarioMember[],
    seed: string,
    opts: { auctionsPaused?: boolean } = {},
  ): void {
    const paused = opts.auctionsPaused ?? false;
    for (const m of members) {
      this.apply({ type: 'MEMBER_JOINED', memberId: m.id, tier: m.tier });
      this.behaviorOf.set(m.id, m.behavior);
    }
    this.apply({
      type: 'AUCTION_STARTED',
      at: iso(T0),
      commitment: commitmentFor(seed),
      priorityAuctionsPaused: paused,
    });
    members.forEach((m, i) => {
      if (m.bid && !paused) {
        this.apply({
          type: 'BID_PLACED',
          memberId: m.id,
          spot: m.bid.spot,
          amount: m.bid.amount,
          at: iso(T0 + (i + 1) * 60_000),
          priorityAuctionsPaused: false,
        });
      }
    });
    this.apply({
      type: 'AUCTION_CLOSED',
      at: iso(T0 + this.config.auction.auctionDurationHours * 3_600_000 + 3_600_000),
    });
    this.apply({ type: 'DRAW_EXECUTED', seed });
  }

  private activeHolders(): string[] {
    return this.state.slots
      .flatMap((sl) => (sl.holderId === null ? [] : [sl.holderId]))
      .filter((id) => this.state.members.find((x) => x.memberId === id)?.status === 'ACTIVE');
  }

  /** One month: on-time payments, payout, late payments, defaults, replacements. */
  runMonth(k: number, replacements: readonly ScenarioReplacement[] = []): void {
    for (const id of this.activeHolders()) {
      if (pays(this.behaviorOf.get(id), k) === 'ON_TIME')
        this.apply({ type: 'CONTRIBUTION_PAID', memberId: id, month: k, late: false });
    }
    this.apply({ type: 'PAYOUT_DUE', month: k });
    for (const id of this.activeHolders()) {
      if (pays(this.behaviorOf.get(id), k) === 'LATE')
        this.apply({ type: 'CONTRIBUTION_PAID', memberId: id, month: k, late: true });
    }
    for (const id of this.activeHolders()) {
      if (defaultsAt(this.behaviorOf.get(id), this.state.n) === k)
        this.apply({ type: 'MEMBER_DEFAULTED', memberId: id });
    }
    for (const r of replacements) {
      if (r.afterMonth !== k) continue;
      const spot = this.state.slots.find(
        (sl) => sl.vacatedBy === r.replaces && sl.holderId === null,
      )?.spot;
      if (spot !== undefined && canReplace(this.state, this.config, spot)) {
        this.behaviorOf.set(r.memberId, r.behavior);
        this.apply({ type: 'REPLACEMENT_JOINED', memberId: r.memberId, tier: r.tier, spot });
      }
    }
  }

  close(poolFundBalance: Fils, reserve: Fils, payRefunds = true): void {
    this.apply({ type: 'CLOSE', poolFundBalance, minimumReserve: reserve });
    if (!payRefunds) return;
    for (const m of this.state.members) {
      if (m.refundDue > m.refundPaid) this.apply({ type: 'REFUND_PAID', memberId: m.memberId });
    }
  }
}

export function runScenario(sc: Scenario): ScenarioResult {
  const ledger = new Ledger();
  const d = new CircleDriver(sc.config, ledger, sc.circleId, sc.monthly);
  d.form(sc.members, sc.seed);
  for (let k = 1; k <= d.state.n; k += 1) d.runMonth(k, sc.replacements);
  const fund = (sc.otherPoolBalance ?? 0n) + ledger.balance(ACCOUNTS.fund);
  d.close(fund, minimumReserve(sc.config, sc.otherExposure ?? 0n), !sc.skipRefundPayments);
  for (const [memberId, amount] of Object.entries(sc.recoveries ?? {})) {
    d.apply({ type: 'RECOVERY', memberId, amount, reference: 'legal-1' });
  }
  return { state: d.state, ledger, effects: d.effects, events: d.events };
}
