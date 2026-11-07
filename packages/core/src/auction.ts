/**
 * Priority-spot auction (spec §5.6). Open ascending auction, one auction per priority spot.
 *
 * Rules implemented here:
 * - A bid must be ≥ the spot's minimum (first bid) or ≥ highest + minimum increment.
 * - A bid may not exceed `maxAmount` (Pot − the bidder's holdback), so payouts never go negative.
 * - A member may lead/hold active bids on only ONE spot. Bidding on another spot withdraws all
 *   their active bids elsewhere; the withdrawn spot falls back to its next-highest active bid.
 * - A member who already won a closed spot cannot bid on another spot.
 * - Anti-sniping: a bid placed within `antiSnipeMs` of a spot's end extends that spot's end by
 *   `antiSnipeMs` (end := end + antiSnipe).
 * - Bidder identity is never exposed through `publicView()`.
 *
 * Eligibility (tier, circuit breaker) is decided by the caller and passed in.
 */
import { RuleError, invariant } from './errors.js';
import type { Fils } from './money.js';

export interface Bid {
  seq: number;
  memberId: string;
  spot: number;
  amount: Fils;
  /** ISO instant. */
  at: string;
  active: boolean;
}

export interface SpotAuction {
  spot: number;
  /** ISO instant; bids at or after this are rejected. */
  endsAt: string;
  minBid: Fils;
}

export interface AuctionState {
  startedAt: string;
  minIncrement: Fils;
  antiSnipeMs: number;
  spots: SpotAuction[];
  bids: Bid[];
}

export function startAuction(params: {
  startedAt: string;
  durationMs: number;
  minIncrement: Fils;
  antiSnipeMs: number;
  minBids: readonly Fils[];
}): AuctionState {
  const endsAt = new Date(Date.parse(params.startedAt) + params.durationMs).toISOString();
  return {
    startedAt: params.startedAt,
    minIncrement: params.minIncrement,
    antiSnipeMs: params.antiSnipeMs,
    spots: params.minBids.map((minBid, i) => ({ spot: i + 1, endsAt, minBid })),
    bids: [],
  };
}

function spotOf(state: AuctionState, spot: number): SpotAuction {
  const s = state.spots.find((x) => x.spot === spot);
  if (!s) throw new RuleError('NOT_PRIORITY_SPOT', `spot ${spot} is not in this auction`);
  return s;
}

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  invariant(!Number.isNaN(t), 'INVALID_TIME', `invalid instant "${iso}"`);
  return t;
};

export function isSpotClosed(state: AuctionState, spot: number, now: string): boolean {
  return ms(now) >= ms(spotOf(state, spot).endsAt);
}

export function isAuctionClosed(state: AuctionState, now: string): boolean {
  return state.spots.every((s) => ms(now) >= ms(s.endsAt));
}

/** Highest active bid on a spot (earliest wins ties, which increments make impossible anyway). */
export function leadingBid(state: AuctionState, spot: number): Bid | undefined {
  let best: Bid | undefined;
  for (const b of state.bids) {
    if (b.spot !== spot || !b.active) continue;
    if (!best || b.amount > best.amount) best = b;
  }
  return best;
}

export function minNextBid(state: AuctionState, spot: number): Fils {
  const lead = leadingBid(state, spot);
  return lead ? lead.amount + state.minIncrement : spotOf(state, spot).minBid;
}

export interface PlaceBid {
  memberId: string;
  spot: number;
  amount: Fils;
  at: string;
  /** Pot − this member's holdback for the spot. */
  maxAmount: Fils;
}

export function placeBid(state: AuctionState, bid: PlaceBid): AuctionState {
  const target = spotOf(state, bid.spot);
  const at = ms(bid.at);
  invariant(at >= ms(state.startedAt), 'AUCTION_NOT_STARTED', 'auction has not started');
  invariant(at < ms(target.endsAt), 'SPOT_CLOSED', `auction for spot ${bid.spot} has ended`);

  for (const s of state.spots) {
    if (s.spot === bid.spot) continue;
    const lead = leadingBid(state, s.spot);
    if (lead?.memberId === bid.memberId && at >= ms(s.endsAt)) {
      throw new RuleError('ALREADY_WON', `member already won spot ${s.spot}`);
    }
  }
  const lead = leadingBid(state, bid.spot);
  invariant(lead?.memberId !== bid.memberId, 'ALREADY_LEADING', 'member already leads this spot');
  const min = minNextBid(state, bid.spot);
  invariant(bid.amount >= min, 'BID_TOO_LOW', `bid must be at least ${min} fils`);
  invariant(bid.amount <= bid.maxAmount, 'BID_TOO_HIGH', 'bid cannot exceed pot minus holdback');

  const bids = state.bids.map((b) =>
    b.memberId === bid.memberId && b.active && b.spot !== bid.spot ? { ...b, active: false } : b,
  );
  bids.push({
    seq: state.bids.length + 1,
    memberId: bid.memberId,
    spot: bid.spot,
    amount: bid.amount,
    at: bid.at,
    active: true,
  });

  const extend = ms(target.endsAt) - at <= state.antiSnipeMs && state.antiSnipeMs > 0;
  const spots = state.spots.map((s) =>
    s.spot === bid.spot && extend
      ? { ...s, endsAt: new Date(ms(s.endsAt) + state.antiSnipeMs).toISOString() }
      : s,
  );
  return { ...state, bids, spots };
}

/** What members see: amounts and times only, never identities. */
export interface PublicSpotView {
  spot: number;
  highestBid: Fils | null;
  minNextBid: Fils;
  endsAt: string;
  closed: boolean;
}

export function publicView(state: AuctionState, now: string): PublicSpotView[] {
  return state.spots.map((s) => ({
    spot: s.spot,
    highestBid: leadingBid(state, s.spot)?.amount ?? null,
    minNextBid: minNextBid(state, s.spot),
    endsAt: s.endsAt,
    closed: isSpotClosed(state, s.spot, now),
  }));
}

export type MyBidStatus = 'NONE' | 'LEADING' | 'OUTBID' | 'WON' | 'LOST';

export function myStatus(
  state: AuctionState,
  memberId: string,
  spot: number,
  now: string,
): MyBidStatus {
  const mine = state.bids.some((b) => b.memberId === memberId && b.spot === spot && b.active);
  if (!mine) return 'NONE';
  const leading = leadingBid(state, spot)?.memberId === memberId;
  if (isSpotClosed(state, spot, now)) return leading ? 'WON' : 'LOST';
  return leading ? 'LEADING' : 'OUTBID';
}

export interface AuctionWinner {
  spot: number;
  memberId: string;
  amount: Fils;
}

/** Final winners. Requires every spot to be closed. */
export function auctionResults(state: AuctionState, now: string): AuctionWinner[] {
  invariant(isAuctionClosed(state, now), 'AUCTION_OPEN', 'auction is still open');
  const out: AuctionWinner[] = [];
  for (const s of state.spots) {
    const lead = leadingBid(state, s.spot);
    if (lead) out.push({ spot: s.spot, memberId: lead.memberId, amount: lead.amount });
  }
  return out;
}
