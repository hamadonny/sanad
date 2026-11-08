import { Inject, Injectable, Logger } from '@nestjs/common';
import { RuleError, buildSchedule, circleRules, kuwaitDate, type Fils } from '@sanad/core';
import { and, desc, eq } from 'drizzle-orm';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../common/errors.js';
import { ClockService } from '../common/clock.service.js';
import { money } from '../common/money.js';
import { DbService } from '../db/db.service.js';
import { payments, refunds } from '../db/schema.js';
import { CircleStore } from '../circles/circle-store.js';
import { CirclesService } from '../circles/circles.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  PAYMENT_PROVIDER,
  type MockPaymentProvider,
  type PaymentProvider,
  type WebhookEvent,
} from '../providers/payment.provider.js';
import { SettingsService } from '../settings/settings.service.js';
import { DisbursementService } from './disbursement.service.js';

export type IntentInput =
  | { purpose: 'ENTRY_FEE'; monthlyFils: Fils }
  | { purpose: 'CONTRIBUTION'; circleId: string; month: number }
  | { purpose: 'REPLACEMENT'; circleId: string; spot: number };

type PaymentRow = typeof payments.$inferSelect;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly dbs: DbService,
    private readonly store: CircleStore,
    private readonly circles: CirclesService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly disbursements: DisbursementService,
    private readonly clock: ClockService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  view(p: PaymentRow) {
    return {
      id: p.id,
      purpose: p.purpose,
      circleId: p.circleId,
      month: p.month,
      spot: p.spot,
      amount: money(p.amountFils),
      penalty: money(p.penaltyFils),
      status: p.status,
      createdAt: p.createdAt,
      succeededAt: p.succeededAt,
      failureReason: p.failureReason,
    };
  }

  /** Create a payment intent. `idempotencyKey` (header) makes retries return the same intent. */
  async createIntent(userId: string, input: IntentInput, idempotencyKey: string) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey))
      throw unprocessable('IDEMPOTENCY_KEY', 'Idempotency-Key header (8–80 chars) is required');
    const key = `${userId}:${idempotencyKey}`;
    const [existing] = await this.dbs.db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, key));
    if (existing)
      return { payment: this.view(existing), checkoutUrl: `sanad-mock://checkout/${existing.id}` };

    let monthly: Fils;
    let amount: Fils;
    let penalty = 0n;
    let circleId: string | null = null;
    let month: number | null = null;
    let spot: number | null = null;

    if (input.purpose === 'ENTRY_FEE') {
      await this.circles.assertCanJoin(userId, input.monthlyFils);
      const { config } = await this.settings.active();
      monthly = input.monthlyFils;
      amount = circleRules(config, monthly).entryFee;
    } else if (input.purpose === 'CONTRIBUTION') {
      const { state, row, config } = await this.store.read(input.circleId);
      const me = state.members.find((m) => m.memberId === userId);
      const slot = state.slots.find((s) => s.holderId === userId);
      if (!me || !slot) throw notFound('circle');
      if (me.status !== 'ACTIVE') throw forbidden('NOT_ACTIVE', `membership is ${me.status}`);
      if (!Number.isInteger(input.month) || input.month < 1 || input.month > state.n)
        throw unprocessable('INVALID_MONTH', 'invalid month');
      const st = slot.months[input.month];
      if (st && !(st.state === 'ADVANCED' && st.liable === userId))
        throw conflict('ALREADY_PAID', `month ${input.month} is already paid`);
      monthly = state.monthly;
      const due = buildSchedule(config, row.startDate as string, state.n)[input.month - 1]!;
      penalty =
        this.clock.today() > due.graceEndsOn ? circleRules(config, monthly).latePenalty : 0n;
      amount = monthly + penalty;
      circleId = input.circleId;
      month = input.month;
    } else {
      const { state, config } = await this.store.read(input.circleId);
      await this.circles.assertCanJoin(userId, state.monthly);
      monthly = state.monthly;
      amount = this.circles.replacementAmount(state, config, input.spot);
      circleId = input.circleId;
      spot = input.spot;
    }

    const [p] = await this.dbs.db
      .insert(payments)
      .values({
        userId,
        purpose: input.purpose,
        circleId,
        month,
        spot,
        monthlyFils: monthly,
        amountFils: amount,
        penaltyFils: penalty,
        status: 'PENDING',
        provider: this.provider.name,
        idempotencyKey: key,
      })
      .returning();
    const charge = await this.provider.createCharge({
      paymentId: p!.id,
      amount,
      description: `Sanad ${input.purpose.toLowerCase()}`,
      idempotencyKey: key,
    });
    const [updated] = await this.dbs.db
      .update(payments)
      .set({ providerRef: charge.providerRef })
      .where(eq(payments.id, p!.id))
      .returning();
    return { payment: this.view(updated!), checkoutUrl: charge.checkoutUrl };
  }

  /** Gateway webhook. Verified, idempotent, and never loses a received payment. */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<{ ok: true }> {
    let event: WebhookEvent;
    try {
      event = this.provider.parseWebhook(rawBody, signature);
    } catch {
      throw new ApiError(401, 'INVALID_SIGNATURE', 'webhook signature invalid');
    }
    const [p] = await this.dbs.db.select().from(payments).where(eq(payments.id, event.paymentId));
    if (!p || p.providerRef !== event.providerRef) throw notFound('payment');
    if (p.status !== 'PENDING') return { ok: true }; // replayed webhook — already handled

    if (event.type === 'charge.failed') {
      await this.dbs.db
        .update(payments)
        .set({ status: 'FAILED', failureReason: event.reason })
        .where(eq(payments.id, p.id));
      return { ok: true };
    }
    if (event.amount !== p.amountFils) {
      await this.dbs.db
        .update(payments)
        .set({
          status: 'REFUND_REQUIRED',
          failureReason: 'amount mismatch',
          succeededAt: this.clock.now(),
        })
        .where(eq(payments.id, p.id));
      await this.queueReversal(p, 'amount mismatch');
      await this.disbursements.flush();
      return { ok: true };
    }
    await this.dbs.db
      .update(payments)
      .set({ status: 'SUCCEEDED', succeededAt: new Date(event.paidAt) })
      .where(and(eq(payments.id, p.id), eq(payments.status, 'PENDING')));
    await this.apply(p.id, kuwaitDate(new Date(event.paidAt)));
    await this.disbursements.flush();
    await this.notifications.dispatchPending();
    return { ok: true };
  }

  /** Turn a SUCCEEDED payment into circle events. A rule rejection refunds the member. */
  async apply(paymentId: string, paidOn: string): Promise<void> {
    try {
      await this.dbs.transaction(async (tx) => {
        const [p] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, paymentId))
          .for('update');
        if (!p || p.status !== 'SUCCEEDED') return;
        let circleId = p.circleId;
        if (p.purpose === 'ENTRY_FEE')
          circleId = await this.circles.joinQueue(tx, p.userId, p.monthlyFils);
        else if (p.purpose === 'CONTRIBUTION')
          await this.circles.applyContribution(
            tx,
            p.userId,
            p.circleId as string,
            p.month as number,
            paidOn,
          );
        else
          await this.circles.applyReplacement(tx, p.userId, p.circleId as string, p.spot as number);
        await tx
          .update(payments)
          .set({ status: 'APPLIED', appliedAt: this.clock.now(), circleId })
          .where(eq(payments.id, p.id));
        await this.notifications.notify(
          tx,
          p.userId,
          'payment.received',
          { amount: money(p.amountFils).kwd },
          `payment.received:${p.id}`,
        );
      });
    } catch (e) {
      if (!(e instanceof RuleError) && !(e instanceof ApiError)) throw e;
      const [p] = await this.dbs.db.select().from(payments).where(eq(payments.id, paymentId));
      this.logger.warn(`payment ${paymentId} rejected by rules: ${(e as Error).message}`);
      await this.dbs.db
        .update(payments)
        .set({ status: 'REFUND_REQUIRED', failureReason: (e as Error).message.slice(0, 300) })
        .where(eq(payments.id, paymentId));
      await this.queueReversal(p!, (e as Error).message);
    }
  }

  private async queueReversal(p: PaymentRow, reason: string): Promise<void> {
    void reason;
    await this.dbs.db
      .insert(refunds)
      .values({
        userId: p.userId,
        circleId: p.circleId,
        kind: 'PAYMENT_REVERSAL',
        paymentId: p.id,
        amountFils: p.amountFils,
        status: 'PENDING',
        dedupeKey: `payment:${p.id}`,
      })
      .onConflictDoNothing();
  }

  /** DEV ONLY: simulate the gateway confirming a payment (signed exactly like a real webhook). */
  async devConfirm(paymentId: string, paidAt = this.clock.now()) {
    const [p] = await this.dbs.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw notFound('payment');
    const mock = this.provider as MockPaymentProvider;
    const { body, signature } = mock.buildWebhook({
      type: 'charge.succeeded',
      eventId: `evt_${p.id}`,
      providerRef: p.providerRef as string,
      paymentId: p.id,
      amount: p.amountFils,
      paidAt: paidAt.toISOString(),
    });
    await this.handleWebhook(body, signature);
    const [after] = await this.dbs.db.select().from(payments).where(eq(payments.id, paymentId));
    return this.view(after!);
  }

  async list(userId: string) {
    const rows = await this.dbs.db
      .select()
      .from(payments)
      .where(eq(payments.userId, userId))
      .orderBy(desc(payments.createdAt))
      .limit(200);
    return rows.map((p) => this.view(p));
  }

  async get(userId: string, id: string) {
    const [p] = await this.dbs.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, userId)));
    if (!p) throw notFound('payment');
    return p;
  }
}
