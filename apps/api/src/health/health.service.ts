import { Injectable } from '@nestjs/common';
import { defaultConfig } from '@sanad/config';
import { formatKwd, kwd } from '@sanad/core';

export interface HealthStatus {
  status: 'ok';
  service: 'sanad-api';
  time: string;
  businessTimezone: 'Asia/Kuwait';
  /** Proves the shared packages are wired in: smallest allowed monthly amount, formatted. */
  smallestMonthlyAmountKwd: string;
}

@Injectable()
export class HealthService {
  check(now: Date = new Date()): HealthStatus {
    const smallest = Math.min(...defaultConfig.circle.allowedMonthlyAmountsKwd);
    return {
      status: 'ok',
      service: 'sanad-api',
      time: now.toISOString(),
      businessTimezone: 'Asia/Kuwait',
      smallestMonthlyAmountKwd: formatKwd(kwd(smallest)),
    };
  }
}
