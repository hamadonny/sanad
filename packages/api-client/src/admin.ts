/**
 * Admin dashboard response shapes (Phase 4). The API's admin services are annotated with these
 * types (D-010), so the dashboard and the API cannot drift apart. Dates are ISO strings.
 */
import type { ApiMoney, LegalStatus, TokenPair } from './responses.js';

export type AdminRole = 'super_admin' | 'ops' | 'kyc_reviewer' | 'finance' | 'legal' | 'viewer';

export interface AdminLoginResponse extends TokenPair {
  roles: AdminRole[];
}

export interface AdminMe {
  id: string;
  email: string;
  roles: AdminRole[];
}

export interface AdminOverview {
  circles: Record<string, number>;
  activeMembers: number;
  membersInCircles: number;
  monthlyVolume: ApiMoney;
  defaultsThisMonth: number;
  /** Sanad's revenue (D-017): organising fees, bids and the other fees. */
  revenue: {
    total: ApiMoney;
    organizingFees: ApiMoney;
    bidRevenue: ApiMoney;
    otherFees: ApiMoney;
  };
  /** Organising fees of circles still forming (refundable until the draw). */
  feesHeld: ApiMoney;
  /** Holdbacks held for members until their circle closes. */
  holdbacksHeld: ApiMoney;
  /** Money members are short because of defaults (Sanad does not cover it). */
  memberShortfall: ApiMoney;
  /** Open claims against post-payout defaulters (legal recovery). */
  openClaims: ApiMoney;
  charityPayable: ApiMoney;
  kycPending: number;
  failedDisbursements: number;
  openLegalCases: number;
  /** Launch readiness: lawyer's contract and Shariah review uploaded? [LEGAL][SHARIAH] */
  legal: LegalStatus;
  note: string;
}

export interface AdminKycRow {
  id: string;
  userId: string;
  fullNameEn: string;
  fullNameAr: string;
  status: string;
  submittedAt: string;
  hasDocuments: boolean;
}

export interface AdminKycDetail {
  id: string;
  userId: string;
  provider: string;
  status: string;
  fullNameAr: string;
  fullNameEn: string;
  civilIdNumber: string;
  nationality: string;
  dateOfBirth: string;
  civilIdExpiry: string;
  address: string;
  employer: string | null;
  incomeBand: string | null;
  frontDocKey: string | null;
  backDocKey: string | null;
  selfieKey: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface AdminCircleRow {
  id: string;
  status: string;
  monthly: ApiMoney;
  members: number;
  filled: number;
  startDate: string | null;
  createdAt: string;
}

export interface AdminCircleMember {
  userId: string;
  name: string;
  status: string;
  spot: number | null;
  originalSpot: number | null;
  tierAtJoin: number;
  holdbackPct: number;
  bid: ApiMoney;
  isReplacement: boolean;
  receivedPayout: boolean;
}

export interface AdminCircleMonth {
  month: number;
  dueDate: string;
  payoutDate: string;
  recipientName: string | null;
  recipientSpot: number;
  paid: number;
  unpaid: number;
  total: number;
}

export interface AdminLedgerEntry {
  account: string;
  amount: ApiMoney;
}

export interface AdminLedgerTransaction {
  seq: string;
  key: string;
  type: string;
  circleId: string | null;
  memberId: string | null;
  month: number | null;
  memo: string | null;
  reverses: string | null;
  createdAt: string;
  entries: AdminLedgerEntry[];
}

export interface AdminCircleDetail {
  id: string;
  status: string;
  monthly: ApiMoney;
  pot: ApiMoney;
  members: number;
  configVersion: number;
  startDate: string | null;
  formingDeadline: string;
  auctionEndsAt: string | null;
  closedAt: string | null;
  createdAt: string;
  roster: AdminCircleMember[];
  bids: {
    seq: number;
    spot: number;
    name: string;
    amount: ApiMoney;
    active: boolean;
    placedAt: string;
  }[];
  draw: {
    algorithmVersion: number;
    commitment: string;
    revealedSeed: string;
    drawnAt: string;
    result: unknown;
  } | null;
  /** Commitment published before the draw (seed stays encrypted until reveal). */
  commitment: string | null;
  schedule: AdminCircleMonth[];
  stats: Record<string, ApiMoney>;
  ledger: AdminLedgerTransaction[];
}

export interface AdminMemberRow {
  id: string;
  phone: string;
  fullNameAr: string | null;
  fullNameEn: string | null;
  status: string;
  kycStatus: string;
  activeCircles: number;
  createdAt: string;
}

export interface AdminMemberDetail {
  user: {
    id: string;
    phone: string;
    language: string;
    status: string;
    kycStatus: string;
    fullNameAr: string | null;
    fullNameEn: string | null;
    civilIdExpiry: string | null;
    bannedReason: string | null;
    bannedAt: string | null;
    createdAt: string;
  };
  tier: number | null;
  trust: { completedCircles: number; latePayments: number; defaults: number; banned: boolean };
  kyc: {
    id: string;
    status: string;
    nationality: string;
    civilIdExpiry: string;
    reviewNote: string | null;
    submittedAt: string;
  } | null;
  memberships: {
    circleId: string;
    circleStatus: string;
    monthly: ApiMoney;
    status: string;
    spot: number | null;
    tierAtJoin: number;
    receivedPayout: boolean;
    joinedAt: string;
  }[];
  payments: {
    id: string;
    purpose: string;
    circleId: string | null;
    month: number | null;
    amount: ApiMoney;
    penalty: ApiMoney;
    status: string;
    createdAt: string;
  }[];
  unpaid: { circleId: string; month: number; dueDate: string; amount: ApiMoney }[];
  amountOwed: ApiMoney;
  tickets: AdminTicket[];
}

export interface AdminDueRow {
  circleId: string;
  month: number;
  spot: number;
  userId: string | null;
  name: string | null;
  phone: string | null;
  amount: ApiMoney;
  dueDate: string;
  defaultsOn: string;
  daysLate: number;
}

export interface AdminPaymentsBoard {
  today: string;
  dueToday: AdminDueRow[];
  late: AdminDueRow[];
  defaulted: {
    id: string;
    circleId: string;
    userId: string;
    name: string | null;
    kind: string;
    createdAt: string;
  }[];
  upcomingPayouts: {
    circleId: string;
    month: number;
    payoutDate: string;
    userId: string | null;
    name: string | null;
    expected: ApiMoney;
  }[];
}

export interface AdminDisbursement {
  id: string;
  circleId: string | null;
  userId: string;
  kind: string;
  month?: number | null;
  amount: ApiMoney;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface AdminDisbursements {
  payouts: AdminDisbursement[];
  refunds: AdminDisbursement[];
}

export interface AdminLegalCase {
  id: string;
  circleId: string;
  userId: string;
  name: string | null;
  status: string;
  grossOwed: ApiMoney;
  holdbackApplied: ApiMoney;
  netClaim: ApiMoney;
  recovered: ApiMoney;
  outstanding: ApiMoney;
  createdAt: string;
  updatedAt: string;
}

export interface AdminLegalCaseFile {
  generatedAt: string;
  case: AdminLegalCase;
  events: { status: string; note: string | null; amount: ApiMoney | null; createdAt: string }[];
  member: {
    id: string;
    phone: string;
    fullNameAr: string | null;
    fullNameEn: string | null;
    civilIdNumber: string | null;
    nationality: string | null;
    dateOfBirth: string | null;
    address: string | null;
  };
  contract: { version: number; documentHash: string; signedAt: string; ip: string | null } | null;
  circle: {
    id: string;
    monthly: ApiMoney;
    members: number;
    spot: number | null;
    startDate: string | null;
  };
  schedule: {
    month: number;
    dueDate: string;
    amount: ApiMoney;
    status: string;
    paidAt: string | null;
  }[];
  payouts: {
    kind: string;
    month: number | null;
    amount: ApiMoney;
    status: string;
    sentAt: string | null;
    providerRef: string | null;
  }[];
  notifications: { eventKey: string; channels: string[]; status: string; createdAt: string }[];
}

export interface AdminRevenueRow {
  circleId: string;
  monthly: ApiMoney;
  members: number;
  status: string;
  closedAt: string | null;
  organizingFees: ApiMoney;
  bidRevenue: ApiMoney;
  replacementFees: ApiMoney;
  recoveryFees: ApiMoney;
  revenue: ApiMoney;
  holdbacksApplied: ApiMoney;
  recoveries: ApiMoney;
  memberShortfall: ApiMoney;
  latePenaltiesToCharity: ApiMoney;
}

export interface AdminRevenueReport {
  rows: AdminRevenueRow[];
  totals: { revenue: ApiMoney; memberShortfall: ApiMoney; charityPayable: ApiMoney };
}

export interface AdminConfigVersion {
  version: number;
  notes: string | null;
  publishedBy: string | null;
  publishedAt: string;
  diff: unknown;
}

export interface AdminTemplate {
  key: string;
  channels: string[];
  placeholders: string[];
  ar: { title: string; body: string };
  en: { title: string; body: string };
  customized: boolean;
}

export interface AdminContract {
  version: number;
  kind: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  sha256: string;
  publishedAt: string;
  signatures: number;
}

export interface FaqItem {
  id: string;
  position: number;
  questionAr: string;
  answerAr: string;
  questionEn: string;
  answerEn: string;
  published: boolean;
}

export interface AdminTicket {
  id: string;
  userId: string;
  name: string | null;
  subject: string;
  body: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface AdminAuditRow {
  id: string;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AdminErrorGroup {
  fingerprint: string;
  source: string;
  message: string;
  stack: string | null;
  context: string | null;
  platforms: string[];
  versions: string[];
  count: number;
  lastSeen: string;
}

export interface AdminAnalytics {
  from: string;
  days: number;
  rows: { day: string; event: string; platform: string; count: number }[];
  totals: Record<string, number>;
}
