/** Trust tiers and join eligibility (spec §5.12, §7). */
import type { SanadConfig } from '@sanad/config';
import { kwd, type Fils } from './money.js';
import { isAllowedMonthly, tierConfig, type Tier } from './rules.js';

export interface TrustProfile {
  completedCircles: number;
  /** Lifetime count of contributions paid after the grace period. */
  latePayments: number;
  defaults: number;
  /** Banned by a default or by an admin action. */
  banned: boolean;
}

export type TierResult = { kind: 'tier'; tier: Tier } | { kind: 'banned' };

/** Highest tier whose requirements the profile meets. Any default (or ban) → banned. */
export function computeTier(config: SanadConfig, profile: TrustProfile): TierResult {
  if (profile.banned || profile.defaults > 0) return { kind: 'banned' };
  for (const tier of [2, 1] as const) {
    const t = tierConfig(config, tier);
    const lateOk = t.maxLatePayments === null || profile.latePayments <= t.maxLatePayments;
    if (
      profile.completedCircles >= t.minCompletedCircles &&
      lateOk &&
      profile.defaults <= t.maxDefaults
    ) {
      return { kind: 'tier', tier };
    }
  }
  return { kind: 'tier', tier: 0 };
}

export function maxMonthlyForTier(config: SanadConfig, tier: Tier): Fils {
  return kwd(tierConfig(config, tier).maxMonthlyKwd);
}

export interface JoinRequest {
  profile: TrustProfile;
  monthly: Fils;
  activeCircles: number;
  identityVerified: boolean;
  contractSigned: boolean;
  /** YYYY-MM-DD (Asia/Kuwait). */
  civilIdExpiry: string;
  /** YYYY-MM-DD (Asia/Kuwait). */
  today: string;
}

export type JoinBlocker =
  | 'BANNED'
  | 'IDENTITY_NOT_VERIFIED'
  | 'CONTRACT_NOT_SIGNED'
  | 'CIVIL_ID_EXPIRED'
  | 'AMOUNT_NOT_OFFERED'
  | 'AMOUNT_ABOVE_TIER'
  | 'TOO_MANY_ACTIVE_CIRCLES';

/** All reasons a member cannot join a circle of `monthly`; empty = may join. */
export function joinBlockers(config: SanadConfig, req: JoinRequest): JoinBlocker[] {
  const out: JoinBlocker[] = [];
  const tier = computeTier(config, req.profile);
  if (tier.kind === 'banned') out.push('BANNED');
  if (!req.identityVerified) out.push('IDENTITY_NOT_VERIFIED');
  if (!req.contractSigned) out.push('CONTRACT_NOT_SIGNED');
  if (req.civilIdExpiry < req.today) out.push('CIVIL_ID_EXPIRED');
  if (!isAllowedMonthly(config, req.monthly)) out.push('AMOUNT_NOT_OFFERED');
  if (tier.kind === 'tier' && req.monthly > maxMonthlyForTier(config, tier.tier)) {
    out.push('AMOUNT_ABOVE_TIER');
  }
  if (req.activeCircles >= config.risk.maxActiveCircles) out.push('TOO_MANY_ACTIVE_CIRCLES');
  return out;
}
