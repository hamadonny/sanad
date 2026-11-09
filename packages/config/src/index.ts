/**
 * @sanad/config — business-rule configuration (spec §5.13).
 *
 * Conventions (JSON-friendly, no floats):
 * - Whole-KWD amounts end in `Kwd` (e.g. `fastPayoutKwd: 2`).
 * - Percentages are integer **basis points** and end in `Bps` (10,000 = 100%, 500 = 5%).
 * - Durations carry their unit in the name (`Days`, `Hours`, `Minutes`, `Months`).
 *
 * Rule: business numbers are NEVER hard-coded elsewhere. Each circle stores the config version
 * it was created under, so publishing a new version never changes a running circle.
 */
import { z } from 'zod';

const bps = z.number().int().min(0).max(10_000);
const kwd = z.number().int().positive();
const tierId = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const circleSchema = z.object({
  /** Allowed monthly contributions M, in whole KWD. */
  allowedMonthlyAmountsKwd: z.array(kwd).min(1),
  /** Members per circle N (= number of months). Engine supports 4..24; MVP uses 10. */
  membersPerCircle: z.number().int().min(4).max(24),
  /** Priority (auctionable) spots P. */
  prioritySpots: z.number().int().min(0).max(23),
  /** Contribution due day = circle start day, capped at this value. */
  maxDueDayOfMonth: z.number().int().min(1).max(28),
  formingTimeoutDays: z.number().int().positive(),
  /** Payout for month k happens on dueDay + payoutOffsetDays. */
  payoutOffsetDays: z.number().int().min(0).max(27),
  /** Days between the draw and the circle's start date (= first due date, day capped at maxDueDayOfMonth). */
  firstDueAfterDrawDays: z.number().int().min(0).max(60),
});

/** Organising fee: Sanad's service fee for running the circle (D-017). [SHARIAH] */
export const organizingFeeSchema = z.object({
  /** Share of the pot (N × M) each member pays when joining. Launch: 3% (300 bps). */
  ofPotBps: bps.min(1),
});

/**
 * Additional fees (D-017 "D"). Amounts in whole KWD or bps of the pot. A fee whose feature is
 * not live yet is still settled here so the price list is fixed before launch.
 */
export const feesSchema = z.object({
  /** Paid by a member who takes over a vacated spot (on top of the catch-up months). */
  replacementOfPotBps: bps,
  /** Share of each amount recovered from a defaulter on the group's behalf. [SHARIAH] */
  recoveryOfRecoveredBps: bps,
  /** Paid by each of the two members who swap payout months. */
  spotExchangeOfPotBps: bps,
  /** Same-day payout instead of a standard transfer. */
  fastPayoutKwd: z.number().int().min(0),
  /** Setting up a private circle (friends, family, colleagues). */
  privateCircleSetupKwd: z.number().int().min(0),
  /** Company circles: per employee per circle, paid by the employer. */
  companySeatKwd: z.number().int().min(0),
});

export const contributionsSchema = z.object({
  gracePeriodDays: z.number().int().min(0),
  defaultThresholdDays: z.number().int().positive(),
  /** Optional late penalty as share of M; always routed to charity, never revenue. [SHARIAH] */
  latePenaltyBps: bps,
});

export const auctionSchema = z.object({
  auctionDurationHours: z.number().int().positive(),
  /** Minimum opening bid per priority spot, as share of M. Index 0 = spot 1. */
  minBidBpsBySpot: z.array(bps.min(1)),
  /** Minimum raise over the current highest bid, as share of M. */
  minIncrementBps: bps.min(1),
  antiSnipeMinutes: z.number().int().min(0),
  /** [DECISION NEEDED → founder said YES on 2026-11-07] Tier-0 members may bid (holdback applies). */
  allowTier0Bidding: z.boolean(),
});

export const defaultsSchema = z.object({
  /** Deducted from a pre-payout defaulter's refunded contributions. [LEGAL][SHARIAH] */
  prePayoutDefaultPenaltyBps: bps,
  /** Where that penalty goes. [LEGAL][SHARIAH] Always charity: penalties are never revenue. */
  prePayoutDefaultPenaltyDestination: z.literal('charity'),
  banOnPrePayoutDefault: z.boolean(),
});

export const replacementSchema = z.object({
  /** A vacated spot can be refilled while (spot − monthsAlreadyPaidOut) ≥ this value. */
  replacementCutoffMonths: z.number().int().min(0),
});

export const tierSchema = z.object({
  tier: tierId,
  minCompletedCircles: z.number().int().min(0),
  /** null = no limit. */
  maxLatePayments: z.number().int().min(0).nullable(),
  maxDefaults: z.number().int().min(0),
  maxMonthlyKwd: kwd,
  /**
   * Share of the pot held back from payouts for spots 1..P. It is the member's own money,
   * returned at the end; if they stop paying it covers their missed months (D-017).
   */
  holdbackBps: bps,
  /** For tier 0 this is overridden by `auction.allowTier0Bidding`. */
  canBid: z.boolean(),
});

export const riskSchema = z.object({
  tiers: z.array(tierSchema).length(3),
  maxActiveCircles: z.number().int().positive(),
});

export const sanadConfigSchema = z
  .object({
    schemaVersion: z.literal(2),
    circle: circleSchema,
    organizingFee: organizingFeeSchema,
    fees: feesSchema,
    contributions: contributionsSchema,
    auction: auctionSchema,
    defaults: defaultsSchema,
    replacement: replacementSchema,
    risk: riskSchema,
  })
  .superRefine((c, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (c.circle.prioritySpots >= c.circle.membersPerCircle) {
      issue(['circle', 'prioritySpots'], 'prioritySpots must be smaller than membersPerCircle');
    }
    if (c.auction.minBidBpsBySpot.length !== c.circle.prioritySpots) {
      issue(['auction', 'minBidBpsBySpot'], 'needs exactly one minimum bid per priority spot');
    }
    if (c.contributions.gracePeriodDays >= c.contributions.defaultThresholdDays) {
      issue(['contributions', 'gracePeriodDays'], 'grace period must end before default threshold');
    }
    if (c.circle.payoutOffsetDays >= c.contributions.defaultThresholdDays) {
      issue(['circle', 'payoutOffsetDays'], 'payout must happen before the default threshold');
    }
    // A minimum bid (share of M) plus the largest holdback (share of the pot) must leave a payout.
    const n = c.circle.membersPerCircle;
    const maxHoldback = Math.max(...c.risk.tiers.map((t) => t.holdbackBps));
    c.auction.minBidBpsBySpot.forEach((b, i) => {
      if (b + maxHoldback * n >= 10_000 * n)
        issue(['auction', 'minBidBpsBySpot', i], 'minimum bid plus holdback leave no payout');
    });
    c.risk.tiers.forEach((t, i) => {
      if (t.tier !== i)
        issue(['risk', 'tiers', i, 'tier'], 'tiers must be listed in order 0, 1, 2');
    });
    const maxAllowed = Math.max(...c.risk.tiers.map((t) => t.maxMonthlyKwd));
    for (const m of c.circle.allowedMonthlyAmountsKwd) {
      if (m > maxAllowed) {
        issue(['circle', 'allowedMonthlyAmountsKwd'], `${m} KWD exceeds every tier's limit`);
      }
    }
  });

export type SanadConfig = z.infer<typeof sanadConfigSchema>;
export type TierConfig = z.infer<typeof tierSchema>;
export type TierId = z.infer<typeof tierId>;

/** Launch defaults from the spec (§5). */
export const defaultConfig: SanadConfig = {
  schemaVersion: 2,
  circle: {
    allowedMonthlyAmountsKwd: [50, 100, 250, 500],
    membersPerCircle: 10,
    prioritySpots: 3,
    maxDueDayOfMonth: 28,
    formingTimeoutDays: 14,
    payoutOffsetDays: 5,
    firstDueAfterDrawDays: 7,
  },
  organizingFee: { ofPotBps: 300 },
  fees: {
    replacementOfPotBps: 300,
    recoveryOfRecoveredBps: 1_000,
    spotExchangeOfPotBps: 100,
    fastPayoutKwd: 2,
    privateCircleSetupKwd: 5,
    companySeatKwd: 1,
  },
  contributions: { gracePeriodDays: 3, defaultThresholdDays: 15, latePenaltyBps: 0 },
  auction: {
    auctionDurationHours: 48,
    minBidBpsBySpot: [3_000, 2_000, 1_000],
    minIncrementBps: 500,
    antiSnipeMinutes: 5,
    allowTier0Bidding: true,
  },
  defaults: {
    prePayoutDefaultPenaltyBps: 0,
    prePayoutDefaultPenaltyDestination: 'charity',
    banOnPrePayoutDefault: true,
  },
  replacement: { replacementCutoffMonths: 2 },
  risk: {
    tiers: [
      {
        tier: 0,
        minCompletedCircles: 0,
        maxLatePayments: null,
        maxDefaults: 0,
        maxMonthlyKwd: 100,
        holdbackBps: 3_000,
        canBid: false,
      },
      {
        tier: 1,
        minCompletedCircles: 1,
        maxLatePayments: 2,
        maxDefaults: 0,
        maxMonthlyKwd: 250,
        holdbackBps: 2_500,
        canBid: true,
      },
      {
        tier: 2,
        minCompletedCircles: 2,
        maxLatePayments: null,
        maxDefaults: 0,
        maxMonthlyKwd: 500,
        holdbackBps: 2_000,
        canBid: true,
      },
    ],
    maxActiveCircles: 2,
  },
};

/** Validate an unknown value as a config; throws a ZodError with details on failure. */
export function parseConfig(input: unknown): SanadConfig {
  return sanadConfigSchema.parse(input);
}

/** Non-throwing variant for editors: returns human-readable issues. */
export function validateConfig(
  input: unknown,
): { ok: true; config: SanadConfig } | { ok: false; issues: string[] } {
  const result = sanadConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export interface ConfigDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

/** Leaf-level diff between two configs, for the audited admin diff preview (spec §10). */
export function diffConfig(before: unknown, after: unknown, prefix = ''): ConfigDiffEntry[] {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffConfig(before[k], after[k], prefix ? `${prefix}.${k}` : k));
  }
  return JSON.stringify(before) === JSON.stringify(after)
    ? []
    : [{ path: prefix || '(root)', before, after }];
}
