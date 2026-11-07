/**
 * @sanad/config — business-rule configuration (spec §5.13).
 *
 * Conventions (JSON-friendly, no floats):
 * - Whole-KWD amounts end in `Kwd` (e.g. `reserveFloorKwd: 5000`).
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
});

export const entryFeeSchema = z.object({
  /** Entry fee as a share of M. Spec: one month's contribution (10,000 bps). [SHARIAH] */
  ofMonthlyBps: bps.min(1),
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

export const refundsSchema = z.object({
  /** LATE-but-paid contributions allowed while still qualifying for the completion refund. */
  maxLatePaymentsForRefund: z.number().int().min(0),
  /** Generic rule (when no explicit table for N): share of spots, counted from the end. */
  fullRefundSpotShareBps: bps,
  partialRefundSpotShareBps: bps,
  partialRefundBps: bps,
  /**
   * Optional explicit tables keyed by N (as a string, e.g. "10"). Value = refund bps per spot,
   * index 0 = spot 1. Must have exactly N entries. Every value ≤ 10,000 (refund ≤ entry fee).
   */
  explicitTables: z.record(z.string().regex(/^\d+$/), z.array(bps)),
});

export const defaultsSchema = z.object({
  /** Deducted from a pre-payout defaulter's refunded contributions. [LEGAL][SHARIAH] */
  prePayoutDefaultPenaltyBps: bps,
  /** Where that penalty goes. [LEGAL][SHARIAH] Defaults to charity, mirroring late penalties. */
  prePayoutDefaultPenaltyDestination: z.enum(['charity', 'fund']),
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
  /** Share of the pot held back on payouts for spots 1..P. */
  holdbackBps: bps,
  /** For tier 0 this is overridden by `auction.allowTier0Bidding`. */
  canBid: z.boolean(),
});

export const riskSchema = z.object({
  tiers: z.array(tierSchema).length(3),
  maxActiveCircles: z.number().int().positive(),
  /** Circuit breaker trips below this fund ratio (fund ÷ exposure). */
  minFundRatioBps: z.number().int().min(0),
  /** …and resumes at or above this one. Must be ≥ minFundRatioBps (hysteresis). */
  resumeFundRatioBps: z.number().int().min(0),
  reserveFloorKwd: z.number().int().min(0),
  /** While the breaker is tripped, new circles are limited to M ≤ this. */
  breakerMaxMonthlyKwd: kwd,
});

export const sanadConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    circle: circleSchema,
    entryFee: entryFeeSchema,
    contributions: contributionsSchema,
    auction: auctionSchema,
    refunds: refundsSchema,
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
    if (c.refunds.fullRefundSpotShareBps + c.refunds.partialRefundSpotShareBps > 10_000) {
      issue(['refunds'], 'full + partial refund spot shares cannot exceed 100%');
    }
    for (const [n, table] of Object.entries(c.refunds.explicitTables)) {
      if (table.length !== Number(n)) {
        issue(['refunds', 'explicitTables', n], `table for N=${n} must have ${n} entries`);
      }
    }
    if (c.risk.resumeFundRatioBps < c.risk.minFundRatioBps) {
      issue(['risk', 'resumeFundRatioBps'], 'resume ratio must be ≥ trip ratio');
    }
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
  schemaVersion: 1,
  circle: {
    allowedMonthlyAmountsKwd: [50, 100, 250, 500],
    membersPerCircle: 10,
    prioritySpots: 3,
    maxDueDayOfMonth: 28,
    formingTimeoutDays: 14,
    payoutOffsetDays: 5,
  },
  entryFee: { ofMonthlyBps: 10_000 },
  contributions: { gracePeriodDays: 3, defaultThresholdDays: 15, latePenaltyBps: 0 },
  auction: {
    auctionDurationHours: 48,
    minBidBpsBySpot: [3_000, 2_000, 1_000],
    minIncrementBps: 500,
    antiSnipeMinutes: 5,
    allowTier0Bidding: true,
  },
  refunds: {
    maxLatePaymentsForRefund: 2,
    fullRefundSpotShareBps: 3_000,
    partialRefundSpotShareBps: 2_000,
    partialRefundBps: 5_000,
    explicitTables: {
      '10': [0, 0, 0, 0, 0, 5_000, 5_000, 10_000, 10_000, 10_000],
    },
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
        holdbackBps: 1_000,
        canBid: false,
      },
      {
        tier: 1,
        minCompletedCircles: 1,
        maxLatePayments: 2,
        maxDefaults: 0,
        maxMonthlyKwd: 250,
        holdbackBps: 500,
        canBid: true,
      },
      {
        tier: 2,
        minCompletedCircles: 2,
        maxLatePayments: null,
        maxDefaults: 0,
        maxMonthlyKwd: 500,
        holdbackBps: 0,
        canBid: true,
      },
    ],
    maxActiveCircles: 2,
    minFundRatioBps: 2_500,
    resumeFundRatioBps: 3_500,
    reserveFloorKwd: 5_000,
    breakerMaxMonthlyKwd: 100,
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
