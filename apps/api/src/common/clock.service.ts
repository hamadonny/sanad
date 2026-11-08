import { Injectable } from '@nestjs/common';
import { kuwaitDate } from '@sanad/core';

/** Single source of "now" so tests and simulations can move time. */
@Injectable()
export class ClockService {
  private fixed: Date | null = null;

  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  /** Asia/Kuwait calendar date (YYYY-MM-DD). */
  today(): string {
    return kuwaitDate(this.now());
  }

  /** Test helper: freeze time. Pass null to return to the real clock. */
  set(at: Date | string | null): void {
    this.fixed = at === null ? null : new Date(at);
  }

  advance(ms: number): void {
    this.fixed = new Date(this.now().getTime() + ms);
  }
}
