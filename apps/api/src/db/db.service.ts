import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ENV, type Env } from '../config/env.js';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
/** A database handle that may be a transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: pg.Pool;
  readonly db: Db;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
    // An idle connection dropped by the server (restart, failover) must not crash the process;
    // the pool replaces it on the next query. Only the code is logged (no query parameters).
    this.pool.on('error', (e: Error & { code?: string }) =>
      new Logger('Db').warn(`idle database connection closed (${e.code ?? e.name})`),
    );
    this.db = drizzle(this.pool, { schema });
  }

  /** Run `fn` in a SERIALIZABLE-safe transaction (we lock rows explicitly where needed). */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
