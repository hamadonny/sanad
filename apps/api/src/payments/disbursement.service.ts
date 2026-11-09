import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { money } from '../common/money.js';
import { DbService } from '../db/db.service.js';
import { payments, payouts, refunds } from '../db/schema.js';
import { CircleStore, ENGINE_REFUND_KINDS } from '../circles/circle-store.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../providers/payment.provider.js';

const MAX_ATTEMPTS = 5;

/**
 * Sends money out through the gateway after the DB commit that decided it. Idempotent: the
 * provider gets our row id as its reference, rows move PENDING → SENT exactly once, and
 * failures stay PENDING (retried by the scheduler) until MAX_ATTEMPTS, then FAILED for ops.
 */
@Injectable()
export class DisbursementService {
  private readonly logger = new Logger('Disbursements');
  private running: Promise<void> | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly store: CircleStore,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  flush(): Promise<void> {
    // Serialise concurrent flushes in this process; DB status checks guard across processes.
    this.running = (this.running ?? Promise.resolve()).then(() => this.run());
    return this.running;
  }

  private async run(): Promise<void> {
    await this.sendPayouts();
    await this.sendRefunds();
  }

  private async sendPayouts(): Promise<void> {
    const rows = await this.dbs.db
      .select()
      .from(payouts)
      .where(and(eq(payouts.status, 'PENDING'), lt(payouts.attempts, MAX_ATTEMPTS)));
    for (const p of rows) {
      try {
        const r = await this.provider.payout({
          reference: p.id,
          userId: p.userId,
          amount: p.amountFils,
          description: `Sanad ${p.kind}`,
        });
        await this.dbs.transaction(async (tx) => {
          const updated = await tx
            .update(payouts)
            .set({
              status: 'SENT',
              providerRef: r.providerRef,
              sentAt: this.clock.now(),
              attempts: p.attempts + 1,
            })
            .where(and(eq(payouts.id, p.id), eq(payouts.status, 'PENDING')))
            .returning({ id: payouts.id });
          if (updated.length === 0) return;
          const key = p.kind === 'POT' ? 'payout.sent' : 'holdback.released';
          await this.notifications.notify(
            tx,
            p.userId,
            key,
            { amount: money(p.amountFils).kwd },
            `${key}:${p.id}`,
          );
        });
      } catch (e) {
        await this.fail(payouts, p.id, p.attempts, e);
      }
    }
  }

  private async sendRefunds(): Promise<void> {
    const rows = await this.dbs.db
      .select()
      .from(refunds)
      .where(and(eq(refunds.status, 'PENDING'), lt(refunds.attempts, MAX_ATTEMPTS)));
    for (const r of rows) {
      try {
        const res = await this.provider.refund({
          reference: r.id,
          userId: r.userId,
          amount: r.amountFils,
          description: `Sanad ${r.kind} refund`,
        });
        await this.dbs.transaction(async (tx) => {
          const updated = await tx
            .update(refunds)
            .set({
              status: 'SENT',
              providerRef: res.providerRef,
              sentAt: this.clock.now(),
              attempts: r.attempts + 1,
            })
            .where(and(eq(refunds.id, r.id), eq(refunds.status, 'PENDING')))
            .returning({ id: refunds.id });
          if (updated.length === 0) return;
          if (ENGINE_REFUND_KINDS.has(r.kind)) {
            await this.store.withCircle(
              r.circleId as string,
              'system:disbursement',
              (cmd) =>
                cmd.apply({
                  type: 'REFUND_PAID',
                  memberId: r.userId,
                  amount: r.amountFils,
                  reference: r.id,
                }),
              tx,
            );
          }
          if (r.kind === 'PAYMENT_REVERSAL' && r.paymentId) {
            await tx
              .update(payments)
              .set({ status: 'REFUNDED' })
              .where(eq(payments.id, r.paymentId));
          }
          await this.notifications.notify(
            tx,
            r.userId,
            'refund.sent',
            { amount: money(r.amountFils).kwd },
            `refund.sent:${r.id}`,
          );
        });
      } catch (e) {
        await this.fail(refunds, r.id, r.attempts, e);
      }
    }
  }

  private async fail(
    table: typeof payouts | typeof refunds,
    id: string,
    attempts: number,
    e: unknown,
  ): Promise<void> {
    const next = attempts + 1;
    this.logger.warn(`disbursement ${id} failed (attempt ${next}): ${(e as Error).message}`);
    await this.dbs.db
      .update(table)
      .set({
        attempts: next,
        lastError: (e as Error).message.slice(0, 300),
        status: next >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
      })
      .where(eq(table.id, id));
  }

  /** Ops: put a FAILED row back in the queue (spec §10 "manual retry"). */
  async retry(kind: 'payout' | 'refund', id: string): Promise<void> {
    const table = kind === 'payout' ? payouts : refunds;
    await this.dbs.db
      .update(table)
      .set({ status: 'PENDING', attempts: 0 })
      .where(and(eq(table.id, id), inArray(table.status, ['FAILED', 'PENDING'])));
    await this.flush();
  }
}
