import { Injectable } from '@nestjs/common';
import type {
  AdminAuditRow,
  AdminCircleDetail,
  AdminCircleRow,
  AdminConfigVersion,
  AdminDueRow,
  AdminLedgerTransaction,
  AdminLegalCase,
  AdminLegalCaseFile,
  AdminMemberDetail,
  AdminMemberRow,
  AdminPaymentsBoard,
  AdminRevenueReport,
  AdminTicket,
} from '@sanad/api-client';
import {
  ACCOUNTS,
  addDays,
  circleRevenue,
  circleShortfall,
  computeTier,
  daysBetween,
  holdbackAmount,
  payoutAmount,
  type CircleStats,
} from '@sanad/core';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AdminPrincipal } from '../auth/guards.js';
import { CircleStore } from '../circles/circle-store.js';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { notFound } from '../common/errors.js';
import { money } from '../common/money.js';
import { DbService } from '../db/db.service.js';
import {
  adminUsers,
  auctionBids,
  auditLogs,
  circleMembers,
  circles,
  configVersions,
  contractSignatures,
  defaults,
  draws,
  installments,
  kycVerifications,
  ledgerEntries,
  ledgerTransactions,
  legalCaseEvents,
  legalCases,
  notifications,
  payments,
  payouts,
  supportTickets,
  trustProfiles,
  users,
} from '../db/schema.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import { SettingsService } from '../settings/settings.service.js';

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : d;
const isoReq = (d: Date | string): string => (d instanceof Date ? d.toISOString() : d);

/** "Fatima A." style display name for staff lists (full names live on the member page). */
export function displayName(u: { fullNameEn: string | null; fullNameAr: string | null } | null) {
  if (!u) return null;
  return u.fullNameEn ?? u.fullNameAr ?? null;
}

/** Read-only staff (viewer) see masked phone numbers: +965 ••••2447. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}••••${phone.slice(-4)}`;
}

export const canSeePhones = (a: AdminPrincipal) => a.roles.some((r) => r !== 'viewer');

/**
 * Read models for the admin dashboard (Phase 4). Pure reads, except the legal case file, whose
 * identity data is audited like every identity read (spec §15).
 */
@Injectable()
export class AdminViewsService {
  constructor(
    private readonly dbs: DbService,
    private readonly clock: ClockService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly store: CircleStore,
    private readonly ledger: LedgerRepository,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  /** Engine state plus the full circle row. */
  private async circleFull(id: string) {
    const { state } = await this.store.read(id);
    const [row] = await this.db.select().from(circles).where(eq(circles.id, id));
    if (!row) throw notFound('circle');
    return { state, row };
  }

  private async names(ids: (string | null)[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, fullNameEn: users.fullNameEn, fullNameAr: users.fullNameAr })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, displayName(r)]));
  }

  // ── overview extras ──

  async overviewExtras() {
    const today = this.clock.today();
    const monthStart = `${today.slice(0, 7)}-01`;
    const [volume] = await this.db
      .select({ s: sql<string>`COALESCE(SUM(${payments.amountFils}), 0)::text` })
      .from(payments)
      .where(
        and(
          inArray(payments.status, ['SUCCEEDED', 'APPLIED']),
          gte(sql`(${payments.succeededAt} AT TIME ZONE 'Asia/Kuwait')::date`, monthStart),
        ),
      );
    const [inCircles] = await this.db
      .select({ n: sql<number>`count(DISTINCT ${circleMembers.userId})::int` })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(inArray(circles.status, ['FORMING', 'AUCTION', 'DRAWING', 'ACTIVE', 'CLOSING']));
    const [kyc] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(kycVerifications)
      .where(eq(kycVerifications.status, 'PENDING_REVIEW'));
    const [failedP] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(payouts)
      .where(eq(payouts.status, 'FAILED'));
    const failedR = await this.dbs.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM refunds WHERE status = 'FAILED'`,
    );
    const [legal] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(legalCases)
      .where(sql`${legalCases.status} <> 'CLOSED'`);
    return {
      monthlyVolume: money(BigInt(volume?.s ?? '0')),
      membersInCircles: inCircles?.n ?? 0,
      kycPending: kyc?.n ?? 0,
      failedDisbursements: (failedP?.n ?? 0) + (failedR.rows[0]?.n ?? 0),
      openLegalCases: legal?.n ?? 0,
    };
  }

  // ── circles ──

  async circles(status?: string): Promise<AdminCircleRow[]> {
    const rows = await this.db
      .select({
        id: circles.id,
        status: circles.status,
        monthlyFils: circles.monthlyFils,
        members: circles.members,
        startDate: circles.startDate,
        createdAt: circles.createdAt,
        filled: sql<number>`(SELECT count(*)::int FROM circle_members m WHERE m.circle_id = ${circles.id} AND m.status <> 'LEFT')`,
      })
      .from(circles)
      .where(status ? eq(circles.status, status) : undefined)
      .orderBy(desc(circles.createdAt))
      .limit(300);
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      monthly: money(r.monthlyFils),
      members: r.members,
      filled: r.filled,
      startDate: r.startDate,
      createdAt: isoReq(r.createdAt),
    }));
  }

  async circle(id: string): Promise<AdminCircleDetail> {
    const { state, row } = await this.circleFull(id);
    const pot = row.monthlyFils * BigInt(row.members);
    const roster = await this.db
      .select()
      .from(circleMembers)
      .where(eq(circleMembers.circleId, id))
      .orderBy(asc(circleMembers.spot));
    const bids = await this.db
      .select()
      .from(auctionBids)
      .where(eq(auctionBids.circleId, id))
      .orderBy(desc(auctionBids.seq));
    const [draw] = await this.db.select().from(draws).where(eq(draws.circleId, id));
    const inst = await this.db
      .select()
      .from(installments)
      .where(eq(installments.circleId, id))
      .orderBy(asc(installments.month), asc(installments.spot));
    const names = await this.names([
      ...roster.map((r) => r.userId),
      ...bids.map((b) => b.userId),
      ...inst.map((i) => i.userId),
    ]);
    const months = new Map<number, (typeof inst)[number][]>();
    for (const i of inst) months.set(i.month, [...(months.get(i.month) ?? []), i]);
    const schedule = [...months.entries()].map(([month, rows]) => {
      const recipient = rows.find((r) => r.spot === month);
      const paid = rows.filter((r) => r.status !== 'UNPAID').length;
      return {
        month,
        dueDate: rows[0]!.dueDate,
        payoutDate: rows[0]!.payoutDate,
        recipientSpot: month,
        recipientName: recipient?.userId ? (names.get(recipient.userId) ?? null) : null,
        paid,
        unpaid: rows.length - paid,
        total: rows.length,
      };
    });
    const stats = Object.fromEntries(
      Object.entries(state.stats as CircleStats).map(([k, v]) => [k, money(v)]),
    );
    return {
      id: row.id,
      status: row.status,
      monthly: money(row.monthlyFils),
      pot: money(pot),
      members: row.members,
      configVersion: row.configVersion,
      startDate: row.startDate,
      formingDeadline: isoReq(row.formingDeadline),
      auctionEndsAt: iso(row.auctionEndsAt),
      closedAt: iso(row.closedAt),
      createdAt: isoReq(row.createdAt),
      commitment: row.commitment,
      roster: roster.map((m) => ({
        userId: m.userId,
        name: names.get(m.userId) ?? '—',
        status: m.status,
        spot: m.spot,
        originalSpot: m.originalSpot,
        tierAtJoin: m.tierAtJoin,
        holdbackPct: m.holdbackBps / 100,
        bid: money(m.bidFils),
        isReplacement: m.isReplacement,
        receivedPayout: m.receivedPayout,
      })),
      bids: bids.map((b) => ({
        seq: b.seq,
        spot: b.spot,
        name: names.get(b.userId) ?? '—',
        amount: money(b.amountFils),
        active: b.active,
        placedAt: isoReq(b.placedAt),
      })),
      draw: draw
        ? {
            algorithmVersion: draw.algorithmVersion,
            commitment: draw.commitment,
            revealedSeed: draw.revealedSeed,
            drawnAt: isoReq(draw.drawnAt),
            result: draw.result,
          }
        : null,
      schedule,
      stats,
      ledger: await this.transactions({ circleId: id }),
    };
  }

  // ── members ──

  async members(admin: AdminPrincipal, q?: string, status?: string): Promise<AdminMemberRow[]> {
    const conds: SQL[] = [];
    const term = q?.trim();
    if (term) {
      const digits = term.replace(/\D/g, '');
      const byName = or(ilike(users.fullNameEn, `%${term}%`), ilike(users.fullNameAr, `%${term}%`));
      conds.push(digits.length >= 3 ? or(byName, ilike(users.phone, `%${digits}%`))! : byName!);
    }
    if (status) conds.push(eq(users.status, status));
    const rows = await this.db
      .select({
        id: users.id,
        phone: users.phone,
        fullNameAr: users.fullNameAr,
        fullNameEn: users.fullNameEn,
        status: users.status,
        kycStatus: users.kycStatus,
        createdAt: users.createdAt,
        activeCircles: sql<number>`(SELECT count(*)::int FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ${users.id} AND c.status IN ('FORMING','AUCTION','DRAWING','ACTIVE','CLOSING') AND m.status <> 'LEFT')`,
      })
      .from(users)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(200);
    const show = canSeePhones(admin);
    return rows.map((r) => ({
      ...r,
      phone: show ? r.phone : maskPhone(r.phone),
      createdAt: isoReq(r.createdAt),
    }));
  }

  async member(admin: AdminPrincipal, id: string): Promise<AdminMemberDetail> {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('member');
    const [trustRow] = await this.db
      .select()
      .from(trustProfiles)
      .where(eq(trustProfiles.userId, id));
    const trust = {
      completedCircles: trustRow?.completedCircles ?? 0,
      latePayments: trustRow?.latePayments ?? 0,
      defaults: trustRow?.defaults ?? 0,
      banned: trustRow?.banned ?? false,
    };
    const { config } = await this.settings.active();
    const tier = computeTier(config, trust);
    const [kyc] = await this.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.userId, id))
      .orderBy(desc(kycVerifications.createdAt))
      .limit(1);
    const memberships = await this.db
      .select({ m: circleMembers, c: { status: circles.status, monthlyFils: circles.monthlyFils } })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(eq(circleMembers.userId, id))
      .orderBy(desc(circleMembers.joinedAt));
    const pays = await this.db
      .select()
      .from(payments)
      .where(eq(payments.userId, id))
      .orderBy(desc(payments.createdAt))
      .limit(100);
    const unpaid = await this.db
      .select()
      .from(installments)
      .where(
        and(
          eq(installments.userId, id),
          inArray(installments.status, ['UNPAID', 'LATE']),
          lte(installments.dueDate, this.clock.today()),
        ),
      )
      .orderBy(asc(installments.dueDate));
    const [owed] = await this.db
      .select({ s: sql<string>`COALESCE(SUM(${ledgerEntries.amountFils}), 0)::text` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.account, ACCOUNTS.receivable(id)));
    return {
      user: {
        id: u.id,
        phone: canSeePhones(admin) ? u.phone : maskPhone(u.phone),
        language: u.language,
        status: u.status,
        kycStatus: u.kycStatus,
        fullNameAr: u.fullNameAr,
        fullNameEn: u.fullNameEn,
        civilIdExpiry: u.civilIdExpiry,
        bannedReason: u.bannedReason,
        bannedAt: iso(u.bannedAt),
        createdAt: isoReq(u.createdAt),
      },
      tier: tier.kind === 'tier' ? tier.tier : null,
      trust,
      kyc: kyc
        ? {
            id: kyc.id,
            status: kyc.status,
            nationality: kyc.nationality,
            civilIdExpiry: kyc.civilIdExpiry,
            reviewNote: kyc.reviewNote,
            submittedAt: isoReq(kyc.createdAt),
          }
        : null,
      memberships: memberships.map(({ m, c }) => ({
        circleId: m.circleId,
        circleStatus: c.status,
        monthly: money(c.monthlyFils),
        status: m.status,
        spot: m.spot,
        tierAtJoin: m.tierAtJoin,
        receivedPayout: m.receivedPayout,
        joinedAt: isoReq(m.joinedAt),
      })),
      payments: pays.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        circleId: p.circleId,
        month: p.month,
        amount: money(p.amountFils),
        penalty: money(p.penaltyFils),
        status: p.status,
        createdAt: isoReq(p.createdAt),
      })),
      unpaid: unpaid.map((i) => ({
        circleId: i.circleId,
        month: i.month,
        dueDate: i.dueDate,
        amount: money(i.amountFils),
      })),
      // Open claim after a default + months paid out without this member's money.
      amountOwed: money(
        BigInt(owed?.s ?? '0') +
          unpaid.filter((i) => i.status === 'LATE').reduce((a, i) => a + i.amountFils, 0n),
      ),
      tickets: await this.tickets({ userId: id }),
    };
  }

  // ── payments board ──

  async paymentsBoard(admin: AdminPrincipal): Promise<AdminPaymentsBoard> {
    const today = this.clock.today();
    const show = canSeePhones(admin);
    const due = await this.db
      .select({
        i: installments,
        u: { fullNameEn: users.fullNameEn, fullNameAr: users.fullNameAr, phone: users.phone },
      })
      .from(installments)
      .innerJoin(circles, eq(circles.id, installments.circleId))
      .leftJoin(users, eq(users.id, installments.userId))
      .where(
        and(
          eq(installments.status, 'UNPAID'),
          lte(installments.dueDate, today),
          inArray(circles.status, ['ACTIVE', 'CLOSING']),
        ),
      )
      .orderBy(asc(installments.dueDate))
      .limit(500);
    const toRow = ({ i, u }: (typeof due)[number]): AdminDueRow => ({
      circleId: i.circleId,
      month: i.month,
      spot: i.spot,
      userId: i.userId,
      name: displayName(u),
      phone: u?.phone ? (show ? u.phone : maskPhone(u.phone)) : null,
      amount: money(i.amountFils),
      dueDate: i.dueDate,
      defaultsOn: i.defaultsOn,
      daysLate: Math.max(0, daysBetween(i.dueDate, today)),
    });
    const defaulted = await this.db
      .select({ d: defaults, u: { fullNameEn: users.fullNameEn, fullNameAr: users.fullNameAr } })
      .from(defaults)
      .leftJoin(users, eq(users.id, defaults.userId))
      .orderBy(desc(defaults.createdAt))
      .limit(100);
    const upcoming = await this.db
      .select({
        i: installments,
        c: { monthlyFils: circles.monthlyFils, members: circles.members },
      })
      .from(installments)
      .innerJoin(circles, eq(circles.id, installments.circleId))
      .where(
        and(
          sql`${installments.spot} = ${installments.month}`,
          gte(installments.payoutDate, today),
          lte(installments.payoutDate, addDays(today, 30)),
          inArray(circles.status, ['ACTIVE']),
        ),
      )
      .orderBy(asc(installments.payoutDate))
      .limit(200);
    const recips = upcoming.map((r) => r.i.userId);
    const members = recips.length
      ? await this.db
          .select()
          .from(circleMembers)
          .where(
            inArray(
              circleMembers.userId,
              recips.filter((x): x is string => Boolean(x)),
            ),
          )
      : [];
    const names = await this.names(recips);
    return {
      today,
      dueToday: due.filter((r) => r.i.dueDate === today).map(toRow),
      late: due.filter((r) => r.i.dueDate < today).map(toRow),
      defaulted: defaulted.map(({ d, u }) => ({
        id: d.id,
        circleId: d.circleId,
        userId: d.userId,
        name: displayName(u),
        kind: d.kind,
        createdAt: isoReq(d.createdAt),
      })),
      upcomingPayouts: upcoming.map(({ i, c }) => {
        const pot = c.monthlyFils * BigInt(c.members);
        const m = members.find((x) => x.circleId === i.circleId && x.userId === i.userId);
        const expected = m
          ? payoutAmount(pot, m.bidFils, holdbackAmount(pot, BigInt(m.holdbackBps)))
          : pot;
        return {
          circleId: i.circleId,
          month: i.month,
          payoutDate: i.payoutDate,
          userId: i.userId,
          name: i.userId ? (names.get(i.userId) ?? null) : null,
          expected: money(expected),
        };
      }),
    };
  }

  // ── finance ──

  async transactions(filter: {
    circleId?: string;
    type?: string;
    account?: string;
    limit?: number;
  }): Promise<AdminLedgerTransaction[]> {
    const conds: SQL[] = [];
    if (filter.circleId) conds.push(eq(ledgerTransactions.circleId, filter.circleId));
    if (filter.type) conds.push(eq(ledgerTransactions.type, filter.type));
    if (filter.account)
      conds.push(
        inArray(
          ledgerTransactions.key,
          this.db
            .select({ k: ledgerEntries.transactionKey })
            .from(ledgerEntries)
            .where(eq(ledgerEntries.account, filter.account)),
        ),
      );
    const txns = await this.db
      .select()
      .from(ledgerTransactions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(ledgerTransactions.seq))
      .limit(Math.min(filter.limit ?? 500, 5000));
    const entries = txns.length
      ? await this.db
          .select()
          .from(ledgerEntries)
          .where(
            inArray(
              ledgerEntries.transactionKey,
              txns.map((t) => t.key),
            ),
          )
          .orderBy(asc(ledgerEntries.id))
      : [];
    return txns.map((t) => ({
      seq: t.seq.toString(),
      key: t.key,
      type: t.type,
      circleId: t.circleId,
      memberId: t.memberId,
      month: t.month,
      memo: t.memo,
      reverses: t.reverses,
      createdAt: isoReq(t.createdAt),
      entries: entries
        .filter((e) => e.transactionKey === t.key)
        .map((e) => ({ account: e.account, amount: money(e.amountFils) })),
    }));
  }

  /** Sanad's revenue per circle (D-017): earned from the draw onwards, so every started circle. */
  async revenueReport(): Promise<AdminRevenueReport> {
    const rows = await this.db
      .select({ id: circles.id })
      .from(circles)
      .where(inArray(circles.status, ['ACTIVE', 'CLOSING', 'CLOSED']))
      .orderBy(desc(circles.createdAt));
    const out: AdminRevenueReport['rows'] = [];
    let revenue = 0n;
    let shortfall = 0n;
    for (const { id } of rows) {
      const { state, row } = await this.circleFull(id);
      const s = state.stats;
      const r = circleRevenue(s);
      const sf = circleShortfall(state);
      revenue += r;
      shortfall += sf;
      out.push({
        circleId: id,
        monthly: money(row.monthlyFils),
        members: row.members,
        status: state.status,
        closedAt: iso(row.closedAt),
        organizingFees: money(s.organizingFees),
        bidRevenue: money(s.bidRevenue),
        replacementFees: money(s.replacementFees),
        recoveryFees: money(s.recoveryFees),
        revenue: money(r),
        holdbacksApplied: money(s.holdbacksApplied),
        recoveries: money(s.recoveries),
        memberShortfall: money(sf),
        latePenaltiesToCharity: money(s.latePenalties + s.defaulterPenaltiesToCharity),
      });
    }
    return {
      rows: out,
      totals: {
        revenue: money(revenue),
        memberShortfall: money(shortfall),
        charityPayable: money(await this.ledger.balance(this.db, ACCOUNTS.charity)),
      },
    };
  }


  async configVersions(): Promise<AdminConfigVersion[]> {
    const rows = await this.db
      .select({
        version: configVersions.version,
        notes: configVersions.notes,
        publishedBy: adminUsers.email,
        publishedAt: configVersions.publishedAt,
        diff: configVersions.diff,
      })
      .from(configVersions)
      .leftJoin(adminUsers, eq(adminUsers.id, configVersions.publishedBy))
      .orderBy(desc(configVersions.version));
    return rows.map((r) => ({ ...r, publishedAt: isoReq(r.publishedAt) }));
  }

  // ── legal ──

  private caseView(c: typeof legalCases.$inferSelect, name: string | null): AdminLegalCase {
    const outstanding = c.netClaimFils - c.recoveredFils;
    return {
      id: c.id,
      circleId: c.circleId,
      userId: c.userId,
      name,
      status: c.status,
      grossOwed: money(c.grossOwedFils),
      holdbackApplied: money(c.holdbackAppliedFils),
      netClaim: money(c.netClaimFils),
      recovered: money(c.recoveredFils),
      outstanding: money(outstanding > 0n ? outstanding : 0n),
      createdAt: isoReq(c.createdAt),
      updatedAt: isoReq(c.updatedAt),
    };
  }

  async legalCases(): Promise<AdminLegalCase[]> {
    const rows = await this.db
      .select()
      .from(legalCases)
      .orderBy(desc(legalCases.createdAt))
      .limit(300);
    const names = await this.names(rows.map((r) => r.userId));
    return rows.map((r) => this.caseView(r, names.get(r.userId) ?? null));
  }

  /**
   * Legal case file (spec §8): identity, signed contract, schedule vs payments, payout proof,
   * reminders, amounts and recovery status. Phase 5 renders it as PDF + ZIP; this is the data.
   */
  async legalCaseFile(
    admin: AdminPrincipal,
    id: string,
    ip: string | null,
  ): Promise<AdminLegalCaseFile> {
    const [lc] = await this.db.select().from(legalCases).where(eq(legalCases.id, id));
    if (!lc) throw notFound('legal case');
    await this.audit.log(this.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'legal.case_file',
      entity: 'legal_case',
      entityId: id,
      ip,
    });
    const [u] = await this.db.select().from(users).where(eq(users.id, lc.userId));
    const [kyc] = await this.db
      .select()
      .from(kycVerifications)
      .where(and(eq(kycVerifications.userId, lc.userId), eq(kycVerifications.status, 'APPROVED')))
      .orderBy(desc(kycVerifications.createdAt))
      .limit(1);
    const [sig] = await this.db
      .select()
      .from(contractSignatures)
      .where(
        and(eq(contractSignatures.userId, lc.userId), eq(contractSignatures.kind, 'MEMBERSHIP')),
      )
      .orderBy(desc(contractSignatures.signedAt))
      .limit(1);
    const [circle] = await this.db.select().from(circles).where(eq(circles.id, lc.circleId));
    const [membership] = await this.db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, lc.circleId), eq(circleMembers.userId, lc.userId)));
    const spot = membership?.originalSpot ?? membership?.spot ?? null;
    const schedule = spot
      ? await this.db
          .select()
          .from(installments)
          .where(and(eq(installments.circleId, lc.circleId), eq(installments.spot, spot)))
          .orderBy(asc(installments.month))
      : [];
    const pays = await this.db
      .select()
      .from(payouts)
      .where(and(eq(payouts.circleId, lc.circleId), eq(payouts.userId, lc.userId)));
    const notes = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, lc.userId))
      .orderBy(asc(notifications.createdAt))
      .limit(500);
    const events = await this.db
      .select()
      .from(legalCaseEvents)
      .where(eq(legalCaseEvents.caseId, id))
      .orderBy(asc(legalCaseEvents.createdAt));
    return {
      generatedAt: this.clock.now().toISOString(),
      case: this.caseView(lc, displayName(u ?? null)),
      events: events.map((e) => ({
        status: e.status,
        note: e.note,
        amount: e.amountFils === null ? null : money(e.amountFils),
        createdAt: isoReq(e.createdAt),
      })),
      member: {
        id: lc.userId,
        phone: u?.phone ?? '',
        fullNameAr: u?.fullNameAr ?? null,
        fullNameEn: u?.fullNameEn ?? null,
        civilIdNumber: kyc ? this.crypto.decrypt(kyc.civilIdEncrypted) : null,
        nationality: kyc?.nationality ?? null,
        dateOfBirth: kyc?.dateOfBirth ?? null,
        address: kyc?.address ?? null,
      },
      contract: sig
        ? {
            version: sig.contractVersion ?? 0,
            documentHash: sig.documentHash,
            signedAt: isoReq(sig.signedAt),
            ip: sig.ip,
          }
        : null,
      circle: {
        id: lc.circleId,
        monthly: money(circle?.monthlyFils ?? 0n),
        members: circle?.members ?? 0,
        spot,
        startDate: circle?.startDate ?? null,
      },
      schedule: schedule.map((i) => ({
        month: i.month,
        dueDate: i.dueDate,
        amount: money(i.amountFils),
        status: i.status,
        paidAt: iso(i.paidAt),
      })),
      payouts: pays.map((p) => ({
        kind: p.kind,
        month: p.month,
        amount: money(p.amountFils),
        status: p.status,
        sentAt: iso(p.sentAt),
        providerRef: p.providerRef,
      })),
      notifications: notes.map((n) => ({
        eventKey: n.eventKey,
        channels: n.channels,
        status: n.status,
        createdAt: isoReq(n.createdAt),
      })),
    };
  }

  // ── support & audit ──

  async tickets(filter: { status?: string; userId?: string } = {}): Promise<AdminTicket[]> {
    const conds: SQL[] = [];
    if (filter.status) conds.push(eq(supportTickets.status, filter.status));
    if (filter.userId) conds.push(eq(supportTickets.userId, filter.userId));
    const rows = await this.db
      .select()
      .from(supportTickets)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(supportTickets.createdAt))
      .limit(300);
    const names = await this.names(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: names.get(r.userId) ?? null,
      subject: r.subject,
      body: r.body,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: isoReq(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }));
  }

  async auditLog(filter: {
    action?: string;
    actorId?: string;
    limit?: number;
  }): Promise<AdminAuditRow[]> {
    const conds: SQL[] = [];
    if (filter.action) conds.push(ilike(auditLogs.action, `${filter.action}%`));
    if (filter.actorId) conds.push(eq(auditLogs.actorId, filter.actorId));
    const rows = await this.db
      .select({ a: auditLogs, email: adminUsers.email })
      .from(auditLogs)
      .leftJoin(
        adminUsers,
        and(eq(auditLogs.actorType, 'admin'), eq(sql`${adminUsers.id}::text`, auditLogs.actorId)),
      )
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(Math.min(filter.limit ?? 300, 2000));
    return rows.map(({ a, email }) => ({
      id: a.id.toString(),
      actorType: a.actorType,
      actorId: a.actorId,
      actorEmail: email,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      details: a.details,
      ip: a.ip,
      createdAt: isoReq(a.createdAt),
    }));
  }
}
