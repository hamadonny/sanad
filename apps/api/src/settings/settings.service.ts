import { Injectable } from '@nestjs/common';
import { defaultConfig, diffConfig, validateConfig, type SanadConfig } from '@sanad/config';
import { desc, eq, sql } from 'drizzle-orm';
import { unprocessable } from '../common/errors.js';
import { DbService, type Tx } from '../db/db.service.js';
import { configVersions, systemState } from '../db/schema.js';

export interface ActiveConfig {
  version: number;
  config: SanadConfig;
}

/** Versioned business config (spec §5.13) and small system state (e.g. circuit breaker). */
@Injectable()
export class SettingsService {
  private readonly cache = new Map<number, SanadConfig>();

  constructor(private readonly dbs: DbService) {}

  async ensureSeeded(tx: Tx = this.dbs.db): Promise<void> {
    await tx
      .insert(configVersions)
      .values({ version: 1, config: defaultConfig, notes: 'Launch defaults (spec §5)' })
      .onConflictDoNothing();
  }

  async active(tx: Tx = this.dbs.db): Promise<ActiveConfig> {
    const [row] = await tx
      .select()
      .from(configVersions)
      .orderBy(desc(configVersions.version))
      .limit(1);
    if (!row) {
      await this.ensureSeeded(tx);
      return this.active(tx);
    }
    const config = row.config as SanadConfig;
    this.cache.set(row.version, config);
    return { version: row.version, config };
  }

  /** Config a circle was created under — running circles never change rules (§5.13). */
  async byVersion(version: number, tx: Tx = this.dbs.db): Promise<SanadConfig> {
    const cached = this.cache.get(version);
    if (cached) return cached;
    const [row] = await tx.select().from(configVersions).where(eq(configVersions.version, version));
    if (!row) throw new Error(`config version ${version} missing`);
    const config = row.config as SanadConfig;
    this.cache.set(version, config);
    return config;
  }

  async publish(
    tx: Tx,
    input: unknown,
    adminId: string,
    notes: string | null,
  ): Promise<{ version: number; diff: ReturnType<typeof diffConfig> }> {
    const result = validateConfig(input);
    if (!result.ok) throw unprocessable('INVALID_CONFIG', result.issues.join('; '));
    const current = await this.active(tx);
    const diff = diffConfig(current.config, result.config);
    if (diff.length === 0)
      throw unprocessable('NO_CHANGES', 'config is identical to the active version');
    const version = current.version + 1;
    await tx
      .insert(configVersions)
      .values({ version, config: result.config, diff, notes, publishedBy: adminId });
    return { version, diff };
  }

  async getState<T>(key: string, fallback: T, tx: Tx = this.dbs.db): Promise<T> {
    const [row] = await tx.select().from(systemState).where(eq(systemState.key, key));
    return row ? (row.value as T) : fallback;
  }

  async setState(key: string, value: unknown, tx: Tx = this.dbs.db): Promise<void> {
    await tx
      .insert(systemState)
      .values({ key, value })
      .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: sql`now()` } });
  }
}
