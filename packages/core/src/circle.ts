/**
 * Circle lifecycle engine — organiser model (D-017).
 *
 *   FORMING → AUCTION → DRAWING → ACTIVE → CLOSING → CLOSED
 *        ↘ CANCELLED (from FORMING or AUCTION)
 *
 * `applyCircleEvent(state, event, config)` is a pure reducer: it never mutates its input and
 * returns the next state, the ledger transactions to post (with deterministic idempotency keys)
 * and side-effect notices for the API (payouts, top-ups, refunds, bans, legal cases).
 *
 * Sanad organises the circle; it does NOT guarantee it. Each month's recipient receives the
 * money actually collected for that month, minus their priority bid and holdback. Money that
 * arrives after a payout is forwarded to that month's recipient as a top-up.
 *
 * Contributions are tracked per SPOT ("slot"), because a spot can change hands (replacement)
 * while its contribution history must stay complete.
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
import {
  canBid,
  circleRules,
  holdbackAmount,
  holdbackBps,
  isAllowedMonthly,
  minBidForSpot,
  recoveryFee,
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
  /** Holdback used to cover months this member owed after defaulting. */
  holdbackApplied: Fils;
  /** Organising fee (or replacement fee) this member paid. */
  feePaid: Fils;
  /** Money this member paid towards contributions (incl. late payments and catch-up). */
  contributionsPaid: Fils;
  /** Of that, how much was handed back after a pre-payout default (before any penalty). */
  contributionsReturned: Fils;
  latePayments: number;
  /** Their turn has been paid out (even if part of it is still arriving as top-ups). */
  receivedPayout: boolean;
  /** Everything sent to them for their own month so far (payout + top-ups). */
  payoutAmount: Fils;
  /** Money owed back to the member (refunds_payable) and how much of it was already sent. */
  refundDue: Fils;
  refundPaid: Fils;
  /** Post-payout defaulter: what they owed at default, and what came back since. */
  claimGross: Fils;
  claimRecovered: Fils;
}

/**
 * One cell of the contribution grid (slot × month). Missing = not yet paid, not yet due.
 *  - PAID: the money arrived.
 *  - LATE: the month's payout happened without it; the holder still owes it.
 *  - COVERED: the holder defaulted; `covered` fils of the M came from their holdback, later
 *    recoveries (HOLDBACK) or the vacant spot's own pot (VACANCY). The rest is a shortfall
 *    borne by that month's recipient.
 *  - WAIVED: a vacated spot's own month (nobody is owed it).
 */
export type MonthState =
  | { state: 'PAID' }
  | { state: 'LATE' }
  | { state: 'COVERED'; covered: Fils; source: 'HOLDBACK' | 'VACANCY' }
  | { state: 'WAIVED' };

export interface Slot {
  spot: number;
  /** Member currently responsible for this spot's contributions; null = vacant. */
  holderId: string | null;
  vacatedBy: string | null;
  /** Keyed by month (1..N). */
  months: Record<number, MonthState>;
}

/** Where a month's money went. Recipient null = a vacated spot's month. */
export interface MonthRecord {
  status: 'HELD' | 'DONE';
  recipientId: string | null;
  bidDue: Fils;
  holdbackDue: Fils;
  bidTaken: Fils;
  holdbackTaken: Fils;
  /** Sent to the recipient, or (vacant month) distributed to cover / refund. */
  out: Fils;
}

export interface CircleStats {
  organizingFees: Fils;
  replacementFees: Fils;
  bidRevenue: Fils;
  recoveryFees: Fils;
  latePenalties: Fils;
  defaulterPenaltiesToCharity: Fils;
  holdbacksApplied: Fils;
  holdbacksReleased: Fils;
  recoveries: Fils;
  topUps: Fils;
  refundsDue: Fils;
  catchUp: Fils;
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
  /** Months whose payout step has run (paid out, held, or distributed as a vacancy). */
  monthsSettled: number;
  heldPayouts: number[];
  monthRecords: Record<number, MonthRecord>;
  /** Counter for repeatable transactions (top-ups, refunds) to keep their keys unique. */
  seq: number;
  stats: CircleStats;
}

// ───────────────────────────── Events & effects ─────────────────────────────

export type CircleEvent =
  | { type: 'MEMBER_JOINED'; memberId: string; tier: Tier }
  | { type: 'MEMBER_LEFT'; memberId: string }
  | { type: 'CANCELLED' }
  | { type: 'AUCTION_STARTED'; at: string; commitment: string }
  | { type: 'BID_PLACED'; memberId: string; spot: number; amount: Fils; at: string }
  | { type: 'AUCTION_CLOSED'; at: string }
  | { type: 'DRAW_EXECUTED'; seed: string }
  | { type: 'CONTRIBUTION_PAID'; memberId: string; month: number; late: boolean }
  | { type: 'PAYOUT_DUE'; month: number }
  | { type: 'MEMBER_DEFAULTED'; memberId: string }
  | { type: 'REPLACEMENT_JOINED'; memberId: string; tier: Tier; spot: number }
  | { type: 'CLOSE' }
  /** A refund was sent. Without `amount`, everything still due is marked sent. */
  | { type: 'REFUND_PAID'; memberId: string; amount?: Fils; reference?: string }
  | { type: 'RECOVERY'; memberId: string; amount: Fils; reference: string };

export type CircleEffect =
  | { kind: 'PAYOUT_SENT'; memberId: string; month: number; amount: Fils }
  | { kind: 'TOP_UP_SENT'; memberId: string; month: number; amount: Fils }
  | { kind: 'PAYOUT_HELD'; memberId: string; month: number }
  | { kind: 'REFUND_DUE'; memberId: string; amount: Fils; reason: RefundReason }
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
  | { kind: 'CIRCLE_CLOSED'; summary: ClosingSummary };

export type RefundReason = 'PRE_PAYOUT_DEFAULT' | 'EXCESS_HOLDBACK' | 'EXCESS_PAYMENT';

export interface ClosingSummary {
  organizingFees: Fils;
  replacementFees: Fils;
  bidRevenue: Fils;
  recoveryFees: Fils;
  /** Sanad's revenue from this circle. */
  revenue: Fils;
  latePenaltiesToCharity: Fils;
  holdbacksApplied: Fils;
  holdbacksReleased: Fils;
  topUps: Fils;
  /** Money members are still short because of defaults (legal recovery continues). */
  shortfall: Fils;
}

export interface EventResult {
  state: CircleState;
  transactions: Transaction[];
  effects: CircleEffect[];
}

// ───────────────────────────── Creation ─────────────────────────────

const ZERO_STATS: CircleStats = {
  organizingFees: 0n,
  replacementFees: 0n,
  bidRevenue: 0n,
  recoveryFees: 0n,
  latePenalties: 0n,
  defaulterPenaltiesToCharity: 0n,
  holdbacksApplied: 0n,
  holdbacksReleased: 0n,
  recoveries: 0n,
  topUps: 0n,
  refundsDue: 0n,
  catchUp: 0n,
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
    monthRecords: {},
    seq: 0,
    stats: { ...ZERO_STATS },
  };
}

// ───────────────────────────── Reducer ─────────────────────────────

const minF = (a: Fils, b: Fils): Fils => (a < b ? a : b);

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

  get potAccount(): string {
    return ACCOUNTS.pot(this.s.circleId);
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

  /** Next value of the circle's counter for repeatable transactions. */
  next(): number {
    this.s.seq += 1;
    return this.s.seq;
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
      onClose(ctx);
      break;
    case 'REFUND_PAID':
      onRefundPaid(ctx, event.memberId, event.amount, event.reference);
      break;
    case 'RECOVERY':
      onRecovery(ctx, event.memberId, event.amount, event.reference);
      break;
  }
  return { state: ctx.s, transactions: ctx.transactions, effects: ctx.effects };
}

// ── FORMING ──

function newMember(memberId: string, tier: Tier, fee: Fils): CircleMember {
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
    holdbackApplied: 0n,
    feePaid: fee,
    contributionsPaid: 0n,
    contributionsReturned: 0n,
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
  const fee = circleRules(ctx.config, s.monthly).organizingFee;
  s.members.push(newMember(memberId, tier, fee));
  ctx.post(
    'FEE_PAID',
    [memberId],
    [dr(ACCOUNTS.gateway, fee, memberId), cr(ACCOUNTS.feesHeld(s.circleId), fee, memberId)],
    { memberId },
  );
}

function refundHeldFee(ctx: Ctx, m: CircleMember): void {
  ctx.post(
    'FEE_REFUNDED',
    [m.memberId],
    [
      dr(ACCOUNTS.feesHeld(ctx.s.circleId), m.feePaid, m.memberId),
      cr(ACCOUNTS.gateway, m.feePaid, m.memberId),
    ],
    { memberId: m.memberId },
  );
  m.status = 'LEFT';
  m.feePaid = 0n;
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
  s.commitment = e.commitment;
  s.auction = startAuction({
    startedAt: e.at,
    durationMs: a.auctionDurationHours * 3_600_000,
    minIncrement: circleRules(ctx.config, s.monthly).minIncrement,
    antiSnipeMs: a.antiSnipeMinutes * 60_000,
    minBids: Array.from({ length: s.p }, (_, i) => minBidForSpot(ctx.config, s.monthly, i + 1)),
  });
  s.status = 'AUCTION';
}

function onBid(ctx: Ctx, e: Extract<CircleEvent, { type: 'BID_PLACED' }>): void {
  const s = ctx.s;
  requireStatus(s, 'AUCTION');
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
  // The organising work is done: the held fees become Sanad's revenue.
  const fees = queued.reduce((acc, m) => acc + m.feePaid, 0n);
  ctx.post(
    'FEE_EARNED',
    ['all'],
    [dr(ACCOUNTS.feesHeld(s.circleId), fees), cr(ACCOUNTS.revenue, fees)],
  );
  s.stats.organizingFees += fees;
  s.status = 'ACTIVE';
}

// ── Month money ──

/** Money credited to `month`: every PAID cell plus the covered part of COVERED cells. */
export function monthCredits(s: CircleState, month: number): Fils {
  let total = 0n;
  for (const sl of s.slots) {
    const st = sl.months[month];
    if (st?.state === 'PAID') total += s.monthly;
    else if (st?.state === 'COVERED') total += st.covered;
  }
  return total;
}

function monthOut(r: MonthRecord): Fils {
  return r.bidTaken + r.holdbackTaken + r.out;
}

/**
 * Hand out any money credited to a month beyond what already left it. For a paid-out month
 * it goes to the bid, then the holdback, then the recipient (payout, or top-up later). For a
 * vacated spot's month it covers that spot's missing months and then refunds the defaulter.
 */
function settleMonth(ctx: Ctx, month: number): void {
  const s = ctx.s;
  const r = s.monthRecords[month];
  if (r === undefined || r.status !== 'DONE') return;
  let delta = monthCredits(s, month) - monthOut(r);
  invariant(delta >= 0n, 'MONTH_OVERDRAWN', `month ${month} paid out more than it collected`);
  if (delta === 0n) return;
  if (r.recipientId === null) {
    r.out += delta;
    distributeVacancyMoney(ctx, month, delta);
    return;
  }
  const id = r.recipientId;
  const recipient = ctx.member(id);
  const potAcc = ctx.potAccount;
  const bid = minF(delta, r.bidDue - r.bidTaken);
  if (bid > 0n) {
    ctx.post(
      'BID_REVENUE',
      [month, ctx.next()],
      [dr(potAcc, bid, id), cr(ACCOUNTS.revenue, bid, id)],
      {
        memberId: id,
        month,
      },
    );
    r.bidTaken += bid;
    s.stats.bidRevenue += bid;
    delta -= bid;
  }
  // A recipient who has since defaulted keeps no holdback: it all pays down what they owe.
  const defaulted = recipient.status === 'DEFAULTED_POST_PAYOUT';
  const hb = defaulted ? 0n : minF(delta, r.holdbackDue - r.holdbackTaken);
  if (hb > 0n) {
    ctx.post(
      'HOLDBACK_HELD',
      [month, ctx.next()],
      [dr(potAcc, hb, id), cr(ACCOUNTS.holdbacks, hb, id)],
      {
        memberId: id,
        month,
      },
    );
    r.holdbackTaken += hb;
    recipient.holdbackHeld += hb;
    delta -= hb;
  }
  if (delta === 0n) return;
  r.out += delta;
  if (defaulted) {
    // The recipient owes the group: their late-arriving share pays down what they owe.
    offsetClaim(ctx, recipient, delta, 'pot');
    return;
  }
  const first = recipient.payoutAmount === 0n;
  ctx.post(
    first ? 'PAYOUT' : 'TOP_UP',
    first ? [month] : [month, ctx.next()],
    [dr(potAcc, delta, id), cr(ACCOUNTS.gateway, delta, id)],
    { memberId: id, month },
  );
  recipient.payoutAmount += delta;
  if (first) {
    ctx.effects.push({ kind: 'PAYOUT_SENT', memberId: id, month, amount: delta });
  } else {
    s.stats.topUps += delta;
    ctx.effects.push({ kind: 'TOP_UP_SENT', memberId: id, month, amount: delta });
  }
}

/** Run the payout step for a month whose recipient is known (or vacant). */
function payOut(ctx: Ctx, month: number): void {
  const s = ctx.s;
  const holderId = ctx.slot(month).holderId;
  const recipient = holderId === null ? null : ctx.member(holderId);
  s.monthRecords[month] = {
    status: 'DONE',
    recipientId: holderId,
    bidDue: recipient?.bid ?? 0n,
    holdbackDue: recipient ? holdbackAmount(ctx.pot, recipient.holdbackBps) : 0n,
    bidTaken: 0n,
    holdbackTaken: 0n,
    out: 0n,
  };
  if (recipient) recipient.receivedPayout = true;
  settleMonth(ctx, month);
}

/** Split `amount` as equally as possible over cells, never filling a cell beyond M. */
function spreadOver(
  ctx: Ctx,
  cells: { month: number; cell: Extract<MonthState, { state: 'COVERED' }> }[],
  amount: Fils,
): Fils {
  const M = ctx.s.monthly;
  let left = amount;
  let open = cells.filter((c) => c.cell.covered < M);
  while (left > 0n && open.length > 0) {
    const k = BigInt(open.length);
    const share = left / k;
    const rem = left % k;
    open.forEach((c, i) => {
      const want = share + (BigInt(i) < rem ? 1n : 0n);
      const give = minF(want, M - c.cell.covered);
      c.cell.covered += give;
      left -= give;
    });
    open = open.filter((c) => c.cell.covered < M);
  }
  return amount - left;
}

/**
 * Does money for this month still reach someone in the group? Not when the month was a vacated
 * spot's (nobody receives it) or its recipient has since defaulted (it would only pay down
 * their own debt). Such months are never topped up, which also keeps money from circling.
 */
export function needsCover(s: CircleState, month: number): boolean {
  const r = s.monthRecords[month];
  if (r === undefined || r.status !== 'DONE') return true;
  if (r.recipientId === null) return false;
  return s.members.find((m) => m.memberId === r.recipientId)?.status === 'ACTIVE';
}

function holdbackCells(s: CircleState, memberId: string) {
  const sl = s.slots.find((x) => x.holderId === memberId);
  if (!sl) return [];
  return Object.entries(sl.months)
    .map(([mo, cell]) => ({ month: Number(mo), cell }))
    .filter(
      (c): c is { month: number; cell: Extract<MonthState, { state: 'COVERED' }> } =>
        c.cell.state === 'COVERED' && c.cell.source === 'HOLDBACK' && needsCover(s, c.month),
    )
    .sort((a, b) => a.month - b.month);
}

function settleAll(ctx: Ctx, months: Iterable<number>): void {
  for (const mo of [...new Set(months)].sort((a, b) => a - b)) settleMonth(ctx, mo);
}

/**
 * Money already in the pot (or the holdbacks account) put towards what a post-payout defaulter
 * owes: spread equally over their unpaid months; anything beyond is refunded to them.
 */
function offsetClaim(ctx: Ctx, m: CircleMember, amount: Fils, from: 'pot' | 'holdbacks'): Fils {
  const s = ctx.s;
  const cells = holdbackCells(s, m.memberId);
  const applied = spreadOver(ctx, cells, amount);
  if (from === 'holdbacks') {
    ctx.post(
      'HOLDBACK_APPLIED',
      [m.memberId, ctx.next()],
      [dr(ACCOUNTS.holdbacks, amount, m.memberId), cr(ctx.potAccount, amount, m.memberId)],
      { memberId: m.memberId },
    );
    m.holdbackApplied += applied;
    s.stats.holdbacksApplied += applied;
  } else {
    ctx.post(
      'RECOVERY',
      [m.memberId, 'offset', ctx.next()],
      [
        dr(ACCOUNTS.receivablesControl, applied, m.memberId),
        cr(ACCOUNTS.receivable(m.memberId), applied, m.memberId),
      ],
      { memberId: m.memberId, memo: 'their own late-arriving payout share, kept for the group' },
    );
    m.claimRecovered += applied;
  }
  const excess = amount - applied;
  if (excess > 0n) refundFromPot(ctx, m, excess, 'EXCESS_HOLDBACK', false);
  settleAll(
    ctx,
    cells.map((c) => c.month),
  );
  return applied;
}

/** Move money from the pot to refunds_payable for a member (optionally minus a penalty). */
function refundFromPot(
  ctx: Ctx,
  m: CircleMember,
  amount: Fils,
  reason: RefundReason,
  withPenalty: boolean,
): void {
  if (amount <= 0n) return;
  const s = ctx.s;
  const d = ctx.config.defaults;
  const penalty = withPenalty ? bpsOf(amount, BigInt(d.prePayoutDefaultPenaltyBps)) : 0n;
  const refund = amount - penalty;
  if (reason === 'PRE_PAYOUT_DEFAULT') m.contributionsReturned += amount;
  ctx.post(
    'REFUND_DUE',
    [m.memberId, ctx.next()],
    [
      dr(ctx.potAccount, amount, m.memberId),
      cr(ACCOUNTS.refunds, refund, m.memberId),
      cr(ACCOUNTS.charity, penalty, m.memberId),
    ],
    { memberId: m.memberId, memo: reason },
  );
  m.refundDue += refund;
  s.stats.refundsDue += refund;
  s.stats.defaulterPenaltiesToCharity += penalty;
  if (refund > 0n)
    ctx.effects.push({ kind: 'REFUND_DUE', memberId: m.memberId, amount: refund, reason });
}

/** Fill VACANCY cells (in month order) of the given slots; returns what is left. */
function fillVacancyCells(ctx: Ctx, slots: Slot[], amount: Fils, touched: number[]): Fils {
  const s = ctx.s;
  const M = s.monthly;
  let left = amount;
  for (let mo = 1; mo <= s.n && left > 0n; mo += 1) {
    if (!needsCover(s, mo)) continue;
    for (const sl of slots) {
      const cell = sl.months[mo];
      if (cell?.state !== 'COVERED' || cell.source !== 'VACANCY' || cell.covered >= M) continue;
      const give = minF(left, M - cell.covered);
      cell.covered += give;
      left -= give;
      touched.push(mo);
      if (left === 0n) break;
    }
  }
  return left;
}

/**
 * A vacated spot's month: its pot first fills that spot's missing months (forwarded to their
 * recipients if already paid out, otherwise kept for their payout); then it refunds the
 * defaulter's own contributions (minus the penalty, to charity). Anything beyond that — only
 * possible when several spots are vacant at once — repairs the other vacant spots' months,
 * and the last remainder goes back to the active members who paid it.
 */
function distributeVacancyMoney(ctx: Ctx, spot: number, amount: Fils): void {
  const sl = ctx.slot(spot);
  const touched: number[] = [];
  let left = fillVacancyCells(ctx, [sl], amount, touched);
  if (left > 0n && sl.vacatedBy !== null) {
    const d = ctx.member(sl.vacatedBy);
    const back = minF(left, d.contributionsPaid - d.contributionsReturned);
    refundFromPot(ctx, d, back, 'PRE_PAYOUT_DEFAULT', true);
    left -= back;
  }
  surplus(ctx, left, touched);
  settleAll(ctx, touched);
}

/** Pot money no longer tied to a month: repair any vacated spot's months, then give it back. */
function surplus(ctx: Ctx, amount: Fils, touched: number[]): void {
  if (amount <= 0n) return;
  shareAmongActive(ctx, fillVacancyCells(ctx, ctx.s.slots, amount, touched));
}

/** Money in the pot that no month can use any more: back to the active members, equally. */
function shareAmongActive(ctx: Ctx, amount: Fils): void {
  if (amount <= 0n) return;
  // Normally the active members; if every member has defaulted, whoever is left in the circle.
  const pick = (st: MemberStatus) => ctx.s.members.filter((m) => m.status === st);
  let active = pick('ACTIVE');
  /* v8 ignore next 2 -- only when every member has defaulted (covered by the property tests) */
  if (active.length === 0) active = pick('DEFAULTED_PRE_PAYOUT');
  if (active.length === 0) active = pick('DEFAULTED_POST_PAYOUT');
  invariant(active.length > 0, 'NO_MEMBERS', 'nobody to return money to');
  const k = BigInt(active.length);
  active.forEach((m, i) => {
    const share = amount / k + (BigInt(i) < amount % k ? 1n : 0n);
    refundFromPot(ctx, m, share, 'EXCESS_PAYMENT', false);
  });
}

function maybeEnterClosing(ctx: Ctx): void {
  const s = ctx.s;
  if (s.status === 'ACTIVE' && s.monthsSettled === s.n && s.heldPayouts.length === 0) {
    s.status = 'CLOSING';
    ctx.effects.push({ kind: 'CIRCLE_CLOSING' });
  }
}

// ── ACTIVE ──

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
  invariant(
    current === undefined || current.state === 'LATE',
    'ALREADY_PAID',
    `month ${month} is already settled for ${memberId}`,
  );
  const M = s.monthly;
  ctx.post(
    'CONTRIBUTION_PAID',
    [memberId, month],
    [dr(ACCOUNTS.gateway, M, memberId), cr(ctx.potAccount, M, memberId)],
    { memberId, month },
  );
  sl.months[month] = { state: 'PAID' };
  m.contributionsPaid += M;
  if (late) {
    m.latePayments += 1;
    const penalty = circleRules(ctx.config, M).latePenalty;
    ctx.post(
      'LATE_PENALTY',
      [memberId, month],
      [dr(ACCOUNTS.gateway, penalty, memberId), cr(ACCOUNTS.charity, penalty, memberId)],
      { memberId, month },
    );
    s.stats.latePenalties += penalty;
  }
  if (sl.spot === month && s.heldPayouts.includes(month)) {
    s.heldPayouts = s.heldPayouts.filter((x) => x !== month);
    payOut(ctx, month);
    maybeEnterClosing(ctx);
  } else {
    // A late payment for a month already paid out goes straight to its recipient.
    settleMonth(ctx, month);
  }
}

function onPayoutDue(ctx: Ctx, month: number): void {
  const s = ctx.s;
  requireStatus(s, 'ACTIVE');
  invariant(
    month === s.monthsSettled + 1,
    'OUT_OF_ORDER',
    `next payout is month ${s.monthsSettled + 1}`,
  );
  for (const sl of s.slots) {
    if (sl.spot === month || sl.months[month] !== undefined) continue;
    // Only active holders reach here: defaulted and vacated spots are already COVERED.
    sl.months[month] = { state: 'LATE' };
  }
  const receiverSlot = ctx.slot(month);
  if (receiverSlot.holderId !== null && receiverSlot.months[month] === undefined) {
    // The recipient has not paid their own month: hold their payout until they do.
    s.heldPayouts.push(month);
    s.monthRecords[month] = {
      status: 'HELD',
      recipientId: receiverSlot.holderId,
      bidDue: 0n,
      holdbackDue: 0n,
      bidTaken: 0n,
      holdbackTaken: 0n,
      out: 0n,
    };
    ctx.effects.push({ kind: 'PAYOUT_HELD', memberId: receiverSlot.holderId, month });
  } else {
    payOut(ctx, month);
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
  const late = Object.values(sl.months).some((x) => x.state === 'LATE');
  const held = s.heldPayouts.includes(sl.spot);
  invariant(late || held, 'NOTHING_OVERDUE', `${memberId} has no overdue contribution`);
  const M = s.monthly;

  if (m.receivedPayout) {
    m.status = 'DEFAULTED_POST_PAYOUT';
    // Everything still owed: late months plus all months not yet due.
    let owed = 0;
    for (let mo = 1; mo <= s.n; mo += 1) {
      const st = sl.months[mo];
      if (st === undefined || st.state === 'LATE') {
        sl.months[mo] = { state: 'COVERED', covered: 0n, source: 'HOLDBACK' };
        owed += 1;
      }
    }
    const gross = M * BigInt(owed);
    m.claimGross = gross;
    const hb = m.holdbackHeld;
    m.holdbackHeld = 0n;
    const applied = hb > 0n ? offsetClaim(ctx, m, hb, 'holdbacks') : 0n;
    const net = gross - applied;
    ctx.post(
      'CLAIM_OPENED',
      [memberId],
      [
        dr(ACCOUNTS.receivable(memberId), net, memberId),
        cr(ACCOUNTS.receivablesControl, net, memberId),
      ],
      { memberId, memo: 'owed to the group after defaulting' },
    );
    ctx.effects.push({ kind: 'MEMBER_BANNED', memberId, reason: 'POST_PAYOUT_DEFAULT' });
    ctx.effects.push({
      kind: 'LEGAL_CASE_OPENED',
      memberId,
      grossOwed: gross,
      holdbackApplied: applied,
      netClaim: net,
    });
    return;
  }

  m.status = 'DEFAULTED_PRE_PAYOUT';
  sl.holderId = null;
  sl.vacatedBy = memberId;
  for (let mo = 1; mo <= s.n; mo += 1) {
    const st = sl.months[mo];
    if (mo === sl.spot) {
      if (st === undefined) sl.months[mo] = { state: 'WAIVED' };
    } else if (st === undefined || st.state === 'LATE') {
      sl.months[mo] = { state: 'COVERED', covered: 0n, source: 'VACANCY' };
    }
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
  if (held) {
    // Their own month was already due: its pot is distributed now.
    s.heldPayouts = s.heldPayouts.filter((x) => x !== sl.spot);
    payOut(ctx, sl.spot);
  }
  maybeEnterClosing(ctx);
}

/** Can `spot` still take a replacement member? */
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

/** What a replacement pays to take over `spot` now (catch-up + replacement fee). */
export function replacementCost(
  state: CircleState,
  config: SanadConfig,
  spot: number,
): { catchUp: Fils; fee: Fils; months: number } {
  const sl = state.slots.find((x) => x.spot === spot);
  invariant(sl !== undefined, 'INVALID_SPOT', `spot ${spot} does not exist`);
  let months = 0;
  for (let mo = 1; mo <= state.n; mo += 1) {
    const st = sl.months[mo];
    if (mo <= state.monthsSettled || st?.state === 'PAID') months += 1;
  }
  return {
    catchUp: state.monthly * BigInt(months),
    fee: circleRules(config, state.monthly).replacementFee,
    months,
  };
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
  const { catchUp, fee, months } = replacementCost(s, ctx.config, spot);
  const m = newMember(memberId, tier, fee);
  m.status = 'ACTIVE';
  m.isReplacement = true;
  m.replacesMemberId = sl.vacatedBy;
  m.spot = spot;
  m.holdbackBps = holdbackBps(ctx.config, tier, spot);
  s.members.push(m);
  ctx.post(
    'REPLACEMENT_FEE',
    [memberId],
    [dr(ACCOUNTS.gateway, fee, memberId), cr(ACCOUNTS.revenue, fee, memberId)],
    { memberId },
  );
  s.stats.replacementFees += fee;
  ctx.post(
    'CATCH_UP',
    [memberId],
    [dr(ACCOUNTS.gateway, catchUp, memberId), cr(ctx.potAccount, catchUp, memberId)],
    { memberId, memo: `replacement catch-up for ${months} month(s)` },
  );
  m.contributionsPaid += catchUp;
  s.stats.catchUp += catchUp;

  // Months the defaulter had paid: the replacement buys them out (refund to the defaulter).
  // Months already paid out without this spot's money: forwarded to their recipients.
  let defaulterMonths = 0;
  const topUps: number[] = [];
  // Cover already given to this spot's months (from another vacancy) is no longer needed.
  let released = 0n;
  const kept: Record<number, MonthState> = {};
  for (let mo = 1; mo <= s.n; mo += 1) {
    const st = sl.months[mo];
    if (st?.state === 'COVERED') released += st.covered;
    if (st?.state === 'PAID') {
      defaulterMonths += 1;
      kept[mo] = st;
    } else if (mo <= s.monthsSettled) {
      kept[mo] = { state: 'PAID' };
      topUps.push(mo);
    }
    // Later months are cleared: the replacement pays them.
  }
  sl.months = kept;
  sl.holderId = memberId;
  // canReplace guarantees the spot was vacated by a defaulter.
  refundFromPot(
    ctx,
    ctx.member(sl.vacatedBy as string),
    s.monthly * BigInt(defaulterMonths),
    'PRE_PAYOUT_DEFAULT',
    true,
  );
  surplus(ctx, released, topUps);
  settleAll(ctx, topUps);
}

// ── CLOSING ──

/** Fils members are still short because a defaulter's months were not (fully) covered. */
export function circleShortfall(state: CircleState): Fils {
  let total = 0n;
  for (const sl of state.slots)
    for (const [mo, st] of Object.entries(sl.months))
      if (st.state === 'COVERED' && needsCover(state, Number(mo)))
        total += state.monthly - st.covered;
  return total;
}

function onClose(ctx: Ctx): void {
  const s = ctx.s;
  requireStatus(s, 'CLOSING');
  for (const sl of s.slots) {
    for (let mo = 1; mo <= s.n; mo += 1) {
      const st = sl.months[mo];
      invariant(
        st !== undefined && st.state !== 'LATE',
        'MEMBER_UNRESOLVED',
        `spot ${sl.spot} owes month ${mo}: record payment or default before closing`,
      );
    }
  }
  for (const m of s.members) {
    if (m.status !== 'ACTIVE' || m.holdbackHeld === 0n) continue;
    ctx.post(
      'HOLDBACK_RELEASED',
      [m.memberId],
      [
        dr(ACCOUNTS.holdbacks, m.holdbackHeld, m.memberId),
        cr(ACCOUNTS.gateway, m.holdbackHeld, m.memberId),
      ],
      { memberId: m.memberId },
    );
    s.stats.holdbacksReleased += m.holdbackHeld;
    m.holdbackHeld = 0n;
  }
  s.status = 'CLOSED';
  ctx.effects.push({ kind: 'CIRCLE_CLOSED', summary: closingSummary(s) });
}

export function closingSummary(s: CircleState): ClosingSummary {
  const st = s.stats;
  return {
    organizingFees: st.organizingFees,
    replacementFees: st.replacementFees,
    bidRevenue: st.bidRevenue,
    recoveryFees: st.recoveryFees,
    revenue: circleRevenue(st),
    latePenaltiesToCharity: st.latePenalties + st.defaulterPenaltiesToCharity,
    holdbacksApplied: st.holdbacksApplied,
    holdbacksReleased: st.holdbacksReleased,
    topUps: st.topUps,
    shortfall: circleShortfall(s),
  };
}

/** Sanad's revenue from a circle so far. */
export function circleRevenue(st: CircleStats): Fils {
  return st.organizingFees + st.replacementFees + st.bidRevenue + st.recoveryFees;
}

function onRefundPaid(ctx: Ctx, memberId: string, amount?: Fils, reference?: string): void {
  const m = ctx.member(memberId);
  const due = m.refundDue - m.refundPaid;
  invariant(due > 0n, 'NOTHING_DUE', `no refund due to ${memberId}`);
  const paid = amount ?? due;
  invariant(paid > 0n && paid <= due, 'INVALID_AMOUNT', `refund must be between 1 and ${due} fils`);
  if (reference !== undefined)
    invariant(/^[A-Za-z0-9_-]+$/.test(reference), 'INVALID_ID', 'reference must be [A-Za-z0-9_-]');
  ctx.post(
    'REFUND_PAID',
    [memberId, reference ?? ctx.next()],
    [dr(ACCOUNTS.refunds, paid, memberId), cr(ACCOUNTS.gateway, paid, memberId)],
    { memberId },
  );
  m.refundPaid += paid;
}

/** Open claim against a post-payout defaulter. */
export function openClaim(m: CircleMember): Fils {
  if (m.status !== 'DEFAULTED_POST_PAYOUT') return 0n;
  const open = m.claimGross - m.holdbackApplied - m.claimRecovered;
  return open > 0n ? open : 0n;
}

/**
 * Money recovered from a post-payout defaulter (legal case): the recovery fee goes to Sanad,
 * the rest is spread equally over the months they owed and forwarded to those recipients.
 */
function onRecovery(ctx: Ctx, memberId: string, amount: Fils, reference: string): void {
  const s = ctx.s;
  requireStatus(s, 'ACTIVE', 'CLOSING', 'CLOSED');
  const m = ctx.member(memberId);
  invariant(
    m.status === 'DEFAULTED_POST_PAYOUT',
    'INVALID_STATE',
    'recoveries apply to post-payout defaulters',
  );
  invariant(/^[A-Za-z0-9_-]+$/.test(reference), 'INVALID_ID', 'reference must be [A-Za-z0-9_-]');
  const open = openClaim(m);
  invariant(
    amount > 0n && amount <= open,
    'INVALID_AMOUNT',
    `recovery must be between 1 and ${open} fils`,
  );
  const fee = recoveryFee(ctx.config, amount);
  const net = amount - fee;
  ctx.post(
    'RECOVERY',
    [memberId, reference],
    [
      dr(ACCOUNTS.gateway, amount, memberId),
      cr(ACCOUNTS.revenue, fee, memberId),
      cr(ctx.potAccount, net, memberId),
      dr(ACCOUNTS.receivablesControl, amount, memberId),
      cr(ACCOUNTS.receivable(memberId), amount, memberId),
    ],
    { memberId },
  );
  s.stats.recoveryFees += fee;
  s.stats.recoveries += amount;
  const cells = holdbackCells(s, memberId);
  const applied = spreadOver(ctx, cells, net);
  m.claimRecovered += amount;
  // Months whose recipient no longer needs it (vacated or defaulted): shared among the rest.
  const touched = cells.map((c) => c.month);
  surplus(ctx, net - applied, touched);
  settleAll(ctx, touched);
}

// ───────────────────────────── Queries ─────────────────────────────

/** Running amount a member owes: late months, or the open claim after a default. */
export function amountOwed(state: CircleState, memberId: string): Fils {
  const m = state.members.find((x) => x.memberId === memberId);
  if (!m) return 0n;
  if (m.status === 'DEFAULTED_POST_PAYOUT') return openClaim(m);
  const sl = state.slots.find((x) => x.holderId === memberId);
  if (!sl) return 0n;
  const late = Object.values(sl.months).filter((x) => x.state === 'LATE').length;
  return state.monthly * BigInt(late);
}
