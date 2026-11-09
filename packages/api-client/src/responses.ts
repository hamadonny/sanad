/**
 * Response shapes of the Sanad API. The API's services are annotated with these types, so the
 * compiler keeps server and clients in sync. Money is always `ApiMoney` (D-001).
 */

export interface ApiMoney {
  /** Integer fils as a decimal string, e.g. "955000". */
  fils: string;
  /** Display string with exactly 3 decimals, e.g. "955.000". */
  kwd: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OtpRequestResponse {
  expiresIn: number;
  /** Development only (mock SMS): the code that was "sent". Never present in production. */
  devCode?: string;
  /** Development only: this phone signs in with `devLogin()`, no code needed. */
  devLogin?: boolean;
}

export interface OtpVerifyResponse extends TokenPair {
  userId: string;
  isNew: boolean;
}

export type KycStatus = 'NONE' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface MeResponse {
  id: string;
  phone: string;
  language: string;
  status: string;
  kycStatus: string;
  fullNameAr: string | null;
  fullNameEn: string | null;
  civilIdExpiry: string | null;
  /** Share of paid contributions that were on time (0..1); null before the first payment. */
  onTimeRate: number | null;
  inOpenCircle: boolean;
  trust: {
    tier: 0 | 1 | 2 | null;
    banned: boolean;
    completedCircles: number;
    latePayments: number;
    defaults: number;
    nextTier: {
      tier: number;
      completedCirclesNeeded: number;
      maxLatePayments: number | null;
    } | null;
  };
}

export interface KycStatusResponse {
  status: string;
  lastSubmission: {
    id: string;
    status: string;
    reason: string | null;
    submittedAt: string | Date;
  } | null;
}

export interface ContractResponse {
  version: number;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  sha256: string;
  signed: boolean;
  /** Lawyer / Shariah review status of this contract [LEGAL][SHARIAH]. */
  legal: LegalStatus;
}

export interface CircleOption {
  monthly: ApiMoney;
  available: boolean;
  blockers: string[];
  members: number;
  months: number;
  pot: ApiMoney;
  /** One-time organising fee (D-017: 3% of the pot), refunded if the circle never starts. */
  organizingFee: ApiMoney;
  totalContributions: ApiMoney;
  prioritySpots: {
    spot: number;
    minBid: ApiMoney;
    holdback: ApiMoney;
    receiveAtMinBid: ApiMoney;
  }[];
  canBid: boolean;
}

export interface OptionsResponse {
  kycStatus: string;
  contractSigned: boolean;
  options: CircleOption[];
}

export type CircleStatus =
  'FORMING' | 'AUCTION' | 'DRAWING' | 'ACTIVE' | 'CLOSING' | 'CLOSED' | 'CANCELLED';

export interface CircleSummary {
  id: string;
  status: CircleStatus;
  monthly: ApiMoney;
  members: number;
  joined: number;
  currentMonth: number | null;
  mySpot: number | null;
  myStatus: string | null;
  myPayoutDate: string | null;
  nextDue: { month: number; dueDate: string; amount: ApiMoney } | null;
  auctionEndsAt: string | null;
}

/**
 * UNPAID: not paid yet. LATE: its month was paid out without it, still owed.
 * COVERED: the member defaulted; the month was (partly) covered from their holdback or spot.
 * WAIVED: a vacated spot's own month.
 */
export type InstallmentState = 'UNPAID' | 'PAID' | 'LATE' | 'COVERED' | 'WAIVED';

export interface CircleDetail extends CircleSummary {
  configVersion: number;
  startDate: string | null;
  commitment: string | null;
  timeline: {
    month: number;
    payoutDate: string | null;
    receiver: string | null;
    isMe: boolean;
    /** VACANT: a vacated spot's month, shared out to repair the months it missed. */
    status: 'PAID_OUT' | 'UPCOMING' | 'HELD' | 'VACANT';
  }[];
  me: {
    status: string;
    spot: number | null;
    bid: ApiMoney;
    holdbackHeld: ApiMoney;
    payoutAmount: ApiMoney;
    /** Pot − bid − holdback if everyone pays: what this member receives in their month. */
    expectedPayout: ApiMoney;
    organizingFeePaid: ApiMoney;
    latePayments: number;
    /** Months this member still owes (late), or the open claim after a default. */
    owed: ApiMoney;
    refundDue: ApiMoney;
    payments: { month: number; dueDate: string; amount: ApiMoney; status: InstallmentState }[];
  } | null;
}

export type BidStatus = 'NONE' | 'LEADING' | 'OUTBID' | 'WON' | 'LOST';

export interface AuctionView {
  status: string;
  spots: {
    spot: number;
    highestBid: ApiMoney | null;
    minNextBid: ApiMoney;
    endsAt: string;
    closed: boolean;
    myStatus: BidStatus;
    myHoldback: ApiMoney;
    receiveIfWinAtMin: ApiMoney;
  }[];
  canBid: boolean;
  pot: ApiMoney;
  winners: { spot: number; amount: ApiMoney; isMe: boolean }[];
}

export interface DrawView {
  algorithmVersion: number;
  commitment: string | null;
  revealedSeed: string | null;
  circleId: string;
  memberIds: string[];
  spots: number[];
  result: { memberId: string; spot: number; isMe: boolean }[];
}

export interface ScheduleView {
  startDate: string | null;
  rows: {
    month: number;
    dueDate: string;
    graceEndsOn: string;
    payoutDate: string;
    defaultsOn: string;
    receiverIsMe: boolean;
    myInstallment: InstallmentState | null;
  }[];
}

export interface ReplacementOffer {
  circleId: string;
  spot: number;
  monthly: ApiMoney;
  payNow: ApiMoney;
  catchUp: ApiMoney;
  replacementFee: ApiMoney;
  available: boolean;
  blockers: string[];
}

export type PaymentPurpose = 'ORGANIZING_FEE' | 'CONTRIBUTION' | 'REPLACEMENT';
export type PaymentStatus =
  'PENDING' | 'SUCCEEDED' | 'APPLIED' | 'FAILED' | 'REFUND_REQUIRED' | 'REFUNDED';

export interface PaymentView {
  id: string;
  purpose: string;
  circleId: string | null;
  month: number | null;
  spot: number | null;
  amount: ApiMoney;
  penalty: ApiMoney;
  status: string;
  createdAt: string | Date;
  succeededAt: string | Date | null;
  failureReason: string | null;
}

export interface IntentResponse {
  payment: PaymentView;
  checkoutUrl: string;
}

export interface NotificationView {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  data: unknown;
  createdAt: string | Date;
  readAt: string | Date | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

/** Founder-uploaded legal document (lawyer's contract or Shariah review). */
export interface LegalDocument {
  id: string;
  kind: string;
  contractVersion: number | null;
  title: string;
  reviewer: string | null;
  reviewedOn: string | null;
  status: string;
  notes: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/** Legal review status shown to members and printed on contracts [LEGAL][SHARIAH]. */
export interface LegalStatus {
  contractVersion: number;
  /** The lawyer's final contract has been uploaded for the current version. */
  lawyerApproved: boolean;
  contractDocument: { id: string; title: string; uploadedAt: string } | null;
  shariah: {
    id: string;
    status: string;
    reviewer: string | null;
    reviewedOn: string | null;
    title: string;
    /** Members can download it (approved reviews only). */
    downloadable: boolean;
  } | null;
}

export interface SignatureView {
  id: string;
  kind: 'MEMBERSHIP' | 'ADDENDUM' | string;
  contractVersion: number | null;
  circleId: string | null;
  documentHash: string;
  signedAt: string;
  hasPdf: boolean;
}

export interface AddendumView {
  circleId: string;
  spot: number;
  months: number;
  monthly: ApiMoney;
  pot: ApiMoney;
  bid: ApiMoney;
  holdback: ApiMoney;
  holdbackPct: number;
  expectedPayout: ApiMoney;
  payoutDate: string;
  schedule: {
    month: number;
    dueDate: string;
    payoutDate: string;
    amount: ApiMoney;
    recipientSpot: number;
  }[];
  documentHash: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  signatureId: string | null;
}
