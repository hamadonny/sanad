/** Exposure, fund ratio, circuit breaker, minimum reserve, release blocking (spec §5.9, §5.12). */
import type { SanadConfig } from '@sanad/config';
import { BPS_DENOMINATOR, bpsOf, kwd, type BasisPoints, type Fils } from './money.js';

/**
 * Fund ratio in basis points (fund ÷ exposure × 10,000), rounded down.
 * `null` when there is no exposure (ratio is effectively infinite).
 */
export function fundRatioBps(fund: Fils, exposure: Fils): BasisPoints | null {
  if (exposure <= 0n) return null;
  if (fund <= 0n) return 0n;
  return (fund * BPS_DENOMINATOR) / exposure;
}

/** max(reserveFloor, minFundRatio × exposure). */
export function minimumReserve(config: SanadConfig, exposure: Fils): Fils {
  const floor = kwd(config.risk.reserveFloorKwd);
  const byRatio = bpsOf(exposure > 0n ? exposure : 0n, BigInt(config.risk.minFundRatioBps));
  return floor > byRatio ? floor : byRatio;
}

export type BreakerState = 'NORMAL' | 'TRIPPED';

/** Hysteresis: trip below minFundRatio, resume only at/above resumeFundRatio. */
export function nextBreakerState(
  config: SanadConfig,
  current: BreakerState,
  ratio: BasisPoints | null,
): BreakerState {
  if (ratio === null) return 'NORMAL';
  if (current === 'NORMAL')
    return ratio < BigInt(config.risk.minFundRatioBps) ? 'TRIPPED' : 'NORMAL';
  return ratio >= BigInt(config.risk.resumeFundRatioBps) ? 'NORMAL' : 'TRIPPED';
}

export interface BreakerRestrictions {
  priorityAuctionsPaused: boolean;
  /** New circles above this monthly amount are paused; null = no limit. */
  maxNewCircleMonthly: Fils | null;
  alertRoles: readonly ('super_admin' | 'finance')[];
}

export function breakerRestrictions(config: SanadConfig, state: BreakerState): BreakerRestrictions {
  return state === 'TRIPPED'
    ? {
        priorityAuctionsPaused: true,
        maxNewCircleMonthly: kwd(config.risk.breakerMaxMonthlyKwd),
        alertRoles: ['super_admin', 'finance'],
      }
    : { priorityAuctionsPaused: false, maxNewCircleMonthly: null, alertRoles: [] };
}

/**
 * Revenue release that may happen now without taking the fund below the minimum reserve.
 * `fund` is the pool balance BEFORE the release. Anything not released stays in the fund
 * and is retried at the next closing.
 */
export function releasable(due: Fils, fund: Fils, reserve: Fils): { release: Fils; blocked: Fils } {
  if (due <= 0n) return { release: 0n, blocked: 0n };
  const headroom = fund - reserve;
  const release = headroom <= 0n ? 0n : headroom < due ? headroom : due;
  return { release, blocked: due - release };
}
