import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNTS,
  circleRevenue,
  circleShortfall,
  decodeJson,
  type CircleState,
  type Fils,
} from '@sanad/core';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { TokensService } from '../auth/tokens.service.js';
import type { AdminPrincipal, AdminRole } from '../auth/guards.js';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { ApiError, conflict, notFound, unprocessable } from '../common/errors.js';
import { money } from '../common/money.js';
import { newTotpSecret, verifyTotp } from '../common/totp.js';
import { CircleStore } from '../circles/circle-store.js';
import { CirclesService } from '../circles/circles.service.js';
import { DbService } from '../db/db.service.js';
import {
  adminUsers,
  auditLogs,
  circleMembers,
  circles,
  kycVerifications,
  ledgerEntries,
  ledgerTransactions,
  legalCaseEvents,
  legalCases,
  payouts,
  refunds,
  trustProfiles,
  users,
} from '../db/schema.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { KycService } from '../kyc/kyc.service.js';
import { LedgerRepository } from '../ledger/ledger.repository.js';
import { DisbursementService } from '../payments/disbursement.service.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../providers/storage.provider.js';
import { SettingsService } from '../settings/settings.service.js';

const ADMIN_MAX_FAILURES = 5;
const ADMIN_LOCK_WINDOW_MS = 15 * 60_000;

export const LEGAL_STATUSES = [
  'OPEN',
  'SENT_TO_LAWYER',
  'FILED',
  'JUDGMENT',
  'RECOVERING',
  'CLOSED',
] as const;

/** Phase 2 admin API (the dashboard UI is Phase 4). Every mutation is audited. */
@Injectable()
export class AdminService {
  constructor(
    private readonly dbs: DbService,
    private readonly tokens: TokensService,
    private readonly crypto: CryptoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly kyc: KycService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerRepository,
    private readonly store: CircleStore,
    private readonly circles: CirclesService,
    private readonly scheduler: SchedulerService,
    private readonly disbursements: DisbursementService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ── auth (password + mandatory TOTP) ──

  async createAdmin(
    email: string,
    password: string,
    roles: AdminRole[],
  ): Promise<{ id: string; totpSecret: string }> {
    if (password.length < 12)
      throw unprocessable('WEAK_PASSWORD', 'admin passwords need at least 12 characters');
    const totpSecret = newTotpSecret();
    const [row] = await this.dbs.db
      .insert(adminUsers)
      .values({
        email: email.toLowerCase(),
        passwordHash: await this.crypto.hashPassword(password),
        totpSecretEncrypted: this.crypto.encrypt(totpSecret),
        roles,
      })
      .onConflictDoNothing()
      .returning({ id: adminUsers.id });
    if (!row) throw conflict('ADMIN_EXISTS', 'an admin with this email exists');
    return { id: row.id, totpSecret };
  }

  /**
   * Password + mandatory TOTP. After 5 failed attempts in 15 minutes the account is locked for
   * the rest of that window (failures are audited; the password is never logged).
   */
  async login(email: string, password: string, totp: string, ip: string | null) {
    const bad = new ApiError(
      HttpStatus.UNAUTHORIZED,
      'INVALID_LOGIN',
      'invalid email, password or 2FA code',
    );
    const normalized = email.toLowerCase();
    const since = new Date(this.clock.now().getTime() - ADMIN_LOCK_WINDOW_MS);
    const [fails] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'admin.login_failed'),
          eq(auditLogs.entityId, normalized),
          gt(auditLogs.createdAt, since),
        ),
      );
    if ((fails?.n ?? 0) >= ADMIN_MAX_FAILURES)
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'ADMIN_LOCKED',
        'too many failed sign-ins; try again in 15 minutes',
      );
    const fail = async () => {
      await this.audit.log(this.dbs.db, {
        actorType: 'system',
        actorId: null,
        action: 'admin.login_failed',
        entity: 'admin_email',
        entityId: normalized,
        ip,
      });
      return bad;
    };
    const [a] = await this.dbs.db.select().from(adminUsers).where(eq(adminUsers.email, normalized));
    if (!a || !a.active || !(await this.crypto.verifyPassword(password, a.passwordHash)))
      throw await fail();
    if (!verifyTotp(this.crypto.decrypt(a.totpSecretEncrypted), totp, this.clock.now().getTime()))
      throw await fail();
    await this.dbs.db
      .update(adminUsers)
      .set({ lastLoginAt: this.clock.now() })
      .where(eq(adminUsers.id, a.id));
    await this.audit.log(this.dbs.db, {
      actorType: 'admin',
      actorId: a.id,
      action: 'admin.login',
      ip,
    });
    return { ...(await this.tokens.issue('admin', a.id, { roles: a.roles })), roles: a.roles };
  }

  // ── overview ──

  async overview() {
    const counts = await this.dbs.db
      .select({ status: circles.status, n: sql<number>`count(*)::int` })
      .from(circles)
      .groupBy(circles.status);
    const [members] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.status, 'ACTIVE'));
    const [defaultsThisMonth] = await this.dbs.db
      .execute(
        sql`SELECT count(*)::int AS n FROM defaults WHERE created_at >= date_trunc('month', now())`,
      )
      .then((r) => r.rows as { n: number }[]);
    const started = await this.dbs.db
      .select({ s: circles.engineState })
      .from(circles)
      .where(inArray(circles.status, ['ACTIVE', 'CLOSING', 'CLOSED']));
    let organizing = 0n;
    let bids = 0n;
    let total = 0n;
    let shortfall = 0n;
    for (const c of started) {
      const st = decodeJson<CircleState>(c.s);
      organizing += st.stats.organizingFees;
      bids += st.stats.bidRevenue;
      total += circleRevenue(st.stats);
      shortfall += circleShortfall(st);
    }
    const [held] = (
      await this.dbs.db.execute(
        sql`SELECT COALESCE(-SUM(amount_fils), 0)::text AS s FROM ledger_entries WHERE account LIKE 'fees_held:%'`,
      )
    ).rows as { s: string }[];
    return {
      circles: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      activeMembers: members?.n ?? 0,
      defaultsThisMonth: defaultsThisMonth?.n ?? 0,
      revenue: {
        total: money(total),
        organizingFees: money(organizing),
        bidRevenue: money(bids),
        otherFees: money(total - organizing - bids),
      },
      feesHeld: money(BigInt(held?.s ?? '0')),
      holdbacksHeld: money(await this.ledger.balance(this.dbs.db, ACCOUNTS.holdbacks)),
      memberShortfall: money(shortfall),
      openClaims: money(await this.ledger.balance(this.dbs.db, ACCOUNTS.receivablesControl)),
      charityPayable: money(await this.ledger.balance(this.dbs.db, ACCOUNTS.charity)),
      note: 'Sanad organises circles and does not guarantee them (D-017).',
    };
  }

  // ── KYC ──

  async kycQueue(status = 'PENDING_REVIEW') {
    const rows = await this.dbs.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.status, status))
      .orderBy(kycVerifications.createdAt)
      .limit(100);
    return rows.map((k) => ({
      id: k.id,
      userId: k.userId,
      fullNameEn: k.fullNameEn,
      fullNameAr: k.fullNameAr,
      status: k.status,
      submittedAt: k.createdAt,
      hasDocuments: Boolean(k.frontDocKey && k.backDocKey && k.selfieKey),
    }));
  }

  /** Reading identity data is itself audited (spec §15). */
  async kycDetail(admin: AdminPrincipal, id: string, ip: string | null) {
    const [k] = await this.dbs.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.id, id));
    if (!k) throw notFound('KYC submission');
    await this.audit.log(this.dbs.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'kyc.read_identity',
      entity: 'kyc',
      entityId: id,
      ip,
    });
    return {
      ...k,
      civilIdEncrypted: undefined,
      civilIdHash: undefined,
      civilIdNumber: this.crypto.decrypt(k.civilIdEncrypted),
    };
  }

  async kycDocument(
    admin: AdminPrincipal,
    id: string,
    which: 'front' | 'back' | 'selfie',
    ip: string | null,
  ) {
    const [k] = await this.dbs.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.id, id));
    const key = k ? { front: k.frontDocKey, back: k.backDocKey, selfie: k.selfieKey }[which] : null;
    if (!key) throw notFound('document');
    await this.audit.log(this.dbs.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'kyc.read_document',
      entity: 'kyc',
      entityId: id,
      details: { which },
      ip,
    });
    return this.storage.get(key);
  }

  reviewKyc(
    admin: AdminPrincipal,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | null,
  ) {
    if (decision === 'REJECTED' && !reason)
      throw unprocessable('REASON_REQUIRED', 'a rejection needs a reason');
    return this.dbs.transaction((tx) => this.kyc.applyDecision(tx, id, decision, reason, admin.id));
  }

  // ── circles & members ──

  async listCircles(status?: string) {
    const rows = await this.dbs.db
      .select({
        id: circles.id,
        status: circles.status,
        monthlyFils: circles.monthlyFils,
        members: circles.members,
        startDate: circles.startDate,
        createdAt: circles.createdAt,
      })
      .from(circles)
      .where(status ? eq(circles.status, status) : undefined)
      .orderBy(desc(circles.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r, monthly: money(r.monthlyFils), monthlyFils: undefined }));
  }

  async circleDetail(id: string) {
    const { state, row } = await this.store.read(id);
    const txns = await this.dbs.db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.circleId, id))
      .orderBy(ledgerTransactions.seq);
    return {
      row: { ...row, engineState: undefined, seedEncrypted: undefined },
      state,
      ledger: txns,
    };
  }

  async member(id: string) {
    const [u] = await this.dbs.db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('member');
    const [trust] = await this.dbs.db
      .select()
      .from(trustProfiles)
      .where(eq(trustProfiles.userId, id));
    const memberships = await this.dbs.db
      .select()
      .from(circleMembers)
      .where(eq(circleMembers.userId, id));
    const [owed] = await this.dbs.db
      .select({ s: sql<string>`COALESCE(SUM(${ledgerEntries.amountFils}), 0)::text` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.account, ACCOUNTS.receivable(id)));
    return {
      user: { ...u, civilIdHash: undefined },
      trust,
      memberships,
      amountOwed: money(BigInt(owed?.s ?? '0')),
    };
  }

  async setBan(admin: AdminPrincipal, id: string, banned: boolean, reason: string) {
    await this.dbs.transaction(async (tx) => {
      const r = await tx
        .update(users)
        .set(
          banned
            ? { status: 'BANNED', bannedReason: reason, bannedAt: this.clock.now() }
            : { status: 'ACTIVE', bannedReason: null, bannedAt: null },
        )
        .where(eq(users.id, id))
        .returning({ id: users.id });
      if (r.length === 0) throw notFound('member');
      await tx
        .insert(trustProfiles)
        .values({ userId: id, banned })
        .onConflictDoUpdate({ target: trustProfiles.userId, set: { banned } });
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: banned ? 'member.ban' : 'member.unban',
        entity: 'user',
        entityId: id,
        details: { reason },
      });
    });
    return this.member(id);
  }

  // ── config ──

  async publishConfig(admin: AdminPrincipal, config: unknown, notes: string | null) {
    return this.dbs.transaction(async (tx) => {
      const r = await this.settings.publish(tx, config, admin.id, notes);
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'config.publish',
        entity: 'config',
        entityId: String(r.version),
        details: { diff: r.diff, notes },
      });
      return r;
    });
  }

  // ── ledger ──

  async ledgerAccounts() {
    return (await this.ledger.allBalances(this.dbs.db)).map((a) => ({
      account: a.account,
      balance: money(a.balance),
    }));
  }

  async ledgerTransactions(circleId?: string) {
    const txns = await this.dbs.db
      .select()
      .from(ledgerTransactions)
      .where(circleId ? eq(ledgerTransactions.circleId, circleId) : undefined)
      .orderBy(desc(ledgerTransactions.seq))
      .limit(500);
    const entries = txns.length
      ? await this.dbs.db
          .select()
          .from(ledgerEntries)
          .where(
            inArray(
              ledgerEntries.transactionKey,
              txns.map((t) => t.key),
            ),
          )
      : [];
    return txns.map((t) => ({
      ...t,
      entries: entries
        .filter((e) => e.transactionKey === t.key)
        .map((e) => ({ account: e.account, amount: money(e.amountFils) })),
    }));
  }

  // ── disbursements ──

  async disbursementsList(status?: string) {
    const p = await this.dbs.db
      .select()
      .from(payouts)
      .where(status ? eq(payouts.status, status) : undefined)
      .orderBy(desc(payouts.createdAt))
      .limit(200);
    const r = await this.dbs.db
      .select()
      .from(refunds)
      .where(status ? eq(refunds.status, status) : undefined)
      .orderBy(desc(refunds.createdAt))
      .limit(200);
    return {
      payouts: p.map((x) => ({ ...x, amount: money(x.amountFils) })),
      refunds: r.map((x) => ({ ...x, amount: money(x.amountFils) })),
    };
  }

  async retryDisbursement(admin: AdminPrincipal, kind: 'payout' | 'refund', id: string) {
    await this.audit.log(this.dbs.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: `${kind}.retry`,
      entityId: id,
    });
    await this.disbursements.retry(kind, id);
  }

  // ── legal ──

  legalCases() {
    return this.dbs.db.select().from(legalCases).orderBy(desc(legalCases.createdAt)).limit(200);
  }

  async updateLegalCase(
    admin: AdminPrincipal,
    id: string,
    status: (typeof LEGAL_STATUSES)[number],
    note: string | null,
    recovered: Fils | null,
  ) {
    const [lc] = await this.dbs.db.select().from(legalCases).where(eq(legalCases.id, id));
    if (!lc) throw notFound('legal case');
    await this.dbs.transaction(async (tx) => {
      if (recovered !== null && recovered > 0n) {
        await this.store.withCircle(
          lc.circleId,
          `admin:${admin.id}`,
          (cmd) =>
            cmd.apply({
              type: 'RECOVERY',
              memberId: lc.userId,
              amount: recovered,
              reference: `${id}-${lc.recoveredFils + recovered}`,
            }),
          tx,
        );
      }
      await tx
        .update(legalCases)
        .set({
          status,
          updatedAt: this.clock.now(),
          recoveredFils: sql`${legalCases.recoveredFils} + ${recovered ?? 0n}`,
        })
        .where(and(eq(legalCases.id, id)));
      await tx
        .insert(legalCaseEvents)
        .values({ caseId: id, status, note, amountFils: recovered, actorAdminId: admin.id });
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'legal.update',
        entity: 'legal_case',
        entityId: id,
        details: { status, note, recovered: recovered?.toString() },
      });
    });
    const [after] = await this.dbs.db.select().from(legalCases).where(eq(legalCases.id, id));
    return after;
  }

  auditLog(limit = 200) {
    return this.dbs.db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(limit);
  }

  async runTick(admin: AdminPrincipal) {
    await this.audit.log(this.dbs.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'jobs.tick',
    });
    return this.scheduler.tick();
  }
}
