import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { DbService } from '../db/db.service.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: ClockService,
  ) {}

  async check() {
    let database: 'up' | 'down' = 'up';
    try {
      await this.dbs.db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? ('ok' as const) : ('degraded' as const),
      service: 'sanad-api' as const,
      time: this.clock.now().toISOString(),
      kuwaitDate: this.clock.today(),
      businessTimezone: 'Asia/Kuwait' as const,
      database,
    };
  }
}
