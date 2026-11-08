import { Injectable } from '@nestjs/common';
import { computeTier, type TrustProfile } from '@sanad/core';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { conflict, notFound } from '../common/errors.js';
import { DbService, type Tx } from '../db/db.service.js';
import { circleMembers, circles, trustProfiles, users } from '../db/schema.js';
import { SettingsService } from '../settings/settings.service.js';

export const OPEN_CIRCLE_STATUSES = ['FORMING', 'AUCTION', 'DRAWING', 'ACTIVE', 'CLOSING'];
export const MEMBERSHIP_COUNTS = ['QUEUED', 'ACTIVE'];

@Injectable()
export class MembersService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
  ) {}

  async user(userId: string, tx: Tx = this.dbs.db) {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound('user');
    return u;
  }

  async trustProfile(userId: string, tx: Tx = this.dbs.db): Promise<TrustProfile> {
    const [p] = await tx.select().from(trustProfiles).where(eq(trustProfiles.userId, userId));
    const u = await this.user(userId, tx);
    return {
      completedCircles: p?.completedCircles ?? 0,
      latePayments: p?.latePayments ?? 0,
      defaults: p?.defaults ?? 0,
      banned: (p?.banned ?? false) || u.status === 'BANNED',
    };
  }

  /** Circles the member is currently in (any open state). */
  async activeCircleCount(userId: string, tx: Tx = this.dbs.db): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(
        and(
          eq(circleMembers.userId, userId),
          inArray(circles.status, OPEN_CIRCLE_STATUSES),
          inArray(circleMembers.status, MEMBERSHIP_COUNTS),
        ),
      );
    return row?.n ?? 0;
  }

  async me(userId: string) {
    const u = await this.user(userId);
    const profile = await this.trustProfile(userId);
    const { config } = await this.settings.active();
    const tier = computeTier(config, profile);
    const next =
      tier.kind === 'tier' && tier.tier < 2 ? config.risk.tiers[tier.tier + 1] : undefined;
    return {
      id: u.id,
      phone: u.phone,
      language: u.language,
      status: u.status,
      kycStatus: u.kycStatus,
      fullNameAr: u.fullNameAr,
      fullNameEn: u.fullNameEn,
      civilIdExpiry: u.civilIdExpiry,
      trust: {
        ...profile,
        tier: tier.kind === 'tier' ? tier.tier : null,
        banned: tier.kind === 'banned',
        nextTier: next
          ? {
              tier: next.tier,
              completedCirclesNeeded: Math.max(
                0,
                next.minCompletedCircles - profile.completedCircles,
              ),
              maxLatePayments: next.maxLatePayments,
            }
          : null,
      },
    };
  }

  async updateLanguage(userId: string, language: 'ar' | 'en') {
    await this.dbs.db.update(users).set({ language }).where(eq(users.id, userId));
    return this.me(userId);
  }

  /** Spec §9: deleting the account is blocked while the member is in an open circle. */
  async deleteAccount(userId: string): Promise<void> {
    const open = await this.dbs.db
      .select({ id: circles.id })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(
        and(
          eq(circleMembers.userId, userId),
          notInArray(circles.status, ['CLOSED', 'CANCELLED']),
          inArray(circleMembers.status, ['QUEUED', 'ACTIVE', 'DEFAULTED_POST_PAYOUT']),
        ),
      );
    if (open.length > 0)
      throw conflict(
        'IN_ACTIVE_CIRCLE',
        'you cannot delete your account while you are in a circle',
      );
    await this.dbs.db
      .update(users)
      .set({ status: 'DELETED', phone: sql`${users.phone} || ':deleted:' || ${users.id}` })
      .where(eq(users.id, userId));
  }
}
