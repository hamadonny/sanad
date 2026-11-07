/**
 * @sanad/config — business-rule configuration (spec §5.13).
 *
 * Phase 0 skeleton: only the circle-shape parameters (§5.2). Phase 1 completes the schema
 * (fees, auction, refunds, grace periods, risk controls) and the versioning model.
 * Rule: business numbers are NEVER hard-coded elsewhere; they are read from a config version.
 */
import { z } from 'zod';

export const circleParamsSchema = z.object({
  /** Allowed monthly contributions M, in whole KWD. */
  allowedMonthlyAmountsKwd: z.array(z.number().int().positive()).min(1),
  /** Members per circle N (= number of months). Engine supports 4..24. */
  membersPerCircle: z.number().int().min(4).max(24),
  /** Priority (auctionable) spots P. */
  prioritySpots: z.number().int().min(0),
});

export const sanadConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    circle: circleParamsSchema,
  })
  .refine((c) => c.circle.prioritySpots < c.circle.membersPerCircle, {
    message: 'prioritySpots must be smaller than membersPerCircle',
    path: ['circle', 'prioritySpots'],
  });

export type SanadConfig = z.infer<typeof sanadConfigSchema>;

/** Launch defaults from the spec. */
export const defaultConfig: SanadConfig = {
  schemaVersion: 1,
  circle: {
    allowedMonthlyAmountsKwd: [50, 100, 250, 500],
    membersPerCircle: 10,
    prioritySpots: 3,
  },
};

/** Validate an unknown value as a config; throws a ZodError with details on failure. */
export function parseConfig(input: unknown): SanadConfig {
  return sanadConfigSchema.parse(input);
}
