/**
 * Circle lifecycle engine (spec §4, §5).
 *
 *   FORMING → AUCTION → DRAWING → ACTIVE → CLOSING → CLOSED
 *        ↘ CANCELLED (from FORMING or AUCTION)
 *
 * `applyCircleEvent(state, event, config)` is a pure reducer: it never mutates its input and
 * returns the next state, the ledger transactions to post (with deterministic idempotency keys)
 * and side-effect notices for the API (bans, legal cases, notifications).
 *
 * Contributions are tracked per SPOT ("slot"), because a spot can change hands (replacement)
 * while its contribution history must stay complete: every slot pays M for every month.
 */
import type { SanadConfig } from '@sanad/config';
import {
  auctionResults,
  isAuctionClosed,
  placeBid,
  startAuction,
  type AuctionState,
  type AuctionWinner,
} from './auction.js';
import { commitmentFor, runDraw, type DrawAssignment } from './draw.js';
import { RuleError, invariant } from './errors.js';
import { ACCOUNTS, type Entry, type Transaction, type TransactionType } from './ledger.js';
import { bpsOf, type BasisPoints, type Fils } from './money.js';
import { releasable } from './risk.js';
import {
  canBid,
  circleRules,
  completionRefundAmount,
  holdbackAmount,
  holdbackBps,
  isAllowedMonthly,
  minBidForSpot,
  payoutAmount,
  refundBpsForSpot,
  type Tier,
} from './rules.js';

// ───────────────────────────── State ─────────────────────────────

export type CircleStatus =
  'FORMING' | 'AUCTION' | 'DRAWING' | 'ACTIVE' | 'CLOSING' | 'CLOSED' | 'CANCELLED';

export type MemberStatus =
  'QUEUED' | 'LEFT' | 'ACTIVE' | 'DEFAULTED_POST_PAYOUT' | 'DEFAULTED_PRE_PAYOUT';

export interface CircleMember {
  memberId: string;
  tier: Tier;
  status: MemberStatus;
  isReplacement: boolean;
  replacesMemberId: string | null;
  spot: number | null;
  /** Winning priority bid, deducted from the payout. */
  bid: Fils;
  holdbackBps: BasisPoints;
  /** Holdback currently held for this member. */
  holdbackHeld: Fils;
  holdbackForfeited: Fils;
  entryFeePaid: Fils;
  /** Money this member paid towards contributions (incl. late repayments and catch-up). */
  contributionsPaid: Fils;
  latePayments: number;
  receivedPayout: boolean;
  payoutAmount: Fils;
  /** Amount owed to the member in refunds_payable and how much of it was already sent. */
  refundDue: Fils;
  refundPaid: Fils;
  /** Post-payout defaulter: claim figures for the legal case file. */
  claimGross: Fils;
  claimRecovered: Fils;
}

export type MonthState =
  | { state: 'PAID' }
  | { state: 'ADVANCED'; liable: string | null }
  | { state: 'REPAID' }
  | { state: 'WAIVED' };

export interface Slot {
  spot: number;
  /** Member currently responsible for this spot's contributions; null = vacant. */
  holderId: string | null;
  vacatedBy: string | null;
  /** Keyed by month (1..N). Missing = not yet paid. */
  months: Record<number, MonthState>;
}

export interface CircleStats {
  entryFees: Fils;
  completionRefunds: Fils;
  defaulterRefunds: Fils;
  advances: Fils;
  advanceRepayments: Fils;
  potReturned: Fils;
  catchUp: Fils;
  forfeitedHoldbacks: Fils;
  recoveries: Fils;
  bidRevenue: Fils;
  latePenalties: Fils;
  defaulterPenaltiesToCharity: Fils;
  released: Fils;
  pendingRelease: Fils;
  absorbedByPool: Fils;
}

export interface CircleState {
  circleId: string;
  configVersion: number;
  status: CircleStatus;
  monthly: Fils;
  n: number;
  p: number;
  members: CircleMember[];
  slots: Slot[];
  commitment: string | null;
  seed: string | null;
  auction: AuctionState | null;
  winners: AuctionWinner[];
  draw: DrawAssignment[];
  /** Months whose payout step has run (paid, held, or returned to fund). */
  monthsSettled: number;
  heldPayouts: number[];
  stats: CircleStats;
}

// ───────────────────────────── Events & effects ─────────────────────────────

export type CircleEvent =
  | { type: 'MEMBER_JOINED'; memberId: string; tier: Tier }
  | { type: 'MEMBER_LEFT'; memberId: string }
  | { type: 'CANCELLED' }
  | { type: 'AUCTION_STARTED'; at: string; commitment: string; priorityAuctionsPaused: boolean }
  | {
      type: 'BID_PLACED';
      memberId: string;
      spot: number;
      amount: Fils;
      at: string;
      priorityAuctionsPaused: boolean;
    }
  | { type: 'AUCTION_CLOSED'; at: string }
  | { type: 'DRAW_EXECUTED'; seed: string }
  | { type: 'CONTRIBUTION_PAID'; memberId: string; month: number; late: boolean }
  | { type: 'PAYOUT_DUE'; month: number }
  | { type: 'MEMBER_DEFAULTED'; memberId: string }
  | { type: 'REPLACEMENT_JOINED'; memberId: string; tier: Tier; spot: number }
  | { type: 'CLOSE'; poolFundBalance: Fils; minimumReserve: Fils }
  | { type: 'RELEASE_RETRY'; poolFundBalance: Fils; minimumReserve: Fils }
  | { type: 'REFUND_PAID'; memberId: string }
  | { type: 'RECOVERY'; memberId: string; amount: Fils; reference: string };

export type CircleEffect =
  | { kind: 'PAYOUT_SENT'; memberId: string; month: number; amount: Fils }
  | { kind: 'PAYOUT_HELD'; memberId: string; month: number }
  | {
      kind: 'MEMBER_BANNED';
      memberId: string;
      reason: 'POST_PAYOUT_DEFAULT' | 'PRE_PAYOUT_DEFAULT';
    }
  | {
      kind: 'LEGAL_CASE_OPENED';
      memberId: string;
      /** Everything the member still owed when they defaulted. */
      grossOwed: Fils;
      holdbackApplied: Fils;
      netClaim: Fils;
    }
  | { kind: 'SPOT_VACATED'; spot: number; memberId: string; replaceableUntilMonthsSettled: number }
  | { kind: 'CIRCLE_CLOSING' }
  | { kind: 'CIRCLE_CLOSED'; summary: ClosingSummary }
  | { kind: 'RELEASE_BLOCKED'; amount: Fils };

export interface ClosingSummary {
  entryFeesCollected: Fils;
  completionRefunds: Fils;
  /** Net fund outflow caused by defaults and vacancies (spec "lossesCovered"). */
  lossesCovered: Fils;
  recoveries: Fils;
  forfeitedHoldbacks: Fils;
  releaseDue: Fils;
  released: Fils;
  blocked: Fils;
  absorbedByPool: Fils;
  bidRevenue: Fils;
}

export interface EventResult {
  state: CircleState;
  transactions: Transaction[];
  effects: CircleEffect[];
}

// ───────────────────────────── Creation ─────────────────────────────

const ZERO_STATS: CircleStats = {
  entryFees: 0n,
  completionRefunds: 0n,
  defaulterRefunds: 0n,
  advances: 0n,
  advanceRepayments: 0n,
  potReturned: 0n,
  catchUp: 0n,
  forfeitedHoldbacks: 0n,
  recoveries: 0n,
  bidRevenue: 0n,
  latePenalties: 0n,
  defaulterPenaltiesToCharity: 0n,
  released: 0n,
  pendingRelease: 0n,
  absorbedByPool: 0n,
};

export function createCircle(
  config: SanadConfig,
  params: { circleId: string; configVersion: number; monthly: Fils },
): CircleState {
  invariant(
    /^[A-Za-z0-9_-]+$/.test(params.circleId),
    'INVALID_ID',
    'circle id must be [A-Za-z0-9_-]',
  );
  invariant(
    isAllowedMonthly(config, params.monthly),
    'AMOUNT_NOT_OFFERED',
    'monthly amount not offered',
  );
  const rules = circleRules(config, params.monthly);
  return {
    circleId: params.circleId,
    configVersion: params.configVersion,
    status: 'FORMING',
    monthly: params.monthly,
    n: rules.n,
    p: rules.p,
    members: [],
    slots: [],
    commitment: null,
    seed: null,
    auction: null,
    winners: [],
    draw: [],
    monthsSettled: 0,
    heldPayouts: [],
    stats: { ...ZERO_STATS },
  };
}

// ───────────────────────────── Reducer ─────────────────────────────

class Ctx {
  readonly transactions: Transaction[] = [];
  readonly effects: CircleEffect[] = [];
  constructor(
    readonly s: CircleState,
    readonly config: SanadConfig,
  ) {}

  get pot(): Fils {
    return this.s.monthly * BigInt(this.s.n);
  }

  member(memberId: string): CircleMember {
    const m = this.s.members.find((x) => x.memberId === memberId);
    if (!m)
      throw new RuleError(
        'UNKNOWN_MEMBER',
        `member ${memberId} is not in circle ${this.s.circleId}`,
      );
    return m;
  }

  slot(spot: number): Slot {
    const sl = this.s.slots.find((x) => x.spot === spot);
    if (!sl) throw new RuleError('INVALID_SPOT', `spot ${spot} does not exist`);
    return sl;
  }

  slotOf(memberId: string): Slot {
    const sl = this.s.slots.find((x) => x.holderId === memberId);
    if (!sl) throw new RuleError('NO_SPOT', `member ${memberId} holds no spot`);
    return sl;
  }

  /** Post a transaction; `parts` make the idempotency key unique and deterministic. */
  post(
    type: TransactionType,
    parts: (string | number)[],
    entries: Entry[],
    extra: { memberId?: string; month?: number; memo?: string } = {},
  ): void {
    const tagged = entries
      .filter((e) => e.amount !== 0n)
      .map((e) => ({ ...e, circleId: this.s.circleId }));
    if (tagged.length === 0) return;
    this.transactions.push({
      key: [this.s.circleId, type, ...parts].join(':'),
      type,
      circleId: this.s.circleId,
      entries: tagged,
      ...extra,
    });
  }
}

const dr = (account: string, amount: Fils, memberId?: string): Entry => ({
  account,
  amount,
  ...(memberId !== undefined ? { memberId } : {}),
});
const cr = (account: string, amount: Fils, memberId?: string): Entry =>
  dr(account, -amount, memberId);

function requireStatus(s: CircleState, ...allowed: CircleStatus[]): void {
  invariant(
    allowed.includes(s.status),
    'INVALID_STATE',
    `circle is ${s.status}; expected ${allowed.join(' or ')}`,
  );
}

export function applyCircleEvent(
  state: CircleState,
  event: CircleEvent,
  config: SanadConfig,
): EventResult {
  const ctx = new Ctx(structuredClone(state), config);
  switch (event.type) {
    case 'MEMBER_JOINED':
      onJoined(ctx, event.memberId, event.tier);
      break;
    case 'MEMBER_LEFT':
      onLeft(ctx, event.memberId);
      break;
    case 'CANCELLED':
      onCancelled(ctx);
      break;
    case 'AUCTION_STARTED':
      onAuctionStarted(ctx, event);
      break;
    case 'BID_PLACED':
      onBid(ctx, event);
      break;
    case 'AUCTION_CLOSED':
      onAuctionClosed(ctx, event.at);
      break;
    case 'DRAW_EXECUTED':
      onDraw(ctx, event.seed);
      break;
    case 'CONTRIBUTION_PAID':
      onContribution(ctx, event.memberId, event.month, event.late);
      break;
    case 'PAYOUT_DUE':
      onPayoutDue(ctx, event.month);
      break;
    case 'MEMBER_DEFAULTED':
      onDefault(ctx, event.memberId);
      break;
    case 'REPLACEMENT_JOINED':
      onReplacement(ctx, event.memberId, event.tier, event.spot);
      break;
    case 'CLOSE':
      onClose(ctx, event.poolFundBalance, event.minimumReserve);
      break;
    case 'RELEASE_RETRY':
      onReleaseRetry(ctx, event.poolFundBalance, event.minimumReserve);
      break;
    case 'REFUND_PAID':
      onRefundPaid(ctx, event.memberId);
      break;
    case 'RECOVERY':
      onRecovery(ctx, event.memberId, event.amount, event.reference);
      break;
  }
  return { state: ctx.s, transactions: ctx.transactions, effects: ctx.effects };
}

// ── FORMING ──

function newMember(memberId: string, tier: Tier, entryFee: Fils): CircleMember {
  return {
    memberId,
    tier,
    status: 'QUEUED',
    isReplacement: false,
    replacesMemberId: null,
    spot: null,
    bid: 0n,
    holdbackBps: 0n,
    holdbackHeld: 0n,
    holdbackForfeited: 0n,
    entryFeePaid: entryFee,
    contributionsPaid: 0n,
    latePayments: 0,
    receivedPayout: false,
    payoutAmount: 0n,
    refundDue: 0n,
    refundPaid: 0n,
    claimGross: 0n,
    claimRecovered: 0n,
  };
}

function onJoined(ctx: Ctx, memberId: string, tier: Tier): void {
  const s = ctx.s;
  requireStatus(s, 'FORMING');
  invariant(/^[A-Za-z0-9_-]+$/.test(memberId), 'INVALID_ID', 'member id must be [A-Za-z0-9_-]');
  invariant(
    !s.members.some((m) => m.memberId === memberId),
    'ALREADY_JOINED',
    `${memberId} already joined`,
  );
  const queued = s.members.filter((m) => m.status === 'QUEUED').length;
  invariant(queued < s.n, 'CIRCLE_FULL', 'circle already has N members');
  const fee = circleRules(ctx.config, s.monthly).entryFee;
  s.members.push(newMember(memberId, tier, fee));
  ctx.post(
    'ENTRY_FEE_PAID',
    [memberId],
    [dr(ACCOUNTS.gateway, fee, memberId), cr(ACCOUNTS.entryFeesHeld(s.circleId), fee, memberId)],
    {
      memberId,
    },
  );
}

function refundHeldFee(ctx: Ctx, m: CircleMember): void {
  ctx.post(
    'ENTRY_FEE_REFUNDED',
    [m.memberId],
    [
      dr(ACCOUNTS.entryFeesHeld(ctx.s.circleId), m.entryFeePaid, m.memberId),
      cr(ACCOUNTS.gateway, m.entryFeePaid, m.memberId),
    ],
    { memberId: m.memberId },
  );
  m.status = 'LEFT';
  m.entryFeePaid = 0n;
}

function onLeft(ctx: Ctx, memberId: string): void {
  requireStatus(ctx.s, 'FORMING');
  const m = ctx.member(memberId);
  invariant(m.status === 'QUEUED', 'INVALID_STATE', `${memberId} is not queued`);
  refundHeldFee(ctx, m);
}

function onCancelled(ctx: Ctx): void {
  requireStatus(ctx.s, 'FORMING', 'AUCTION');
  for (const m of ctx.s.members) if (m.status === 'QUEUED') refundHeldFee(ctx, m);
  ctx.s.status = 'CANCELLED';
  ctx.s.auction = null;
}

// ── AUCTION / DRAW ──

function onAuctionStarted(ctx: Ctx, e: Extract<CircleEvent, { type: 'AUCTION_STARTED' }>): void {
  const s = ctx.s;
  requireStatus(s, 'FORMING');
  const queued = s.members.filter((m) => m.status === 'QUEUED').length;
  invariant(queued === s.n, 'NOT_FULL', `circle has ${queued} of ${s.n} members`);
  invariant(
    /^[0-9a-f]{64}$/.test(e.commitment),
    'INVALID_COMMITMENT',
    'commitment must be SHA-256 hex',
  );
  const a = ctx.config.auction;
  const spots = e.priorityAuctionsPaused ? 0 : s.p;
  s.commitment = e.commitment;
  s.auction = startAuction({
    startedAt: e.at,
    durationMs: a.auctionDurationHours * 3_600_000,
    minIncrement: circleRules(ctx.config, s.monthly).minIncrement,
    antiSnipeMs: a.antiSnipeMinutes * 60_000,
    minBids: Array.from({ length: spots }, (_, i) => minBidForSpot(ctx.config, s.monthly, i + 1)),
  });
  s.status = 'AUCTION';
}

function onBid(ctx: Ctx, e: Extract<CircleEvent, { type: 'BID_PLACED' }>): void {
  const s = ctx.s;
  requireStatus(s, 'AUCTION');
  invariant(
    !e.priorityAuctionsPaused,
    'AUCTIONS_PAUSED',
    'priority auctions are paused by the circuit breaker',
  );
  const m = ctx.member(e.memberId);
  invariant(m.status === 'QUEUED', 'INVALID_STATE', `${e.memberId} cannot bid`);
  invariant(canBid(ctx.config, m.tier), 'NOT_ELIGIBLE', `tier ${m.tier} members cannot bid`);
  const maxAmount = ctx.pot - holdbackAmount(ctx.pot, holdbackBps(ctx.config, m.tier, e.spot));
  s.auction = placeBid(s.auction as AuctionState, {
    memberId: e.memberId,
    spot: e.spot,
    amount: e.amount,
    at: e.at,
    maxAmount,
  });
}

function onAuctionClosed(ctx: Ctx, at: string): void {
  const s = ctx.s;
  requireStatus(s, 'AUCTION');
  const auction = s.auction as AuctionState;
  invariant(isAuctionClosed(auction, at), 'AUCTION_OPEN', 'auction has not ended yet');
  s.winners = auctionResults(auction, at);
  s.status = 'DRAWING';
}

function onDraw(ctx: Ctx, seed: string): void {
  const s = ctx.s;
  requireStatus(s, 'DRAWING');
  invariant(
    commitmentFor(seed) === s.commitment,
    'COMMITMENT_MISMATCH',
    'seed does not match the commitment',
  );
  const queued = s.members.filter((m) => m.status === 'QUEUED');
  const wonBy = new Map(s.winners.map((w) => [w.memberId, w]));
  const takenSpots = new Set(s.winners.map((w) => w.spot));
  const freeSpots = Array.from({ length: s.n }, (_, i) => i + 1).filter(
    (sp) => !takenSpots.has(sp),
  );
  const drawn = runDraw({
    seed,
    circleId: s.circleId,
    memberIds: queued.filter((m) => !wonBy.has(m.memberId)).map((m) => m.memberId),
    spots: freeSpots,
  });
  const spotOf = new Map<string, number>([
    ...s.winners.map((w) => [w.memberId, w.spot] as const),
    ...drawn.map((d) => [d.memberId, d.spot] as const),
  ]);
  for (const m of queued) {
    const spot = spotOf.get(m.memberId) as number;
    m.spot = spot;
    m.bid = wonBy.get(m.memberId)?.amount ?? 0n;
    m.holdbackBps = holdbackBps(ctx.config, m.tier, spot);
    m.status = 'ACTIVE';
  }
  s.slots = Array.from({ length: s.n }, (_, i) => ({
    spot: i + 1,
    holderId: (queued.find((m) => m.spot === i + 1) as CircleMember).memberId,
    vacatedBy: null,
    months: {},
  }));
  s.seed = seed;
  s.draw = drawn;
  const fees = queued.reduce((acc, m) => acc + m.entryFeePaid, 0n);
  ctx.post(
    'ENTRY_FEE_TRANSFERRED',
    ['all'],
    [dr(ACCOUNTS.entryFeesHeld(s.circleId), fees), cr(ACCOUNTS.fund, fees)],
  );
  s.stats.entryFees += fees;
  s.status = 'ACTIVE';
}

// ── ACTIVE ──

function sendPayout(ctx: Ctx, month: number): void {
  const s = ctx.s;
  const receiver = ctx.member(ctx.slot(month).holderId as string);
  const pot = ctx.pot;
  const hb = holdbackAmount(pot, receiver.holdbackBps);
  const net = payoutAmount(pot, receiver.bid, hb);
  const potAcc = ACCOUNTS.pot(s.circleId);
  const id = receiver.memberId;
  ctx.post('PAYOUT', [month], [dr(potAcc, net, id), cr(ACCOUNTS.gateway, net, id)], {
    memberId: id,
    month,
  });
  ctx.post(
    'BID_REVENUE',
    [month],
    [dr(potAcc, receiver.bid, id), cr(ACCOUNTS.revenue, receiver.bid, id)],
    {
      memberId: id,
      month,
    },
  );
  ctx.post('HOLDBACK_HELD', [month], [dr(potAcc, hb, id), cr(ACCOUNTS.holdbacks, hb, id)], {
    memberId: id,
    month,
  });
  receiver.receivedPayout = true;
  receiver.payoutAmount = net;
  receiver.holdbackHeld = hb;
  s.stats.bidRevenue += receiver.bid;
  ctx.effects.push({ kind: 'PAYOUT_SENT', memberId: id, month, amount: net });
}

/** Amount sitting in the pot for `month` (every slot that paid or was advanced). */
function potContentsForMonth(s: CircleState, month: number): Fils {
  const covered = s.slots.filter((sl) => {
    const st = sl.months[month]?.state;
    return st === 'PAID' || st === 'ADVANCED' || st === 'REPAID';
  }).length;
  return s.monthly * BigInt(covered);
}

function returnPotToFund(ctx: Ctx, month: number): void {
  const s = ctx.s;
  const sl = ctx.slot(month);
  if (sl.months[month] === undefined) sl.months[month] = { state: 'WAIVED' };
  const amount = potContentsForMonth(s, month);
  ctx.post(
    'POT_RETURNED',
    [month],
    [dr(ACCOUNTS.pot(s.circleId), amount), cr(ACCOUNTS.fund, amount)],
    { month },
  );
  s.stats.potReturned += amount;
}

function maybeEnterClosing(ctx: Ctx): void {
  const s = ctx.s;
  if (s.status === 'ACTIVE' && s.monthsSettled === s.n && s.heldPayouts.length === 0) {
    s.status = 'CLOSING';
    ctx.effects.push({ kind: 'CIRCLE_CLOSING' });
  }
}

function onContribution(ctx: Ctx, memberId: string, month: number, late: boolean): void {
  const s = ctx.s;
  requireStatus(s, 'ACTIVE', 'CLOSING');
  const m = ctx.member(memberId);
  invariant(m.status === 'ACTIVE', 'INVALID_STATE', `${memberId} cannot pay (status ${m.status})`);
  invariant(
    Number.isInteger(month) && month >= 1 && month <= s.n,
    'INVALID_MONTH',
    `month ${month} outside 1..${s.n}`,
  );
  const sl = ctx.slotOf(memberId);
  const current = sl.months[month];
  const M = s.monthly;
  if (current === undefined) {
    ctx.post(
      'CONTRIBUTION_PAID',
      [memberId, month],
      [dr(ACCOUNTS.gateway, M, memberId), cr(ACCOUNTS.pot(s.circleId), M, memberId)],
      {
        memberId,
        month,
      },
    );
    sl.months[month] = { state: 'PAID' };
  } else if (current.state === 'ADVANCED' && current.liable === memberId) {
    ctx.post(
      'FUND_ADVANCE_REPAID',
      [memberId, month],
      [
        dr(ACCOUNTS.gateway, M, memberId),
        cr(ACCOUNTS.fund, M, memberId),
        dr(ACCOUNTS.receivablesControl, M, memberId),
        cr(ACCOUNTS.receivable(memberId), M, memberId),
      ],
      { memberId, month },
    );
    sl.months[month] = { state: 'REPAID' };
    s.stats.advanceRepayments += M;
  } else {
    throw new RuleError('ALREADY_PAID', `month ${month} is already settled for ${memberId}`);
  }
  m.contributionsPaid += M;
  if (late) {
    m.latePayments += 1;
    const penalty = circleRules(ctx.config, M).latePenalty;
    ctx.post(
      'LATE_PENALTY',
      [memberId, month],
      [dr(ACCOUNTS.gateway, penalty, memberId), cr(ACCOUNTS.charity, penalty, memberId)],
      {
        memberId,
        month,
      },
    );
    s.stats.latePenalties += penalty;
  }
  if (sl.spot === month && s.heldPayouts.includes(month)) {
    s.heldPayouts = s.heldPayouts.filter((x) => x !== month);
    sendPayout(ctx, month);
    maybeEnterClosing(ctx);
  }
}

function isLiable(m: CircleMember | undefined): boolean {
  return m !== undefined && (m.status === 'ACTIVE' || m.status === 'DEFAULTED_POST_PAYOUT');
}

function onPayoutDue(ctx: Ctx, month: number): void {
  const s = ctx.s;
  requireStatus(s, 'ACTIVE');
  invariant(
    month === s.monthsSettled + 1,
    'OUT_OF_ORDER',
    `next payout is month ${s.monthsSettled + 1}`,
  );
  const M = s.monthly;
  for (const sl of s.slots) {
    if (sl.spot === month || sl.months[month] !== undefined) continue;
    const holder = sl.holderId === null ? undefined : ctx.member(sl.holderId);
    const liable = isLiable(holder) ? (holder as CircleMember).memberId : null;
    const entries = [dr(ACCOUNTS.fund, M), cr(ACCOUNTS.pot(s.circleId), M)];
    if (liable)
      entries.push(
        dr(ACCOUNTS.receivable(liable), M, liable),
        cr(ACCOUNTS.receivablesControl, M, liable),
      );
    ctx.post('FUND_ADVANCE', [sl.spot, month], entries, {
      month,
      ...(liable ? { memberId: liable } : { memo: `vacant spot ${sl.spot}` }),
    });
    sl.months[month] = { state: 'ADVANCED', liable };
    s.stats.advances += M;
  }
  const receiverSlot = ctx.slot(month);
  if (receiverSlot.holderId === null) {
    returnPotToFund(ctx, month);
  } else if (receiverSlot.months[month] === undefined) {
    s.heldPayouts.push(month);
    ctx.effects.push({ kind: 'PAYOUT_HELD', memberId: receiverSlot.holderId, month });
  } else {
    sendPayout(ctx, month);
  }
  s.monthsSettled = month;
  maybeEnterClosing(ctx);
}

function onDefault(ctx: Ctx, memberId: string): void {
  const s = ctx.s;
  requireStatus(s, 'ACTIVE', 'CLOSING');
  const m = ctx.member(memberId);
  invariant(m.status === 'ACTIVE', 'INVALID_STATE', `${memberId} is ${m.status}`);
  const sl = ctx.slotOf(memberId);
  const advanced = Object.values(sl.months).some(
    (x) => x.state === 'ADVANCED' && x.liable === memberId,
  );
  const held = s.heldPayouts.includes(sl.spot);
  invariant(advanced || held, 'NOTHING_OVERDUE', `${memberId} has no overdue contribution`);
  const M = s.monthly;

  if (m.receivedPayout) {
    m.status = 'DEFAULTED_POST_PAYOUT';
    // Everything still owed: advanced-unrepaid months plus all months not yet due.
    const owedMonths = Array.from({ length: s.n }, (_, i) => i + 1).filter((mo) => {
      const st = sl.months[mo];
      return st === undefined || (st.state === 'ADVANCED' && st.liable === memberId);
    }).length;
    const gross = M * BigInt(owedMonths);
    const hb = m.holdbackHeld;
    const applied = hb < gross ? hb : gross;
    ctx.post(
      'HOLDBACK_FORFEITED',
      [memberId],
      [
        dr(ACCOUNTS.holdbacks, hb, memberId),
        cr(ACCOUNTS.fund, hb, memberId),
        dr(ACCOUNTS.receivablesControl, applied, memberId),
        cr(ACCOUNTS.receivable(memberId), applied, memberId),
      ],
      { memberId },
    );
    m.holdbackForfeited = hb;
    m.holdbackHeld = 0n;
    m.claimGross = gross;
    s.stats.forfeitedHoldbacks += hb;
    ctx.effects.push({ kind: 'MEMBER_BANNED', memberId, reason: 'POST_PAYOUT_DEFAULT' });
    ctx.effects.push({
      kind: 'LEGAL_CASE_OPENED',
      memberId,
      grossOwed: gross,
      holdbackApplied: applied,
      netClaim: gross - applied,
    });
    return;
  }

  m.status = 'DEFAULTED_PRE_PAYOUT';
  sl.holderId = null;
  sl.vacatedBy = memberId;
  for (const [mo, st] of Object.entries(sl.months)) {
    if (st.state === 'ADVANCED' && st.liable === memberId) {
      ctx.post(
        'CLAIM_CANCELLED',
        [memberId, mo],
        [
          dr(ACCOUNTS.receivablesControl, M, memberId),
          cr(ACCOUNTS.receivable(memberId), M, memberId),
        ],
        { memberId, month: Number(mo), memo: 'pre-payout default: advance becomes vacancy cover' },
      );
      sl.months[Number(mo)] = { state: 'ADVANCED', liable: null };
    }
  }
  if (held) {
    s.heldPayouts = s.heldPayouts.filter((x) => x !== sl.spot);
    returnPotToFund(ctx, sl.spot);
  }
  if (ctx.config.defaults.banOnPrePayoutDefault) {
    ctx.effects.push({ kind: 'MEMBER_BANNED', memberId, reason: 'PRE_PAYOUT_DEFAULT' });
  }
  ctx.effects.push({
    kind: 'SPOT_VACATED',
    spot: sl.spot,
    memberId,
    replaceableUntilMonthsSettled: sl.spot - ctx.config.replacement.replacementCutoffMonths,
  });
  maybeEnterClosing(ctx);
}

/** Can `spot` still take a replacement member? (spec §5.11) */
export function canReplace(state: CircleState, config: SanadConfig, spot: number): boolean {
  const sl = state.slots.find((x) => x.spot === spot);
  return (
    state.status === 'ACTIVE' &&
    sl !== undefined &&
    sl.holderId === null &&
    spot > state.monthsSettled &&
    spot - state.monthsSettled >= config.replacement.replacementCutoffMonths
  );
}

function onReplacement(ctx: Ctx, memberId: string, tier: Tier, spot: number): void {
  const s = ctx.s;
  requireStatus(s, 'ACTIVE');
  invariant(/^[A-Za-z0-9_-]+$/.test(memberId), 'INVALID_ID', 'member id must be [A-Za-z0-9_-]');
  invariant(
    !s.members.some((m) => m.memberId === memberId),
    'ALREADY_JOINED',
    `${memberId} already in circle`,
  );
  invariant(
    canReplace(s, ctx.config, spot),
    'REPLACEMENT_CLOSED',
    `spot ${spot} cannot take a replacement now`,
  );
  const sl = ctx.slot(spot);
  const rules = circleRules(ctx.config, s.monthly);
  const m = newMember(memberId, tier, rules.entryFee);
  m.status = 'ACTIVE';
  m.isReplacement = true;
  m.replacesMemberId = sl.vacatedBy;
  m.spot = spot;
  m.holdbackBps = holdbackBps(ctx.config, tier, spot);
  s.members.push(m);
  ctx.post(
    'ENTRY_FEE_PAID',
    [memberId],
    [dr(ACCOUNTS.gateway, rules.entryFee, memberId), cr(ACCOUNTS.fund, rules.entryFee, memberId)],
    {
      memberId,
    },
  );
  s.stats.entryFees += rules.entryFee;

  // Catch-up: the spot's full contribution history so far goes to the fund (it already
  // covered those months, and it will refund the original holder's own payments at closing).
  let months = 0;
  for (let mo = 1; mo <= s.n; mo += 1) {
    const st = sl.months[mo];
    if (mo <= s.monthsSettled || st?.state === 'PAID') {
      months += 1;
      if (st?.state === 'ADVANCED') sl.months[mo] = { state: 'REPAID' };
    }
  }
  const catchUp = s.monthly * BigInt(months);
  ctx.post(
    'CONTRIBUTION_PAID',
    [memberId, 'catch-up'],
    [dr(ACCOUNTS.gateway, catchUp, memberId), cr(ACCOUNTS.fund, catchUp, memberId)],
    {
      memberId,
      memo: `replacement catch-up for ${months} month(s)`,
    },
  );
  m.contributionsPaid += catchUp;
  s.stats.catchUp += catchUp;
  sl.holderId = memberId;
}

// ── CLOSING ──

/** Net Guarantee-Fund result of this circle, from its own stats. */
export function circleFundNet(st: CircleStats): Fils {
  return (
    st.entryFees +
    st.forfeitedHoldbacks +
    st.potReturned +
    st.advanceRepayments +
    st.catchUp +
    st.recoveries -
    st.advances -
    st.completionRefunds -
    st.defaulterRefunds -
    st.released
  );
}

function onClose(ctx: Ctx, poolFundBalance: Fils, minimumReserve: Fils): void {
  const s = ctx.s;
  requireStatus(s, 'CLOSING');
  for (const sl of s.slots) {
    for (let mo = 1; mo <= s.n; mo += 1) {
      const st = sl.months[mo];
      invariant(st !== undefined, 'UNSETTLED', `spot ${sl.spot} month ${mo} is unpaid`);
      if (st.state === 'ADVANCED' && st.liable !== null) {
        invariant(
          ctx.member(st.liable).status === 'DEFAULTED_POST_PAYOUT',
          'MEMBER_UNRESOLVED',
          `${st.liable} owes month ${mo}: record payment or default before closing`,
        );
      }
    }
  }
  let fundDelta = 0n;
  for (const m of s.members) {
    if (m.status === 'ACTIVE') {
      ctx.post(
        'HOLDBACK_RELEASED',
        [m.memberId],
        [
          dr(ACCOUNTS.holdbacks, m.holdbackHeld, m.memberId),
          cr(ACCOUNTS.gateway, m.holdbackHeld, m.memberId),
        ],
        {
          memberId: m.memberId,
        },
      );
      m.holdbackHeld = 0n;
      if (m.latePayments <= ctx.config.refunds.maxLatePaymentsForRefund) {
        const refund = completionRefundAmount(
          m.entryFeePaid,
          refundBpsForSpot(ctx.config, s.n, m.spot as number),
        );
        ctx.post(
          'COMPLETION_REFUND',
          [m.memberId],
          [dr(ACCOUNTS.fund, refund, m.memberId), cr(ACCOUNTS.refunds, refund, m.memberId)],
          {
            memberId: m.memberId,
          },
        );
        m.refundDue += refund;
        s.stats.completionRefunds += refund;
        fundDelta -= refund;
      }
    } else if (m.status === 'DEFAULTED_PRE_PAYOUT') {
      const d = ctx.config.defaults;
      const penalty = bpsOf(m.contributionsPaid, BigInt(d.prePayoutDefaultPenaltyBps));
      const refund = m.contributionsPaid - penalty;
      const toCharity = d.prePayoutDefaultPenaltyDestination === 'charity' ? penalty : 0n;
      const fundOut = refund + toCharity;
      ctx.post(
        'DEFAULTER_REFUND',
        [m.memberId],
        [
          dr(ACCOUNTS.fund, fundOut, m.memberId),
          cr(ACCOUNTS.refunds, refund, m.memberId),
          cr(ACCOUNTS.charity, toCharity, m.memberId),
        ],
        { memberId: m.memberId },
      );
      m.refundDue += refund;
      s.stats.defaulterRefunds += fundOut;
      s.stats.defaulterPenaltiesToCharity += toCharity;
      fundDelta -= fundOut;
    } else if (m.status === 'DEFAULTED_POST_PAYOUT') {
      // By closing, every month they still owed has been advanced, so the open claim is
      // gross − holdback applied − anything already recovered.
      const applied = m.holdbackForfeited < m.claimGross ? m.holdbackForfeited : m.claimGross;
      const outstanding = m.claimGross - applied - m.claimRecovered;
      ctx.post(
        'LOSS_WRITE_OFF',
        [m.memberId],
        [
          dr(ACCOUNTS.losses, outstanding, m.memberId),
          cr(ACCOUNTS.receivable(m.memberId), outstanding, m.memberId),
        ],
        {
          memberId: m.memberId,
          memo: 'written off for accounting; legal recovery continues',
        },
      );
    }
  }

  const st = s.stats;
  const lossesCovered =
    st.advances - st.advanceRepayments - st.potReturned - st.catchUp + st.defaulterRefunds;
  const formula =
    st.entryFees - st.completionRefunds - (lossesCovered - st.recoveries - st.forfeitedHoldbacks);
  invariant(
    formula === circleFundNet(st),
    'RELEASE_MISMATCH',
    'release formula disagrees with fund movements',
  );
  const due = formula > 0n ? formula : 0n;
  const { release, blocked } = releasable(due, poolFundBalance + fundDelta, minimumReserve);
  ctx.post(
    'REVENUE_RELEASE',
    ['close'],
    [dr(ACCOUNTS.fund, release), cr(ACCOUNTS.revenue, release)],
  );
  st.released += release;
  st.pendingRelease = blocked;
  st.absorbedByPool = formula < 0n ? -formula : 0n;
  if (blocked > 0n) ctx.effects.push({ kind: 'RELEASE_BLOCKED', amount: blocked });
  s.status = 'CLOSED';
  ctx.effects.push({
    kind: 'CIRCLE_CLOSED',
    summary: {
      entryFeesCollected: st.entryFees,
      completionRefunds: st.completionRefunds,
      lossesCovered,
      recoveries: st.recoveries,
      forfeitedHoldbacks: st.forfeitedHoldbacks,
      releaseDue: due,
      released: release,
      blocked,
      absorbedByPool: st.absorbedByPool,
      bidRevenue: st.bidRevenue,
    },
  });
}

function onReleaseRetry(ctx: Ctx, poolFundBalance: Fils, minimumReserve: Fils): void {
  const s = ctx.s;
  requireStatus(s, 'CLOSED');
  const pending = s.stats.pendingRelease;
  invariant(pending > 0n, 'NOTHING_PENDING', 'no blocked release to retry');
  const { release, blocked } = releasable(pending, poolFundBalance, minimumReserve);
  const attempt = s.stats.released.toString();
  ctx.post(
    'REVENUE_RELEASE',
    ['retry', attempt],
    [dr(ACCOUNTS.fund, release), cr(ACCOUNTS.revenue, release)],
  );
  s.stats.released += release;
  s.stats.pendingRelease = blocked;
  if (blocked > 0n) ctx.effects.push({ kind: 'RELEASE_BLOCKED', amount: blocked });
}

function onRefundPaid(ctx: Ctx, memberId: string): void {
  requireStatus(ctx.s, 'CLOSED');
  const m = ctx.member(memberId);
  const amount = m.refundDue - m.refundPaid;
  invariant(amount > 0n, 'NOTHING_DUE', `no refund due to ${memberId}`);
  ctx.post(
    'REFUND_PAID',
    [memberId],
    [dr(ACCOUNTS.refunds, amount, memberId), cr(ACCOUNTS.gateway, amount, memberId)],
    {
      memberId,
    },
  );
  m.refundPaid += amount;
}

function onRecovery(ctx: Ctx, memberId: string, amount: Fils, reference: string): void {
  const s = ctx.s;
  const m = ctx.member(memberId);
  invariant(
    m.status === 'DEFAULTED_POST_PAYOUT',
    'INVALID_STATE',
    'recoveries apply to post-payout defaulters',
  );
  const applied = m.holdbackForfeited < m.claimGross ? m.holdbackForfeited : m.claimGross;
  const open = m.claimGross - applied - m.claimRecovered;
  invariant(
    amount > 0n && amount <= open,
    'INVALID_AMOUNT',
    `recovery must be between 1 and ${open} fils`,
  );
  const claims =
    s.status === 'CLOSED'
      ? [
          dr(ACCOUNTS.receivablesControl, amount, memberId),
          cr(ACCOUNTS.recoveries, amount, memberId),
        ]
      : [
          dr(ACCOUNTS.receivablesControl, amount, memberId),
          cr(ACCOUNTS.receivable(memberId), amount, memberId),
        ];
  ctx.post(
    'RECOVERY',
    [memberId, reference],
    [dr(ACCOUNTS.gateway, amount, memberId), cr(ACCOUNTS.fund, amount, memberId), ...claims],
    { memberId },
  );
  m.claimRecovered += amount;
  s.stats.recoveries += amount;
}

// ───────────────────────────── Queries ─────────────────────────────

/**
 * Exposure of this circle (spec §5.12): contributions not yet due/paid by members who already
 * received their payout. Includes post-payout defaulters (their future months will be advanced).
 */
export function circleExposure(state: CircleState): Fils {
  let months = 0;
  for (const sl of state.slots) {
    if (sl.holderId === null) continue;
    const holder = state.members.find((m) => m.memberId === sl.holderId) as CircleMember;
    if (!holder.receivedPayout) continue;
    for (let mo = 1; mo <= state.n; mo += 1) if (sl.months[mo] === undefined) months += 1;
  }
  return state.monthly * BigInt(months);
}

/** Running amount a member owes (advanced and not repaid), for the admin view (spec §5.10). */
export function amountOwed(state: CircleState, memberId: string): Fils {
  let months = 0;
  for (const sl of state.slots) {
    for (const st of Object.values(sl.months))
      if (st.state === 'ADVANCED' && st.liable === memberId) months += 1;
  }
  return state.monthly * BigInt(months);
}
