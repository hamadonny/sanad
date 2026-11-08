import { seedFromBytes } from '@sanad/core';
import type { CryptoService } from '../common/crypto.service.js';

/**
 * Where draw seeds come from (spec §5.7). Production: 256 bits from the OS CSPRNG.
 * Tests and the demo seed script set `override` to reproduce the spec's worked examples.
 */
export interface SeedSource {
  next(ctx: { circleId: string; memberIds: readonly string[] }): string;
}

export const SEED_SOURCE = Symbol('SEED_SOURCE');

export class CryptoSeedSource implements SeedSource {
  /** Never set in production code paths; used only by `db:seed` for deterministic demos. */
  override: ((ctx: { circleId: string; memberIds: readonly string[] }) => string) | null = null;

  constructor(private readonly crypto: CryptoService) {}

  next(ctx: { circleId: string; memberIds: readonly string[] }): string {
    return this.override ? this.override(ctx) : seedFromBytes(this.crypto.randomBytes(32));
  }
}
