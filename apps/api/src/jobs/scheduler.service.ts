/**
 * The scheduler tick (spec §12): one idempotent pass over every open circle. Running it twice
 * at the same moment produces the same result as running it once — every step checks the
 * circle state first, and ledger/notification/payout writes are keyed.
 *
 * Order per circle: forming timeout → auction close + draw → payouts due → defaults →
 * reminders → closing. Then: disbursements, notification dispatch.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RuleError, addDays, buildSchedule } from '@sanad/core';
import { inArray } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { money } from '../common/money.js';
import { DbService } from '../db/db.service.js';
import { circles } from '../db/schema.js';
import { CircleStore, type CircleCommand } from '../circles/circle-store.js';
import { CirclesService } from '../circles/circles.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DisbursementService } from '../payments/disbursement.service.js';

export interface TickReport {
  at: string;
  cancelled: number;
  drawn: number;
  payouts: number;
  defaults: number;
  closed: number;
  errors: { circleId: string; error: string }[];
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('Scheduler');

  constructor(
    private readonly dbs: DbService,
    private readonly store: CircleStore,
    private readonly circles: CirclesService,
    private readonly notifications: NotificationsService,
    private readonly disbursements: DisbursementService,
    private readonly clock: ClockService,
  ) {}

  async tick(): Promise<TickReport> {
    const report: TickReport = {
      at: this.clock.now().toISOString(),
      cancelled: 0,
      drawn: 0,
      payouts: 0,
      defaults: 0,
      closed: 0,
      errors: [],
    };
    const ids = await this.dbs.db
      .select({ id: circles.id, status: circles.status })
      .from(circles)
      .where(inArray(circles.status, ['FORMING', 'AUCTION', 'ACTIVE', 'CLOSING']));
    for (const { id, status } of ids) {
      try {
        if (status === 'AUCTION') {
          const before = (await this.store.read(id)).state.status;
          await this.circles.closeAuctionAndDraw(id);
          if ((await this.store.read(id)).state.status !== before) report.drawn += 1;
          continue;
        }
        if (status === 'CLOSING') {
          if (await this.tryClose(id)) report.closed += 1;
        }
        await this.store.withCircle(id, 'system:scheduler', (cmd) => this.stepCircle(cmd, report));
        if (status === 'ACTIVE' && (await this.store.read(id)).state.status === 'CLOSING') {
          if (await this.tryClose(id)) report.closed += 1;
        }
      } catch (e) {
        this.logger.error(`tick failed for circle ${id}: ${(e as Error).message}`);
        report.errors.push({ circleId: id, error: (e as Error).message });
      }
    }
    await this.disbursements.flush();
    await this.notifications.dispatchPending();
    return report;
  }

  private stepCircle(cmd: CircleCommand, report: TickReport): void {
    const s = cmd.state;
    const today = this.clock.today();
    const now = this.clock.now();

    if (s.status === 'FORMING' && now > cmd.row.formingDeadline) {
      const queued = s.members.filter((m) => m.status === 'QUEUED').map((m) => m.memberId);
      cmd.apply({ type: 'CANCELLED' });
      for (const id of queued)
        cmd.after.push((t) =>
          this.notifications.notify(t, id, 'circle.cancelled', {}, `${s.circleId}:cancelled:${id}`),
        );
      report.cancelled += 1;
      return;
    }

    if ((s.status !== 'ACTIVE' && s.status !== 'CLOSING') || !cmd.row.startDate) return;
    const schedule = buildSchedule(cmd.config, cmd.row.startDate, s.n);

    // Payouts that are due (catches up if the scheduler was down for a while).
    while (cmd.state.status === 'ACTIVE' && cmd.state.monthsSettled < s.n) {
      const next = schedule[cmd.state.monthsSettled];
      if (!next || today < next.payoutDate) break;
      cmd.apply({ type: 'PAYOUT_DUE', month: next.month });
      report.payouts += 1;
    }

    // Defaults: a month paid out without the member's money (LATE), or their own held payout
    // month, still unpaid on its default date.
    for (const sl of cmd.state.slots) {
      const holder = sl.holderId
        ? cmd.state.members.find((m) => m.memberId === sl.holderId)
        : undefined;
      if (!holder || holder.status !== 'ACTIVE') continue;
      const overdue = schedule.find((r) => {
        const st = sl.months[r.month];
        const late = st?.state === 'LATE';
        const heldOwn =
          st === undefined && cmd.state.heldPayouts.includes(r.month) && sl.spot === r.month;
        return (late || heldOwn) && today >= r.defaultsOn;
      });
      if (overdue) {
        cmd.apply({ type: 'MEMBER_DEFAULTED', memberId: holder.memberId });
        report.defaults += 1;
      }
    }

    // Reminders (deduplicated per member, month and kind).
    for (const sl of cmd.state.slots) {
      const holder = sl.holderId
        ? cmd.state.members.find((m) => m.memberId === sl.holderId)
        : undefined;
      if (!holder || holder.status !== 'ACTIVE') continue;
      for (const r of schedule) {
        const st = sl.months[r.month];
        const unpaid = st === undefined || st.state === 'LATE';
        if (!unpaid) continue;
        const finalOn = addDays(r.defaultsOn, -2);
        const kind =
          today >= finalOn && today < r.defaultsOn
            ? 'payment.final_warning'
            : today > r.graceEndsOn && today < finalOn
              ? 'payment.late'
              : today >= r.dueDate && today <= r.graceEndsOn
                ? 'payment.due_today'
                : today >= addDays(r.dueDate, -3) && today < r.dueDate
                  ? 'payment.due_3d'
                  : null;
        if (!kind) continue;
        const params = { month: r.month, amount: money(s.monthly).kwd, date: r.defaultsOn };
        const key = `${s.circleId}:${kind}:${holder.memberId}:${r.month}`;
        cmd.after.push((t) => this.notifications.notify(t, holder.memberId, kind, params, key));
      }
    }
  }

  /** CLOSE inside the circle lock; false while a member still owes a month. */
  private async tryClose(circleId: string): Promise<boolean> {
    try {
      const { cmd } = await this.store.withCircle(circleId, 'system:scheduler', (c) => {
        if (c.state.status === 'CLOSING') c.apply({ type: 'CLOSE' });
      });
      return cmd.state.status === 'CLOSED';
    } catch (e) {
      if (e instanceof RuleError && e.code === 'MEMBER_UNRESOLVED') return false;
      throw e;
    }
  }
}
