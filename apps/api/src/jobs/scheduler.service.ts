/**
 * The scheduler tick (spec §12): one idempotent pass over every open circle. Running it twice
 * at the same moment produces the same result as running it once — every step checks the
 * circle state first, and ledger/notification/payout writes are keyed.
 *
 * Order per circle: forming timeout → auction close + draw → payouts due → defaults →
 * reminders → closing → blocked-release retry. Then: circuit breaker, disbursements,
 * notification dispatch.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  RuleError,
  addDays,
  buildSchedule,
  circleExposure,
  fundRatioBps,
  minimumReserve,
  nextBreakerState,
  type Fils,
} from '@sanad/core';
import { inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { ClockService } from '../common/clock.service.js';
import { money } from '../common/money.js';
import { DbService, type Tx } from '../db/db.service.js';
import { circles } from '../db/schema.js';
import { CircleStore, type CircleCommand } from '../circles/circle-store.js';
import { BREAKER_KEY, CirclesService, type BreakerState } from '../circles/circles.service.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DisbursementService } from '../payments/disbursement.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface TickReport {
  at: string;
  cancelled: number;
  drawn: number;
  payouts: number;
  defaults: number;
  closed: number;
  releasesRetried: number;
  errors: { circleId: string; error: string }[];
  breaker: BreakerState;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('Scheduler');

  constructor(
    private readonly dbs: DbService,
    private readonly store: CircleStore,
    private readonly circles: CirclesService,
    private readonly ledger: LedgerRepository,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly disbursements: DisbursementService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  /** Pooled fund balance and exposure across every open circle. */
  async poolMetrics(tx: Tx = this.dbs.db): Promise<{ fund: Fils; exposure: Fils }> {
    const rows = await tx
      .select({ id: circles.id })
      .from(circles)
      .where(inArray(circles.status, ['ACTIVE', 'CLOSING']));
    let exposure = 0n;
    for (const r of rows) exposure += circleExposure((await this.store.read(r.id, tx)).state);
    return { fund: await this.ledger.fundBalance(tx), exposure };
  }

  async tick(): Promise<TickReport> {
    const report: TickReport = {
      at: this.clock.now().toISOString(),
      cancelled: 0,
      drawn: 0,
      payouts: 0,
      defaults: 0,
      closed: 0,
      releasesRetried: 0,
      errors: [],
      breaker: 'NORMAL',
    };
    const ids = await this.dbs.db
      .select({ id: circles.id, status: circles.status })
      .from(circles)
      .where(inArray(circles.status, ['FORMING', 'AUCTION', 'ACTIVE', 'CLOSING', 'CLOSED']));
    for (const { id, status } of ids) {
      try {
        if (status === 'AUCTION') {
          const before = (await this.store.read(id)).state.status;
          await this.circles.closeAuctionAndDraw(id);
          if ((await this.store.read(id)).state.status !== before) report.drawn += 1;
          continue;
        }
        if (status === 'CLOSED') {
          if ((await this.store.read(id)).state.stats.pendingRelease > 0n) {
            await this.tryClose(id);
            report.releasesRetried += 1;
          }
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
    report.breaker = await this.evaluateBreaker();
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

    // Defaults: an overdue month (advanced by the fund, or the member's own held payout month)
    // that is still unpaid on its default date.
    for (const sl of cmd.state.slots) {
      const holder = sl.holderId
        ? cmd.state.members.find((m) => m.memberId === sl.holderId)
        : undefined;
      if (!holder || holder.status !== 'ACTIVE') continue;
      const overdue = schedule.find((r) => {
        const st = sl.months[r.month];
        const advancedForMe = st?.state === 'ADVANCED' && st.liable === holder.memberId;
        const heldOwn =
          st === undefined && cmd.state.heldPayouts.includes(r.month) && sl.spot === r.month;
        return (advancedForMe || heldOwn) && today >= r.defaultsOn;
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
        const unpaid =
          st === undefined || (st.state === 'ADVANCED' && st.liable === holder.memberId);
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

  /** CLOSE (or retry a blocked release) using live pool metrics, inside the circle lock. */
  private async tryClose(circleId: string): Promise<boolean> {
    try {
      const { cmd } = await this.store.withCircle(circleId, 'system:scheduler', async (c, tx) => {
        const { fund, exposure } = await this.poolMetrics(tx);
        const reserve = minimumReserve(c.config, exposure - circleExposure(c.state));
        if (c.state.status === 'CLOSING')
          c.apply({ type: 'CLOSE', poolFundBalance: fund, minimumReserve: reserve });
        else if (c.state.status === 'CLOSED' && c.state.stats.pendingRelease > 0n)
          c.apply({ type: 'RELEASE_RETRY', poolFundBalance: fund, minimumReserve: reserve });
      });
      return cmd.state.status === 'CLOSED';
    } catch (e) {
      if (e instanceof RuleError && (e.code === 'UNSETTLED' || e.code === 'MEMBER_UNRESOLVED'))
        return false;
      throw e;
    }
  }

  /** Circuit breaker with hysteresis (spec §5.12). Alerts are written to the audit log. */
  async evaluateBreaker(): Promise<BreakerState> {
    const { config } = await this.settings.active();
    const { fund, exposure } = await this.poolMetrics();
    const current = await this.circles.breaker();
    const next = nextBreakerState(config, current, fundRatioBps(fund, exposure));
    if (next !== current) {
      await this.dbs.transaction(async (tx) => {
        await this.settings.setState(
          BREAKER_KEY,
          { state: next, at: this.clock.now().toISOString() },
          tx,
        );
        await this.audit.log(tx, {
          actorType: 'system',
          actorId: null,
          action: next === 'TRIPPED' ? 'breaker.tripped' : 'breaker.resumed',
          details: {
            fund: fund.toString(),
            exposure: exposure.toString(),
            alert: ['super_admin', 'finance'],
          },
        });
      });
      this.logger.warn(`circuit breaker ${current} → ${next}`);
    }
    return next;
  }
}
