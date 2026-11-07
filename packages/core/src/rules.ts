/**
 * Circle amounts derived from a config version (spec §5.2–5.8, §5.12).
 * Every percentage here is a ROUNDING POINT: results round down to the nearest fils (§5.1).
 */
import type { SanadConfig, TierId } from '@sanad/config';
import { invariant } from './errors.js';
import { bpsOf, kwd, type BasisPoints, type Fils } from './money.js';

export type Tier = TierId;

export interface CircleRules {
  /** Members = months. */
  readonly n: number;
  /** Priority (auctionable) spots 1..p. */
  readonly p: number;
  /** Monthly contribution M. */
  readonly monthly: Fils;
  /** N × M. */
  readonly pot: Fils;
  readonly entryFee: Fils;
  readonly minIncrement: Fils;
  readonly latePenalty: Fils;
}

/** Ceil of n × bps / 10,000 using integers only. */
function ceilShare(n: number, shareBps: number): number {
  return Math.floor((n * shareBps + 9_999) / 10_000);
}

export function circleRules(config: SanadConfig, monthly: Fils): CircleRules {
  const n = config.circle.membersPerCircle;
  invariant(monthly > 0n, 'INVALID_MONTHLY', 'monthly amount must be positive');
  return {
    n,
    p: config.circle.prioritySpots,
    monthly,
    pot: monthly * BigInt(n),
    entryFee: bpsOf(monthly, BigInt(config.entryFee.ofMonthlyBps)),
    minIncrement: bpsOf(monthly, BigInt(config.auction.minIncrementBps)),
    latePenalty: bpsOf(monthly, BigInt(config.contributions.latePenaltyBps)),
  };
}

/** Is `monthly` one of the configured amounts? */
export function isAllowedMonthly(config: SanadConfig, monthly: Fils): boolean {
  return config.circle.allowedMonthlyAmountsKwd.some((m) => kwd(m) === monthly);
}

export function isPrioritySpot(config: SanadConfig, spot: number): boolean {
  return spot >= 1 && spot <= config.circle.prioritySpots;
}

/** Minimum opening bid for a priority spot (§5.6). */
export function minBidForSpot(config: SanadConfig, monthly: Fils, spot: number): Fils {
  invariant(isPrioritySpot(config, spot), 'NOT_PRIORITY_SPOT', `spot ${spot} is not auctionable`);
  const bpsValue = config.auction.minBidBpsBySpot[spot - 1];
  invariant(bpsValue !== undefined, 'CONFIG', `no minimum bid configured for spot ${spot}`);
  return bpsOf(monthly, BigInt(bpsValue));
}

export function tierConfig(config: SanadConfig, tier: Tier) {
  const t = config.risk.tiers[tier];
  invariant(t !== undefined, 'CONFIG', `tier ${tier} missing from config`);
  return t;
}

/** Holdback share of the pot for a member of `tier` in `spot` (§5.12). 0 outside spots 1..P. */
export function holdbackBps(config: SanadConfig, tier: Tier, spot: number): BasisPoints {
  return isPrioritySpot(config, spot) ? BigInt(tierConfig(config, tier).holdbackBps) : 0n;
}

/** Holdback in fils for a pot and holdback share (rounded down; remainder is simply paid out). */
export function holdbackAmount(pot: Fils, bps: BasisPoints): Fils {
  return bpsOf(pot, bps);
}

/** May a member of this tier bid in priority auctions? (§5.6, `allowTier0Bidding`). */
export function canBid(config: SanadConfig, tier: Tier): boolean {
  if (tier === 0) return config.auction.allowTier0Bidding;
  return tierConfig(config, tier).canBid;
}

/**
 * Payout = Pot − priority bid − holdback (§5.5). Throws if that would be negative,
 * which the auction prevents by capping bids at Pot − holdback.
 */
export function payoutAmount(pot: Fils, bid: Fils, holdback: Fils): Fils {
  const amount = pot - bid - holdback;
  invariant(amount >= 0n, 'NEGATIVE_PAYOUT', 'bid + holdback exceed the pot');
  return amount;
}

/**
 * Completion-refund share of the entry fee for a spot (§5.8).
 * Uses the explicit table for N when configured, else the generic rule:
 * last ceil(30% × N) spots → 100%, the ceil(20% × N) before them → 50%, the rest → 0%.
 */
export function refundBpsForSpot(config: SanadConfig, n: number, spot: number): BasisPoints {
  invariant(spot >= 1 && spot <= n, 'INVALID_SPOT', `spot ${spot} outside 1..${n}`);
  const table = config.refunds.explicitTables[String(n)];
  if (table) {
    const v = table[spot - 1];
    invariant(v !== undefined, 'CONFIG', `refund table for N=${n} has no spot ${spot}`);
    return BigInt(v);
  }
  const full = ceilShare(n, config.refunds.fullRefundSpotShareBps);
  const partial = ceilShare(n, config.refunds.partialRefundSpotShareBps);
  if (spot > n - full) return 10_000n;
  if (spot > n - full - partial) return BigInt(config.refunds.partialRefundBps);
  return 0n;
}

/** Full refund table for N, index 0 = spot 1. */
export function refundTable(config: SanadConfig, n: number): BasisPoints[] {
  return Array.from({ length: n }, (_, i) => refundBpsForSpot(config, n, i + 1));
}

/**
 * Completion refund amount. [SHARIAH] invariant: never more than the entry fee paid.
 */
export function completionRefundAmount(entryFeePaid: Fils, refundBps: BasisPoints): Fils {
  const refund = bpsOf(entryFeePaid, refundBps);
  invariant(refund <= entryFeePaid, 'REFUND_EXCEEDS_FEE', 'refund cannot exceed the entry fee');
  return refund;
}
