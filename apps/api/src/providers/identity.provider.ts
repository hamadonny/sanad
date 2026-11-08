/**
 * IdentityProvider (spec §7).
 * - MockIdentityProvider: dev; approves instantly (configurable).
 * - ManualReviewProvider: Civil ID photos + selfie go to the admin KYC queue.
 * - KuwaitMobileIdProvider: Phase 7 placeholder [LEGAL].
 */
export interface IdentitySubmission {
  userId: string;
  civilIdNumber: string;
  fullNameEn: string;
  dateOfBirth: string;
  hasDocuments: boolean;
}

export type IdentityDecision =
  { status: 'APPROVED' } | { status: 'PENDING_REVIEW' } | { status: 'REJECTED'; reason: string };

export interface IdentityProvider {
  readonly name: string;
  verify(sub: IdentitySubmission): Promise<IdentityDecision>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export class MockIdentityProvider implements IdentityProvider {
  readonly name = 'mock';
  constructor(private readonly autoApprove: boolean) {}
  async verify(sub: IdentitySubmission): Promise<IdentityDecision> {
    // Deterministic rejection for tests/demos: Civil IDs ending in 0000.
    if (sub.civilIdNumber.endsWith('0000'))
      return { status: 'REJECTED', reason: 'mock: document unreadable' };
    return this.autoApprove ? { status: 'APPROVED' } : { status: 'PENDING_REVIEW' };
  }
}

export class ManualReviewProvider implements IdentityProvider {
  readonly name = 'manual';
  async verify(sub: IdentitySubmission): Promise<IdentityDecision> {
    if (!sub.hasDocuments)
      return { status: 'REJECTED', reason: 'Civil ID front, back and selfie are required' };
    return { status: 'PENDING_REVIEW' };
  }
}

/** Phase 7 only — requires an integration agreement for Kuwait Mobile ID. [LEGAL] */
export class KuwaitMobileIdProvider implements IdentityProvider {
  readonly name = 'kuwait-mobile-id';
  verify(): Promise<IdentityDecision> {
    return Promise.reject(new Error('KuwaitMobileIdProvider is not available before Phase 7'));
  }
}
