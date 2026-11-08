import { Controller, ForbiddenException, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClockService } from '../common/clock.service.js';
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

  @Post('tick')
  @HttpCode(200)
  tick() {
    this.guard();
    return this.scheduler.tick();
  }
}
