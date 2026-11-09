import { Controller, ForbiddenException, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { totpAt } from '../common/totp.js';
import { DbService } from '../db/db.service.js';
import { adminUsers } from '../db/schema.js';
import { ENV, type Env } from '../config/env.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { SMS_PROVIDER, type MockSmsProvider } from '../providers/messaging.provider.js';

/**
 * DEV ONLY helpers (disabled in production): read the mock SMS inbox to get OTP codes, and
 * run the scheduler — optionally "time-travelling" the API clock to test due dates, payouts
 * and defaults without waiting a month.
 */
@ApiTags('dev')
@Controller('dev')
export class DevController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SMS_PROVIDER) private readonly sms: MockSmsProvider,
    private readonly clock: ClockService,
    private readonly scheduler: SchedulerService,
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
  ) {}

  private guard(): void {
    if (!this.env.DEV_ENDPOINTS) throw new ForbiddenException('dev endpoints are disabled');
  }

  @Get('sms')
  inbox(@Query('phone') phone?: string) {
    this.guard();
    return this.sms.outbox.filter((m) => !phone || m.phone === phone).slice(-20);
  }

  @Get('clock')
  now() {
    this.guard();
    return { now: this.clock.now().toISOString(), kuwaitDate: this.clock.today() };
  }

  /** Move the API clock (ISO instant), or `reset=true` to return to real time. */
  @Post('clock')
  @HttpCode(200)
  setClock(@Query('at') at?: string, @Query('reset') reset?: string) {
    this.guard();
    if (reset === 'true') this.clock.set(null);
    else if (at) this.clock.set(at);
    return this.now();
  }

  /**
   * Current 2FA code for a dev admin account, so the dashboard can be tried without an
   * authenticator app. Dev only — production admins always use their authenticator.
   */
  @Get('admin-totp')
  async adminTotp(@Query('email') email?: string) {
    this.guard();
    const [a] = await this.dbs.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, (email ?? '').toLowerCase()));
    if (!a) return { code: null };
    return { code: totpAt(this.crypto.decrypt(a.totpSecretEncrypted), this.clock.now().getTime()) };
  }

  @Post('tick')
  @HttpCode(200)
  tick() {
    this.guard();
    return this.scheduler.tick();
  }
}
