import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { conflict, notFound, unprocessable } from '../common/errors.js';
import { DbService, type Tx } from '../db/db.service.js';
import { kycVerifications, users } from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../providers/identity.provider.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../providers/storage.provider.js';
import { AuditService } from '../audit/audit.service.js';

export interface KycInput {
  fullNameAr: string;
  fullNameEn: string;
  civilIdNumber: string;
  nationality: string;
  dateOfBirth: string;
  civilIdExpiry: string;
  address: string;
  employer?: string | undefined;
  incomeBand?: string | undefined;
}

export interface KycFiles {
  front?: { buffer: Buffer; mimetype: string } | undefined;
  back?: { buffer: Buffer; mimetype: string } | undefined;
  selfie?: { buffer: Buffer; mimetype: string } | undefined;
}

@Injectable()
export class KycService {
  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async submit(userId: string, input: KycInput, files: KycFiles) {
    if (!/^\d{12}$/.test(input.civilIdNumber))
      throw unprocessable('INVALID_CIVIL_ID', 'Civil ID number must be 12 digits');
    if (input.civilIdExpiry < this.clock.today())
      throw unprocessable('CIVIL_ID_EXPIRED', 'Civil ID has expired');
    const hash = this.crypto.blindIndex(`civil:${input.civilIdNumber}`);
    const [dup] = await this.dbs.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.civilIdHash, hash), ne(users.id, userId)));
    if (dup)
      throw conflict(
        'DUPLICATE_CIVIL_ID',
        'this Civil ID is already registered to another account',
      );
    const [current] = await this.dbs.db
      .select({ kycStatus: users.kycStatus })
      .from(users)
      .where(eq(users.id, userId));
    if (current?.kycStatus === 'APPROVED')
      throw conflict('ALREADY_VERIFIED', 'identity is already verified');
    if (current?.kycStatus === 'PENDING_REVIEW')
      throw conflict('ALREADY_PENDING', 'a submission is already under review');

    const put = (f: KycFiles['front'], prefix: string) =>
      f ? this.storage.put(prefix, f.buffer, f.mimetype) : Promise.resolve(null);
    const [frontDocKey, backDocKey, selfieKey] = await Promise.all([
      put(files.front, 'kyc-front'),
      put(files.back, 'kyc-back'),
      put(files.selfie, 'kyc-selfie'),
    ]);
    const decision = await this.identity.verify({
      userId,
      civilIdNumber: input.civilIdNumber,
      fullNameEn: input.fullNameEn,
      dateOfBirth: input.dateOfBirth,
      hasDocuments: Boolean(frontDocKey && backDocKey && selfieKey),
    });

    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .insert(kycVerifications)
        .values({
          userId,
          provider: this.identity.name,
          status: decision.status,
          fullNameAr: input.fullNameAr,
          fullNameEn: input.fullNameEn,
          civilIdEncrypted: this.crypto.encrypt(input.civilIdNumber),
          civilIdHash: hash,
          nationality: input.nationality,
          dateOfBirth: input.dateOfBirth,
          civilIdExpiry: input.civilIdExpiry,
          address: input.address,
          employer: input.employer ?? null,
          incomeBand: input.incomeBand ?? null,
          frontDocKey,
          backDocKey,
          selfieKey,
          reviewNote: decision.status === 'REJECTED' ? decision.reason : null,
          reviewedAt: decision.status === 'PENDING_REVIEW' ? null : this.clock.now(),
        })
        .returning();
      await this.applyDecision(
        tx,
        row!.id,
        decision.status,
        decision.status === 'REJECTED' ? decision.reason : null,
        null,
      );
      return { id: row!.id, status: decision.status };
    });
  }

  async applyDecision(
    tx: Tx,
    kycId: string,
    status: 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW',
    reason: string | null,
    reviewerId: string | null,
  ): Promise<void> {
    const [k] = await tx.select().from(kycVerifications).where(eq(kycVerifications.id, kycId));
    if (!k) throw notFound('KYC submission');
    if (reviewerId) {
      if (k.status !== 'PENDING_REVIEW')
        throw conflict('ALREADY_REVIEWED', 'submission was already reviewed');
      await tx
        .update(kycVerifications)
        .set({ status, reviewerId, reviewNote: reason, reviewedAt: this.clock.now() })
        .where(eq(kycVerifications.id, kycId));
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: reviewerId,
        action: `kyc.${status.toLowerCase()}`,
        entity: 'kyc',
        entityId: kycId,
        details: { reason },
      });
    }
    if (status === 'APPROVED') {
      const [dup] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.civilIdHash, k.civilIdHash), ne(users.id, k.userId)));
      if (dup)
        throw conflict(
          'DUPLICATE_CIVIL_ID',
          'this Civil ID is already registered to another account',
        );
      await tx
        .update(users)
        .set({
          kycStatus: 'APPROVED',
          fullNameAr: k.fullNameAr,
          fullNameEn: k.fullNameEn,
          civilIdHash: k.civilIdHash,
          civilIdExpiry: k.civilIdExpiry,
        })
        .where(eq(users.id, k.userId));
      await this.notifications.notify(tx, k.userId, 'kyc.approved', {}, `kyc.approved:${kycId}`);
    } else if (status === 'REJECTED') {
      await tx.update(users).set({ kycStatus: 'REJECTED' }).where(eq(users.id, k.userId));
      await this.notifications.notify(
        tx,
        k.userId,
        'kyc.rejected',
        { reason: reason ?? '' },
        `kyc.rejected:${kycId}`,
      );
    } else {
      await tx.update(users).set({ kycStatus: 'PENDING_REVIEW' }).where(eq(users.id, k.userId));
    }
  }

  async status(userId: string) {
    const [k] = await this.dbs.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.userId, userId))
      .orderBy(desc(kycVerifications.createdAt))
      .limit(1);
    const [u] = await this.dbs.db
      .select({ kycStatus: users.kycStatus })
      .from(users)
      .where(eq(users.id, userId));
    return {
      status: u?.kycStatus ?? 'NONE',
      lastSubmission: k
        ? { id: k.id, status: k.status, reason: k.reviewNote, submittedAt: k.createdAt }
        : null,
    };
  }
}
