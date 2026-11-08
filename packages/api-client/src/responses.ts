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
}

export interface CircleOption {
  monthly: ApiMoney;
  available: boolean;
  blockers: string[];
  members: number;
  months: number;
  pot: ApiMoney;
  entryFee: ApiMoney;
  totalContributions: ApiMoney;
  refundBySpot: { spot: number; refund: ApiMoney }[];
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
  circuitBreaker: 'NORMAL' | 'TRIPPED';
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

export type InstallmentState = 'UNPAID' | 'PAID' | 'ADVANCED' | 'REPAID' | 'WAIVED';

export interface CircleDetail extends CircleSummary {
  configVersion: number;
  startDate: string | null;
  commitment: string | null;
  timeline: {
    month: number;
    payoutDate: string | null;
    receiver: string | null;
    isMe: boolean;
    status: 'PAID_OUT' | 'UPCOMING' | 'HELD' | 'VACANT' | 'RETURNED_TO_FUND';
  }[];
  me: {
    status: string;
    spot: number | null;
    bid: ApiMoney;
    holdbackHeld: ApiMoney;
    payoutAmount: ApiMoney;
    /** Pot − bid − holdback: what this member will receive in their month. */
    expectedPayout: ApiMoney;
    entryFeePaid: ApiMoney;
    latePayments: number;
    refundDue: ApiMoney;
    /** Completion refund this member earns if they finish in good standing. */
    expectedRefund: ApiMoney;
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
  available: boolean;
  blockers: string[];
}

export type PaymentPurpose = 'ENTRY_FEE' | 'CONTRIBUTION' | 'REPLACEMENT';
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
