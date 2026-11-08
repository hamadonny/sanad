import { Inject, Injectable } from '@nestjs/common';
import type {
  AuctionView,
  CircleDetail,
  CircleSummary,
  DrawView,
  OptionsResponse,
  ReplacementOffer,
  ScheduleView,
} from '@sanad/api-client';
import type { SanadConfig } from '@sanad/config';
import {
  addDays,
  auctionResults,
  buildSchedule,
  canBid,
  canReplace,
  circleRules,
  commitmentFor,
  computeTier,
  holdbackAmount,
  holdbackBps,
  joinBlockers,
  kwd,
  minBidForSpot,
  myStatus,
  publicView,
  refundBpsForSpot,
  completionRefundAmount,
  DRAW_ALGORITHM_VERSION,
  type CircleState,
  type Fils,
  type JoinBlocker,
  type Tier,
} from '@sanad/core';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors.js';
import { money } from '../common/money.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { DbService, type Tx } from '../db/db.service.js';
import { circleMembers, circles, draws, installments, users } from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { MembersService, OPEN_CIRCLE_STATUSES } from '../users/members.service.js';
import { CircleStore, type CircleCommand } from './circle-store.js';
import { SEED_SOURCE, type SeedSource } from '../providers/seed.source.js';

export type BreakerState = 'NORMAL' | 'TRIPPED';
export const BREAKER_KEY = 'circuit_breaker';

/** "Ahmad Al-Sabah" → "Ahmad A." (spec §9: first name + last initial only). */
export function displayName(full: string | null | undefined): string {
  if (!full) return '—';
  const parts = full.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return last ? `${first} ${last.replace(/^(Al-|al-|ال)/, '').charAt(0)}.` : first;
}

@Injectable()
export class CirclesService {
  constructor(
    private readonly dbs: DbService,
    private readonly store: CircleStore,
    private readonly settings: SettingsService,
    private readonly members: MembersService,
    private readonly contracts: ContractsService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
    private readonly clock: ClockService,
    @Inject(SEED_SOURCE) private readonly seeds: SeedSource,
  ) {}

  async breaker(tx: Tx = this.dbs.db): Promise<BreakerState> {
    return (
      await this.settings.getState<{ state: BreakerState }>(BREAKER_KEY, { state: 'NORMAL' }, tx)
    ).state;
  }

  // ───────────── Eligibility ─────────────

  async eligibility(
    userId: string,
    monthly: Fils,
    config: SanadConfig,
    tx: Tx = this.dbs.db,
  ): Promise<{ blockers: (JoinBlocker | 'CONTRACT_NOT_SIGNED')[]; tier: Tier | null }> {
    const user = await this.members.user(userId, tx);
    const profile = await this.members.trustProfile(userId, tx);
    const tier = computeTier(config, profile);
    const blockers = joinBlockers(config, {
      profile,
      monthly,
      activeCircles: await this.members.activeCircleCount(userId, tx),
      identityVerified: user.kycStatus === 'APPROVED',
      contractSigned: await this.contracts.hasSignedCurrent(userId, tx),
      civilIdExpiry: user.civilIdExpiry ?? '0000-01-01',
      today: this.clock.today(),
      circuitBreakerTripped: (await this.breaker(tx)) === 'TRIPPED',
    });
    return { blockers, tier: tier.kind === 'tier' ? tier.tier : null };
  }

  async assertCanJoin(userId: string, monthly: Fils, tx: Tx = this.dbs.db): Promise<Tier> {
    const { config } = await this.settings.active(tx);
    const { blockers, tier } = await this.eligibility(userId, monthly, config, tx);
    if (blockers.length > 0 || tier === null)
      throw forbidden(blockers[0] ?? 'BANNED', `cannot join: ${blockers.join(', ')}`);
    return tier;
  }

  // ───────────── Commands ─────────────

  /** Called when an entry-fee payment succeeds: put the member in a FORMING circle for M. */
  async joinQueue(tx: Tx, userId: string, monthly: Fils): Promise<string> {
    const tier = await this.assertCanJoin(userId, monthly, tx);
    const { version, config } = await this.settings.active(tx);
    const n = config.circle.membersPerCircle;
    const candidates = await tx.execute(sql`
      SELECT c.id FROM circles c
      WHERE c.status = 'FORMING' AND c.monthly_fils = ${monthly} AND c.config_version = ${version}
        AND NOT EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.user_id = ${userId})
        AND (SELECT count(*) FROM circle_members m WHERE m.circle_id = c.id AND m.status = 'QUEUED') < ${n}
      ORDER BY c.created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED`);
    const circleId =
      (candidates.rows[0] as { id: string } | undefined)?.id ??
      (await this.store.create(tx, monthly));
    const paused = (await this.breaker(tx)) === 'TRIPPED';
    await this.store.withCircle(
      circleId,
      `member:${userId}`,
      (cmd) => {
        cmd.apply({ type: 'MEMBER_JOINED', memberId: userId, tier });
        const queued = cmd.state.members.filter((m) => m.status === 'QUEUED').length;
        cmd.after.push((t) =>
          this.notifications.notify(
            t,
            userId,
            'circle.joined',
            { count: queued, total: cmd.state.n },
            `${circleId}:joined:${userId}`,
          ),
        );
        if (queued === cmd.state.n) this.startAuction(cmd, paused);
      },
      tx,
    );
    return circleId;
  }

  private startAuction(cmd: CircleCommand, paused: boolean): void {
    const seed = this.seeds.next({
      circleId: cmd.state.circleId,
      memberIds: cmd.state.members.filter((m) => m.status === 'QUEUED').map((m) => m.memberId),
    });
    const now = this.clock.now();
    cmd.apply({
      type: 'AUCTION_STARTED',
      at: now.toISOString(),
      commitment: commitmentFor(seed),
      priorityAuctionsPaused: paused,
    });
    const endsAt = new Date(now.getTime() + cmd.config.auction.auctionDurationHours * 3_600_000);
    Object.assign(cmd.patch, {
      commitment: commitmentFor(seed),
      seedEncrypted: this.crypto.encrypt(seed),
      auctionEndsAt: endsAt,
    });
    const hours = cmd.config.auction.auctionDurationHours;
    for (const m of cmd.state.members.filter((x) => x.status === 'QUEUED')) {
      cmd.after.push((t) =>
        this.notifications.notify(
          t,
          m.memberId,
          'circle.filled',
          { hours },
          `${cmd.state.circleId}:filled:${m.memberId}`,
        ),
      );
    }
  }

  async leave(userId: string, circleId: string): Promise<void> {
    await this.store.withCircle(circleId, `member:${userId}`, (cmd) => {
      cmd.apply({ type: 'MEMBER_LEFT', memberId: userId });
    });
  }

  async placeBid(userId: string, circleId: string, spot: number, amount: Fils) {
    const paused = (await this.breaker()) === 'TRIPPED';
    const { cmd } = await this.store.withCircle(circleId, `member:${userId}`, (c) => {
      const before = new Map(
        (c.state.auction?.spots ?? []).map((s) => [s.spot, this.leader(c.state, s.spot)]),
      );
      c.apply({
        type: 'BID_PLACED',
        memberId: userId,
        spot,
        amount,
        at: this.clock.now().toISOString(),
        priorityAuctionsPaused: paused,
      });
      for (const [sp, prev] of before) {
        const now = this.leader(c.state, sp);
        if (prev && prev.memberId !== userId && prev.memberId !== now?.memberId) {
          const amountKwd = now ? money(now.amount).kwd : '—';
          c.after.push((t) =>
            this.notifications.notify(
              t,
              prev.memberId,
              'auction.outbid',
              { spot: sp, amount: amountKwd },
              `${circleId}:outbid:${prev.memberId}:${c.state.auction?.bids.length ?? 0}`,
            ),
          );
        }
      }
    });
    return this.auctionView(userId, circleId, cmd.state, cmd.config);
  }

  private leader(state: CircleState, spot: number) {
    let best: { memberId: string; amount: Fils } | undefined;
    for (const b of state.auction?.bids ?? [])
      if (b.spot === spot && b.active && (!best || b.amount > best.amount)) best = b;
    return best;
  }

  /** Auction end → lock winners → reveal seed → draw → ACTIVE with a schedule. */
  async closeAuctionAndDraw(circleId: string, tx?: Tx): Promise<void> {
    await this.store.withCircle(
      circleId,
      'system:scheduler',
      async (cmd, t) => {
        if (cmd.state.status !== 'AUCTION') return;
        const now = this.clock.now().toISOString();
        if (
          cmd.state.auction &&
          !cmd.state.auction.spots.every((s) => Date.parse(s.endsAt) <= Date.parse(now))
        )
          return;
        const seed = this.crypto.decrypt(cmd.row.seedEncrypted as string);
        cmd.apply({ type: 'AUCTION_CLOSED', at: now });
        cmd.apply({ type: 'DRAW_EXECUTED', seed });
        const startDate = addDays(this.clock.today(), cmd.config.circle.firstDueAfterDrawDays);
        Object.assign(cmd.patch, { startDate, drawnAt: this.clock.now() });
        const schedule = buildSchedule(cmd.config, startDate, cmd.state.n);
        await t.insert(draws).values({
          circleId,
          algorithmVersion: DRAW_ALGORITHM_VERSION,
          commitment: cmd.state.commitment as string,
          revealedSeed: seed,
          result: cmd.state.draw,
          drawnAt: this.clock.now(),
        });
        for (const m of cmd.state.members.filter((x) => x.status === 'ACTIVE')) {
          const spot = m.spot as number;
          cmd.after.push((t2) =>
            this.notifications.notify(
              t2,
              m.memberId,
              'draw.complete',
              { spot, payoutDate: schedule[spot - 1]?.payoutDate ?? '' },
              `${circleId}:draw:${m.memberId}`,
            ),
          );
          if (m.bid > 0n) {
            cmd.after.push((t2) =>
              this.notifications.notify(
                t2,
                m.memberId,
                'auction.won',
                { spot, amount: money(m.bid).kwd },
                `${circleId}:won:${m.memberId}`,
              ),
            );
          }
        }
      },
      tx,
    );
  }

  /** Apply a successful contribution payment. `paidOn` is the Kuwait date of payment. */
  async applyContribution(
    tx: Tx,
    userId: string,
    circleId: string,
    month: number,
    paidOn: string,
  ): Promise<void> {
    await this.store.withCircle(
      circleId,
      `member:${userId}`,
      (cmd) => {
        const row = buildSchedule(cmd.config, cmd.row.startDate as string, cmd.state.n)[month - 1];
        const late = row ? paidOn > row.graceEndsOn : false;
        cmd.apply({ type: 'CONTRIBUTION_PAID', memberId: userId, month, late });
      },
      tx,
    );
    await tx
      .update(installments)
      .set({ paidAt: this.clock.now() })
      .where(
        and(
          eq(installments.circleId, circleId),
          eq(installments.month, month),
          eq(installments.userId, userId),
        ),
      );
  }

  async applyReplacement(tx: Tx, userId: string, circleId: string, spot: number): Promise<void> {
    const { state } = await this.store.read(circleId, tx);
    const tier = await this.assertCanJoin(userId, state.monthly, tx);
    await this.store.withCircle(
      circleId,
      `member:${userId}`,
      (cmd) => cmd.apply({ type: 'REPLACEMENT_JOINED', memberId: userId, tier, spot }),
      tx,
    );
  }

  /** Amount a replacement must pay now: entry fee + every month already paid out (+ prepaid). */
  replacementAmount(state: CircleState, config: SanadConfig, spot: number): Fils {
    const sl = state.slots.find((s) => s.spot === spot);
    if (!sl) throw notFound('spot');
    let months = 0;
    for (let mo = 1; mo <= state.n; mo += 1)
      if (mo <= state.monthsSettled || sl.months[mo]?.state === 'PAID') months += 1;
    return circleRules(config, state.monthly).entryFee + state.monthly * BigInt(months);
  }

  // ───────────── Queries ─────────────

  async options(userId: string): Promise<OptionsResponse> {
    const { config } = await this.settings.active();
    const user = await this.members.user(userId);
    const breaker = await this.breaker();
    const out = [];
    for (const mKwd of config.circle.allowedMonthlyAmountsKwd) {
      const monthly = kwd(mKwd);
      const rules = circleRules(config, monthly);
      const { blockers, tier } = await this.eligibility(userId, monthly, config);
      out.push({
        monthly: money(monthly),
        available: blockers.length === 0,
        blockers,
        members: rules.n,
        months: rules.n,
        pot: money(rules.pot),
        entryFee: money(rules.entryFee),
        totalContributions: money(rules.monthly * BigInt(rules.n)),
        refundBySpot: Array.from({ length: rules.n }, (_, i) => ({
          spot: i + 1,
          refund: money(
            completionRefundAmount(rules.entryFee, refundBpsForSpot(config, rules.n, i + 1)),
          ),
        })),
        prioritySpots: Array.from({ length: rules.p }, (_, i) => {
          const spot = i + 1;
          const hb =
            tier === null ? 0n : holdbackAmount(rules.pot, holdbackBps(config, tier, spot));
          const minBid = minBidForSpot(config, monthly, spot);
          return {
            spot,
            minBid: money(minBid),
            holdback: money(hb),
            receiveAtMinBid: money(rules.pot - minBid - hb),
          };
        }),
        canBid: tier !== null && canBid(config, tier) && breaker === 'NORMAL',
      });
    }
    return {
      kycStatus: user.kycStatus,
      contractSigned: await this.contracts.hasSignedCurrent(userId),
      circuitBreaker: breaker,
      options: out,
    };
  }

  private async displayNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.dbs.db
      .select({ id: users.id, en: users.fullNameEn, ar: users.fullNameAr })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((r) => [r.id, displayName(r.en ?? r.ar)]));
  }

  async assertMember(userId: string, circleId: string): Promise<void> {
    const [m] = await this.dbs.db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
    if (!m) throw notFound('circle');
  }

  async listMine(userId: string): Promise<CircleSummary[]> {
    const rows = await this.dbs.db
      .select({ id: circles.id })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circleMembers.userId, userId), ne(circleMembers.status, 'LEFT')))
      .orderBy(asc(circles.createdAt));
    const out = [];
    for (const r of rows) {
      const { state, row, config } = await this.store.read(r.id);
      out.push(this.summary(userId, state, row, config));
    }
    return out;
  }

  private summary(
    userId: string,
    state: CircleState,
    row: { startDate: string | null; auctionEndsAt: Date | null },
    config: SanadConfig,
  ): CircleSummary {
    const startDate = row.startDate;
    const me = state.members.find((m) => m.memberId === userId);
    const mySlot = state.slots.find((s) => s.holderId === userId);
    const schedule = startDate ? buildSchedule(config, startDate, state.n) : [];
    const nextUnpaid = mySlot
      ? schedule.find(
          (r) =>
            mySlot.months[r.month] === undefined || mySlot.months[r.month]?.state === 'ADVANCED',
        )
      : undefined;
    return {
      id: state.circleId,
      status: state.status,
      monthly: money(state.monthly),
      members: state.n,
      joined: state.members.filter(
        (m) => m.status === 'QUEUED' || m.status === 'ACTIVE' || m.status.startsWith('DEFAULTED'),
      ).length,
      currentMonth: state.status === 'ACTIVE' ? Math.min(state.monthsSettled + 1, state.n) : null,
      mySpot: mySlot?.spot ?? null,
      myStatus: me?.status ?? null,
      myPayoutDate: mySlot ? (schedule[mySlot.spot - 1]?.payoutDate ?? null) : null,
      nextDue: nextUnpaid
        ? { month: nextUnpaid.month, dueDate: nextUnpaid.dueDate, amount: money(state.monthly) }
        : null,
      auctionEndsAt:
        state.status === 'AUCTION' && state.auction
          ? state.auction.spots.reduce(
              (a, sp) => (sp.endsAt > a ? sp.endsAt : a),
              row.auctionEndsAt?.toISOString() ?? '',
            )
          : null,
    };
  }

  async detail(userId: string, circleId: string): Promise<CircleDetail> {
    await this.assertMember(userId, circleId);
    const { state, row, config } = await this.store.read(circleId);
    const names = await this.displayNames(state.members.map((m) => m.memberId));
    const schedule = row.startDate ? buildSchedule(config, row.startDate, state.n) : [];
    const me = state.members.find((m) => m.memberId === userId);
    const mySlot = state.slots.find((s) => s.holderId === userId);
    return {
      ...this.summary(userId, state, row, config),
      configVersion: row.configVersion,
      startDate: row.startDate,
      commitment: state.commitment,
      timeline: state.slots.map((sl) => {
        const r = schedule[sl.spot - 1];
        const receiver = sl.holderId;
        const paidOut =
          sl.spot <= state.monthsSettled &&
          !state.heldPayouts.includes(sl.spot) &&
          receiver !== null;
        return {
          month: sl.spot,
          payoutDate: r?.payoutDate ?? null,
          receiver: receiver ? (names.get(receiver) ?? '—') : null,
          isMe: receiver === userId,
          status:
            receiver === null
              ? sl.spot <= state.monthsSettled
                ? 'RETURNED_TO_FUND'
                : 'VACANT'
              : state.heldPayouts.includes(sl.spot)
                ? 'HELD'
                : paidOut
                  ? 'PAID_OUT'
                  : 'UPCOMING',
        };
      }),
      me: me
        ? {
            status: me.status,
            spot: mySlot?.spot ?? null,
            bid: money(me.bid),
            holdbackHeld: money(me.holdbackHeld),
            payoutAmount: money(me.payoutAmount),
            expectedPayout: money(
              mySlot
                ? state.monthly * BigInt(state.n) -
                    me.bid -
                    holdbackAmount(state.monthly * BigInt(state.n), me.holdbackBps)
                : 0n,
            ),
            expectedRefund: money(
              mySlot
                ? completionRefundAmount(
                    me.entryFeePaid,
                    refundBpsForSpot(config, state.n, mySlot.spot),
                  )
                : 0n,
            ),
            entryFeePaid: money(me.entryFeePaid),
            latePayments: me.latePayments,
            refundDue: money(me.refundDue),
            payments: mySlot
              ? schedule.map((r) => ({
                  month: r.month,
                  dueDate: r.dueDate,
                  amount: money(state.monthly),
                  status: mySlot.months[r.month]?.state ?? 'UNPAID',
                }))
              : [],
          }
        : null,
    };
  }

  async auctionView(
    userId: string,
    circleId: string,
    s?: CircleState,
    cfg?: SanadConfig,
  ): Promise<AuctionView> {
    const loaded = s && cfg ? { state: s, config: cfg } : await this.store.read(circleId);
    const { state, config } = loaded;
    if (!state.auction) throw unprocessable('NO_AUCTION', 'this circle has no auction');
    const now = this.clock.now().toISOString();
    const me = state.members.find((m) => m.memberId === userId);
    if (!me) throw notFound('circle');
    const pot = state.monthly * BigInt(state.n);
    return {
      status: state.status,
      spots: publicView(state.auction, now).map((v) => {
        const hb = holdbackAmount(pot, holdbackBps(config, me.tier, v.spot));
        return {
          spot: v.spot,
          highestBid: v.highestBid === null ? null : money(v.highestBid),
          minNextBid: money(v.minNextBid),
          endsAt: v.endsAt,
          closed: v.closed,
          myStatus: myStatus(state.auction!, userId, v.spot, now),
          myHoldback: money(hb),
          /** "If you win at the minimum next bid you receive …" */
          receiveIfWinAtMin: money(pot - v.minNextBid - hb),
        };
      }),
      canBid: canBid(config, me.tier) && (await this.breaker()) === 'NORMAL',
      pot: money(pot),
      winners:
        state.status === 'AUCTION'
          ? []
          : auctionResults(state.auction, now).map((w) => ({
              spot: w.spot,
              amount: money(w.amount),
              isMe: w.memberId === userId,
            })),
    };
  }

  async drawView(userId: string, circleId: string): Promise<DrawView> {
    await this.assertMember(userId, circleId);
    const { state } = await this.store.read(circleId);
    const [d] = await this.dbs.db.select().from(draws).where(eq(draws.circleId, circleId));
    const winners = new Set(state.winners.map((w) => w.memberId));
    const drawn = state.members.filter(
      (m) => m.status !== 'LEFT' && !m.isReplacement && !winners.has(m.memberId),
    );
    return {
      algorithmVersion: DRAW_ALGORITHM_VERSION,
      commitment: state.commitment,
      revealedSeed: d?.revealedSeed ?? null,
      circleId,
      /** Inputs to re-run the draw on-device (spec §5.7). */
      memberIds: d ? drawn.map((m) => m.memberId).sort() : [],
      spots: d ? (d.result as { spot: number }[]).map((r) => r.spot).sort((a, b) => a - b) : [],
      result: d
        ? (d.result as { memberId: string; spot: number }[]).map((r) => ({
            ...r,
            isMe: r.memberId === userId,
          }))
        : [],
    };
  }

  async schedule(userId: string, circleId: string): Promise<ScheduleView> {
    await this.assertMember(userId, circleId);
    const { state, row, config } = await this.store.read(circleId);
    if (!row.startDate) return { startDate: null, rows: [] };
    const mySlot = state.slots.find((s) => s.holderId === userId);
    return {
      startDate: row.startDate,
      rows: buildSchedule(config, row.startDate, state.n).map((r) => ({
        ...r,
        receiverIsMe: mySlot?.spot === r.month,
        myInstallment: mySlot ? (mySlot.months[r.month]?.state ?? 'UNPAID') : null,
      })),
    };
  }

  /** Vacated spots a member could take over (spec §5.11). */
  async replacements(userId: string): Promise<ReplacementOffer[]> {
    const out: ReplacementOffer[] = [];
    const open = await this.dbs.db
      .select({ id: circles.id })
      .from(circles)
      .where(eq(circles.status, 'ACTIVE'));
    for (const { id } of open) {
      const { state, config } = await this.store.read(id);
      if (state.members.some((m) => m.memberId === userId)) continue;
      for (const sl of state.slots) {
        if (!canReplace(state, config, sl.spot)) continue;
        const { blockers } = await this.eligibility(userId, state.monthly, config);
        out.push({
          circleId: id,
          spot: sl.spot,
          monthly: money(state.monthly),
          payNow: money(this.replacementAmount(state, config, sl.spot)),
          available: blockers.length === 0,
          blockers,
        });
      }
    }
    return out;
  }

  async openCircleIds(tx: Tx = this.dbs.db): Promise<{ id: string; status: string }[]> {
    return tx
      .select({ id: circles.id, status: circles.status })
      .from(circles)
      .where(inArray(circles.status, [...OPEN_CIRCLE_STATUSES, 'CLOSED']));
  }

  assertNotDuplicateJoin(state: CircleState, userId: string): void {
    if (state.members.some((m) => m.memberId === userId))
      throw conflict('ALREADY_JOINED', 'already in this circle');
  }
}
