/**
 * Payment schedule and installment status (spec §5.2, §5.4, §5.5, §5.10).
 *
 * All dates are calendar dates in Asia/Kuwait written as `YYYY-MM-DD`. Kuwait has no DST
 * (fixed UTC+3), so pure date arithmetic is exact. Converting instants to Kuwait dates is
 * done with `kuwaitDate()`.
 */
import type { SanadConfig } from '@sanad/config';
import { invariant } from './errors.js';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function parse(date: string): { y: number; m: number; d: number } {
  const match = DATE.exec(date);
  invariant(match, 'INVALID_DATE', `expected YYYY-MM-DD, got "${date}"`);
  const [, y, m, d] = match;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

function format(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

function toUtcMs(date: string): number {
  const { y, m, d } = parse(date);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return format(toUtcMs(date) + days * DAY_MS);
}

/** Same day-of-month `months` later. Caller guarantees day ≤ 28 so it always exists. */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parse(date);
  invariant(d <= 28, 'INVALID_DATE', 'addMonths() requires day ≤ 28');
  return format(Date.UTC(y, m - 1 + months, d));
}

/** Whole days from `a` to `b` (positive if b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** The Asia/Kuwait calendar date of an instant. */
export function kuwaitDate(instant: Date): string {
  return format(instant.getTime() + KUWAIT_OFFSET_MS);
}

export interface ScheduleRow {
  month: number;
  dueDate: string;
  /** Last day still within the grace period. */
  graceEndsOn: string;
  payoutDate: string;
  /** Unpaid on/after this date → DEFAULTED. */
  defaultsOn: string;
}

/** Due day = the circle's start day, capped at `maxDueDayOfMonth` (≤ 28). */
export function dueDayFor(config: SanadConfig, startDate: string): number {
  return Math.min(parse(startDate).d, config.circle.maxDueDayOfMonth);
}

/**
 * Rows for months 1..n. The first due date is the start date itself when its day ≤ the cap;
 * otherwise (e.g. a start on the 30th) the first due date is the cap day of the next month,
 * so it never falls before the start date.
 */
export function buildSchedule(config: SanadConfig, startDate: string, n: number): ScheduleRow[] {
  const { y, m, d } = parse(startDate);
  const dueDay = dueDayFor(config, startDate);
  const base = Date.UTC(y, m - 1 + (d > dueDay ? 1 : 0), dueDay);
  const first = format(base);
  const { gracePeriodDays, defaultThresholdDays } = config.contributions;
  return Array.from({ length: n }, (_, i) => {
    const dueDate = addMonths(first, i);
    return {
      month: i + 1,
      dueDate,
      graceEndsOn: addDays(dueDate, gracePeriodDays),
      payoutDate: addDays(dueDate, config.circle.payoutOffsetDays),
      defaultsOn: addDays(dueDate, defaultThresholdDays),
    };
  });
}

export type InstallmentStatus = 'UPCOMING' | 'DUE' | 'LATE' | 'DEFAULTED' | 'PAID' | 'PAID_LATE';

/**
 * Status of one installment.
 * - paid on/before graceEndsOn → PAID; paid later → PAID_LATE.
 * - unpaid: before due date → UPCOMING; due..graceEndsOn → DUE;
 *   after grace → LATE; from defaultsOn → DEFAULTED.
 */
export function installmentStatus(
  row: Pick<ScheduleRow, 'dueDate' | 'graceEndsOn' | 'defaultsOn'>,
  today: string,
  paidOn?: string,
): InstallmentStatus {
  if (paidOn !== undefined) return paidOn <= row.graceEndsOn ? 'PAID' : 'PAID_LATE';
  if (today < row.dueDate) return 'UPCOMING';
  if (today <= row.graceEndsOn) return 'DUE';
  if (today < row.defaultsOn) return 'LATE';
  return 'DEFAULTED';
}
