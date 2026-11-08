/**
 * The command pipeline for circles. Every change to a circle goes through `withCircle()`:
 *
 *   BEGIN → SELECT … FOR UPDATE (one writer per circle) → apply events with @sanad/core →
 *   post ledger transactions → save snapshot + events → update projections → handle effects
 *   (notifications, payout/refund rows, bans, legal cases) → COMMIT
 *
 * Money leaving through the gateway (payouts, refunds) is recorded as PENDING rows here and
 * sent by the DisbursementService after commit, so a failed transfer can be retried safely.
 */
import { Injectable } from '@nestjs/common';
import type { SanadConfig } from '@sanad/config';
import {
  applyCircleEvent,
  buildSchedule,
  computeTier,
  createCircle,
  decodeJson,
  encodeJson,
  type CircleEffect,
  type CircleEvent,
  type CircleState,
  type Fils,
  type Transaction,
} from '@sanad/core';
import { and, eq, sql } from 'drizzle-orm';
import { notFound } from '../common/errors.js';
import { bigintReplacer } from '../common/money.js';
import { ClockService } from '../common/clock.service.js';
import { DbService, type Tx } from '../db/db.service.js';
import {
  auctionBids,
  circleEvents,
  circleMembers,
  circles,
  defaults,
  installments,
  legalCaseEvents,
  legalCases,
  payouts,
  refunds,
  trustProfiles,
  users,
} from '../db/schema.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { MembersService } from '../users/members.service.js';

export interface CircleRow {
  id: string;
  status: string;
  configVersion: number;
  startDate: string | null;
  seedEncrypted: string | null;
  commitment: string | null;
  formingDeadline: Date;
  auctionEndsAt: Date | null;
  drawnAt: Date | null;
}

export class CircleCommand {
  readonly transactions: Transaction[] = [];
  readonly effects: CircleEffect[] = [];
  readonly events: CircleEvent[] = [];
  /** Column updates to the circles row (e.g. commitment, start date). */
  readonly patch: Partial<typeof circles.$inferInsert> = {};
  /** Extra follow-ups run inside the same transaction after projections. */
  readonly after: ((tx: Tx) => Promise<void>)[] = [];

  constructor(
    public state: CircleState,
    readonly row: CircleRow,
    readonly config: SanadConfig,
  ) {}

  apply(event: CircleEvent): this {
    const r = applyCircleEvent(this.state, event, this.config);
    this.state = r.state;
    this.transactions.push(...r.transactions);
    this.effects.push(...r.effects);
    this.events.push(event);
    return this;
  }
}

const payoutDateOf = (
  config: SanadConfig,
  startDate: string | null,
  n: number,
  month: number,
): string => (startDate ? (buildSchedule(config, startDate, n)[month - 1]?.payoutDate ?? '') : '');

@Injectable()
export class CircleStore {
  constructor(
    private readonly dbs: DbService,
    private readonly ledger: LedgerRepository,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly members: MembersService,
    private readonly clock: ClockService,
  ) {}

  /** Create an empty FORMING circle under the active config version. */
  async create(tx: Tx, monthly: Fils): Promise<string> {
    const { version, config } = await this.settings.active(tx);
    const [row] = await tx
      .insert(circles)
      .values({
        status: 'FORMING',
        monthlyFils: monthly,
        members: config.circle.membersPerCircle,
        configVersion: version,
        engineState: {},
        formingDeadline: new Date(
          this.clock.now().getTime() + config.circle.formingTimeoutDays * 86_400_000,
        ),
      })
      .returning({ id: circles.id });
    const id = row!.id;
    const state = createCircle(config, { circleId: id, configVersion: version, monthly });
    await tx
      .update(circles)
      .set({ engineState: encodeJson(state) })
      .where(eq(circles.id, id));
    return id;
  }

  async read(
    circleId: string,
    tx: Tx = this.dbs.db,
  ): Promise<{ state: CircleState; row: CircleRow; config: SanadConfig }> {
    const [row] = await tx.select().from(circles).where(eq(circles.id, circleId));
    if (!row) throw notFound('circle');
    return {
      state: decodeJson<CircleState>(row.engineState),
      row,
      config: await this.settings.byVersion(row.configVersion, tx),
    };
  }

  /** Run a command against one circle under a row lock. Pass `tx` to join an outer transaction. */
  async withCircle<T>(
    circleId: string,
    actor: string,
    fn: (cmd: CircleCommand, tx: Tx) => Promise<T> | T,
    outer?: Tx,
  ): Promise<{ result: T; cmd: CircleCommand }> {
    const run = async (tx: Tx) => {
      const locked = await tx.execute(
        sql`SELECT id FROM circles WHERE id = ${circleId} FOR UPDATE`,
      );
      if (locked.rows.length === 0) throw notFound('circle');
      const { state, row, config } = await this.read(circleId, tx);
      const cmd = new CircleCommand(state, row, config);
      const result = await fn(cmd, tx);
      if (cmd.events.length > 0 || Object.keys(cmd.patch).length > 0)
        await this.persist(tx, cmd, actor);
      else for (const f of cmd.after) await f(tx);
      return { result, cmd };
    };
    return outer ? run(outer) : this.dbs.transaction(run);
  }

  private async persist(tx: Tx, cmd: CircleCommand, actor: string): Promise<void> {
    const s = cmd.state;
    await this.ledger.post(tx, cmd.transactions);
    const [{ seq } = { seq: 0 }] = (
      await tx.execute(
        sql`SELECT COALESCE(MAX(seq), 0)::int AS seq FROM circle_events WHERE circle_id = ${s.circleId}`,
      )
    ).rows as { seq: number }[];
    if (cmd.events.length > 0) {
      await tx.insert(circleEvents).values(
        cmd.events.map((e, i) => ({
          circleId: s.circleId,
          seq: seq + i + 1,
          type: e.type,
          payload: JSON.parse(JSON.stringify(e, bigintReplacer)) as unknown,
          actor,
        })),
      );
    }
    await tx
      .update(circles)
      .set({
        ...cmd.patch,
        status: s.status,
        engineState: encodeJson(s),
        stateVersion: sql`${circles.stateVersion} + 1`,
        updatedAt: this.clock.now(),
        ...(s.status === 'CLOSED' && cmd.row.status !== 'CLOSED'
          ? { closedAt: this.clock.now() }
          : {}),
      })
      .where(eq(circles.id, s.circleId));
    await this.project(tx, cmd);
    await this.handleEffects(tx, cmd);
    for (const f of cmd.after) await f(tx);
  }

  /** Keep the query/constraint tables in sync with the snapshot. */
  private async project(tx: Tx, cmd: CircleCommand): Promise<void> {
    const s = cmd.state;
    if (s.members.length > 0) {
      await tx
        .update(circleMembers)
        .set({ spot: null })
        .where(eq(circleMembers.circleId, s.circleId));
      const holderSpot = new Map(
        s.slots.filter((sl) => sl.holderId).map((sl) => [sl.holderId as string, sl.spot]),
      );
      for (const m of s.members) {
        const values = {
          status: m.status,
          spot: s.slots.length > 0 ? (holderSpot.get(m.memberId) ?? null) : null,
          originalSpot: m.spot,
          tierAtJoin: m.tier,
          holdbackBps: Number(m.holdbackBps),
          bidFils: m.bid,
          isReplacement: m.isReplacement,
          receivedPayout: m.receivedPayout,
        };
        await tx
          .insert(circleMembers)
          .values({ circleId: s.circleId, userId: m.memberId, ...values })
          .onConflictDoUpdate({
            target: [circleMembers.circleId, circleMembers.userId],
            set: values,
          });
      }
    }
    if (s.auction && s.auction.bids.length > 0) {
      for (const b of s.auction.bids) {
        if (!b.active)
          await tx
            .update(auctionBids)
            .set({ active: false })
            .where(and(eq(auctionBids.circleId, s.circleId), eq(auctionBids.seq, b.seq)));
      }
      for (const b of s.auction.bids) {
        await tx
          .insert(auctionBids)
          .values({
            circleId: s.circleId,
            userId: b.memberId,
            seq: b.seq,
            spot: b.spot,
            amountFils: b.amount,
            active: b.active,
            placedAt: new Date(b.at),
          })
          .onConflictDoNothing({ target: [auctionBids.circleId, auctionBids.seq] });
      }
    }
    const startDate = (cmd.patch.startDate as string | undefined) ?? cmd.row.startDate;
    if (s.slots.length > 0 && startDate) {
      const schedule = buildSchedule(cmd.config, startDate, s.n);
      const rows = s.slots.flatMap((sl) =>
        schedule.map((r) => ({
          circleId: s.circleId,
          spot: sl.spot,
          month: r.month,
          userId: sl.holderId ?? sl.vacatedBy,
          amountFils: s.monthly,
          dueDate: r.dueDate,
          payoutDate: r.payoutDate,
          defaultsOn: r.defaultsOn,
          status: sl.months[r.month]?.state ?? 'UNPAID',
        })),
      );
      await tx
        .insert(installments)
        .values(rows)
        .onConflictDoUpdate({
          target: [installments.circleId, installments.spot, installments.month],
          set: { status: sql`excluded.status`, userId: sql`excluded.user_id` },
        });
    }
  }

  private async handleEffects(tx: Tx, cmd: CircleCommand): Promise<void> {
    const s = cmd.state;
    const c = s.circleId;

    for (const e of cmd.events) {
      if (e.type === 'MEMBER_DEFAULTED') {
        const m = s.members.find((x) => x.memberId === e.memberId);
        const kind = m?.status === 'DEFAULTED_POST_PAYOUT' ? 'POST_PAYOUT' : 'PRE_PAYOUT';
        await tx
          .insert(defaults)
          .values({ circleId: c, userId: e.memberId, kind })
          .onConflictDoNothing();
        await tx
          .insert(trustProfiles)
          .values({ userId: e.memberId, defaults: 1 })
          .onConflictDoUpdate({
            target: trustProfiles.userId,
            set: { defaults: sql`${trustProfiles.defaults} + 1`, updatedAt: this.clock.now() },
          });
      }
    }

    for (const t of cmd.transactions) {
      const member = t.memberId;
      if (!member) continue;
      const amount = t.entries.find((e) => e.account === 'gateway_clearing')?.amount ?? 0n;
      if (t.type === 'HOLDBACK_RELEASED') {
        await tx
          .insert(payouts)
          .values({
            circleId: c,
            userId: member,
            kind: 'HOLDBACK_RELEASE',
            amountFils: -amount,
            status: 'PENDING',
            dedupeKey: `${c}:HOLDBACK:${member}`,
          })
          .onConflictDoNothing();
      }
      if (t.type === 'ENTRY_FEE_REFUNDED') {
        await tx
          .insert(refunds)
          .values({
            circleId: c,
            userId: member,
            kind: 'ENTRY_FEE',
            amountFils: -amount,
            status: 'PENDING',
            dedupeKey: `${c}:ENTRY_FEE:${member}`,
          })
          .onConflictDoNothing();
      }
    }

    for (const ef of cmd.effects) {
      switch (ef.kind) {
        case 'PAYOUT_SENT':
          await tx
            .insert(payouts)
            .values({
              circleId: c,
              userId: ef.memberId,
              kind: 'POT',
              month: ef.month,
              amountFils: ef.amount,
              status: 'PENDING',
              dedupeKey: `${c}:POT:${ef.month}`,
            })
            .onConflictDoNothing();
          break;
        case 'PAYOUT_HELD':
          await this.notifications.notify(
            tx,
            ef.memberId,
            'payout.held',
            { month: ef.month },
            `${c}:payout.held:${ef.month}`,
          );
          break;
        case 'MEMBER_BANNED':
          await tx
            .update(users)
            .set({ status: 'BANNED', bannedReason: ef.reason, bannedAt: this.clock.now() })
            .where(eq(users.id, ef.memberId));
          await tx
            .update(trustProfiles)
            .set({ banned: true })
            .where(eq(trustProfiles.userId, ef.memberId));
          await this.notifications.notify(
            tx,
            ef.memberId,
            'account.banned',
            {},
            `${c}:banned:${ef.memberId}`,
          );
          break;
        case 'LEGAL_CASE_OPENED': {
          const [lc] = await tx
            .insert(legalCases)
            .values({
              circleId: c,
              userId: ef.memberId,
              grossOwedFils: ef.grossOwed,
              holdbackAppliedFils: ef.holdbackApplied,
              netClaimFils: ef.netClaim,
            })
            .returning({ id: legalCases.id });
          await tx.insert(legalCaseEvents).values({
            caseId: lc!.id,
            status: 'OPEN',
            note: 'Opened automatically on post-payout default',
          });
          break;
        }
        case 'CIRCLE_CLOSED':
          await this.onClosed(tx, cmd);
          break;
        default:
          break;
      }
    }
  }

  private async onClosed(tx: Tx, cmd: CircleCommand): Promise<void> {
    const s = cmd.state;
    for (const m of s.members) {
      if (m.refundDue > 0n) {
        await tx
          .insert(refunds)
          .values({
            circleId: s.circleId,
            userId: m.memberId,
            kind: m.status === 'DEFAULTED_PRE_PAYOUT' ? 'DEFAULTER' : 'COMPLETION',
            amountFils: m.refundDue,
            status: 'PENDING',
            dedupeKey: `${s.circleId}:REFUND:${m.memberId}`,
          })
          .onConflictDoNothing();
      }
      if (m.status !== 'ACTIVE') continue;
      const before = computeTier(cmd.config, await this.members.trustProfile(m.memberId, tx));
      await tx
        .insert(trustProfiles)
        .values({ userId: m.memberId, completedCircles: 1, latePayments: m.latePayments })
        .onConflictDoUpdate({
          target: trustProfiles.userId,
          set: {
            completedCircles: sql`${trustProfiles.completedCircles} + 1`,
            latePayments: sql`${trustProfiles.latePayments} + ${m.latePayments}`,
            updatedAt: this.clock.now(),
          },
        });
      await this.notifications.notify(
        tx,
        m.memberId,
        'circle.closed',
        {},
        `${s.circleId}:closed:${m.memberId}`,
      );
      const after = computeTier(cmd.config, await this.members.trustProfile(m.memberId, tx));
      if (before.kind === 'tier' && after.kind === 'tier' && after.tier > before.tier) {
        await this.notifications.notify(
          tx,
          m.memberId,
          'tier.upgraded',
          { tier: after.tier },
          `${s.circleId}:tier:${m.memberId}`,
        );
      }
    }
  }

  payoutDate(
    cmd: { config: SanadConfig; row: CircleRow; state: CircleState },
    month: number,
  ): string {
    return payoutDateOf(cmd.config, cmd.row.startDate, cmd.state.n, month);
  }
}
