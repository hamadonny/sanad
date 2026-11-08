/**
 * Database schema (spec §13). Money columns are BIGINT fils mapped to JS `bigint`.
 * Timestamps are stored in UTC (`timestamptz`); calendar dates (`date`) are Asia/Kuwait dates.
 *
 * Source of truth for a circle is its engine snapshot (`circles.engine_state`, produced by
 * @sanad/core) plus the append-only `circle_events`. Member, installment, bid and draw tables
 * are projections kept for queries and database-level constraints.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const fils = (name: string) => bigint(name, { mode: 'bigint' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ───────────── Members & auth ─────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  language: text('language').notNull().default('ar'),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | BANNED | DELETED
  kycStatus: text('kyc_status').notNull().default('NONE'), // NONE | PENDING_REVIEW | APPROVED | REJECTED
  fullNameAr: text('full_name_ar'),
  fullNameEn: text('full_name_en'),
  /** HMAC blind index of the Civil ID number: one account per Civil ID. */
  civilIdHash: text('civil_id_hash').unique(),
  civilIdExpiry: date('civil_id_expiry'),
  bannedReason: text('banned_reason'),
  bannedAt: ts('banned_at'),
  createdAt: createdAt(),
});

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    consumedAt: ts('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_phone_idx').on(t.phone, t.createdAt)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: text('subject_type').notNull(), // member | admin
    subjectId: uuid('subject_id').notNull(),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedById: uuid('replaced_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_family_idx').on(t.familyId)],
);

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  pushToken: text('push_token').notNull().unique(),
  platform: text('platform').notNull(), // ios | android
  createdAt: createdAt(),
});

export const kycVerifications = pgTable(
  'kyc_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    status: text('status').notNull(), // PENDING_REVIEW | APPROVED | REJECTED
    fullNameAr: text('full_name_ar').notNull(),
    fullNameEn: text('full_name_en').notNull(),
    civilIdEncrypted: text('civil_id_encrypted').notNull(),
    civilIdHash: text('civil_id_hash').notNull(),
    nationality: text('nationality').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    civilIdExpiry: date('civil_id_expiry').notNull(),
    address: text('address').notNull(),
    employer: text('employer'),
    incomeBand: text('income_band'),
    frontDocKey: text('front_doc_key'),
    backDocKey: text('back_doc_key'),
    selfieKey: text('selfie_key'),
    reviewerId: uuid('reviewer_id'),
    reviewNote: text('review_note'),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('kyc_status_idx').on(t.status, t.createdAt)],
);

export const trustProfiles = pgTable('trust_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  completedCircles: integer('completed_circles').notNull().default(0),
  latePayments: integer('late_payments').notNull().default(0),
  defaults: integer('defaults').notNull().default(0),
  banned: boolean('banned').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ───────────── Config & contracts ─────────────

export const configVersions = pgTable('config_versions', {
  version: integer('version').primaryKey(),
  config: jsonb('config').notNull(),
  diff: jsonb('diff'),
  notes: text('notes'),
  publishedBy: uuid('published_by'),
  publishedAt: ts('published_at').notNull().defaultNow(),
});

export const contracts = pgTable('contracts', {
  version: integer('version').primaryKey(),
  kind: text('kind').notNull().default('MEMBERSHIP'),
  titleAr: text('title_ar').notNull(),
  titleEn: text('title_en').notNull(),
  bodyAr: text('body_ar').notNull(),
  bodyEn: text('body_en').notNull(),
  sha256: text('sha256').notNull(),
  publishedAt: ts('published_at').notNull().defaultNow(),
});

export const contractSignatures = pgTable(
  'contract_signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(), // MEMBERSHIP | ADDENDUM
    contractVersion: integer('contract_version'),
    circleId: uuid('circle_id'),
    documentHash: text('document_hash').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    deviceId: text('device_id'),
    otpReference: text('otp_reference'),
    signedAt: ts('signed_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('signature_unique').on(t.userId, t.kind, t.contractVersion, t.circleId)],
);

// ───────────── Circles ─────────────

export const circles = pgTable(
  'circles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status').notNull(),
    monthlyFils: fils('monthly_fils').notNull(),
    members: smallint('members').notNull(),
    configVersion: integer('config_version')
      .notNull()
      .references(() => configVersions.version),
    stateVersion: integer('state_version').notNull().default(0),
    engineState: jsonb('engine_state').notNull(),
    commitment: text('commitment'),
    seedEncrypted: text('seed_encrypted'),
    formingDeadline: ts('forming_deadline').notNull(),
    auctionEndsAt: ts('auction_ends_at'),
    drawnAt: ts('drawn_at'),
    startDate: date('start_date'),
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('circles_status_idx').on(t.status, t.monthlyFils)],
);

export const circleEvents = pgTable(
  'circle_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    actor: text('actor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('circle_events_seq').on(t.circleId, t.seq)],
);

export const circleMembers = pgTable(
  'circle_members',
  {
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(),
    /** Spot currently held (null for pre-payout defaulters, whose spot was vacated). */
    spot: smallint('spot'),
    originalSpot: smallint('original_spot'),
    tierAtJoin: smallint('tier_at_join').notNull(),
    holdbackBps: integer('holdback_bps').notNull().default(0),
    bidFils: fils('bid_fils')
      .notNull()
      .default(sql`0`),
    isReplacement: boolean('is_replacement').notNull().default(false),
    receivedPayout: boolean('received_payout').notNull().default(false),
    joinedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.circleId, t.userId] }),
    uniqueIndex('circle_members_spot').on(t.circleId, t.spot),
    index('circle_members_user').on(t.userId),
  ],
);

export const auctionBids = pgTable(
  'auction_bids',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    seq: integer('seq').notNull(),
    spot: smallint('spot').notNull(),
    amountFils: fils('amount_fils').notNull(),
    active: boolean('active').notNull(),
    placedAt: ts('placed_at').notNull(),
  },
  (t) => [
    uniqueIndex('auction_bids_seq').on(t.circleId, t.seq),
    // Spec §13: one active bid per member per circle.
    uniqueIndex('auction_bids_one_active')
      .on(t.circleId, t.userId)
      .where(sql`${t.active}`),
  ],
);

export const draws = pgTable('draws', {
  circleId: uuid('circle_id')
    .primaryKey()
    .references(() => circles.id),
  algorithmVersion: smallint('algorithm_version').notNull(),
  commitment: text('commitment').notNull(),
  revealedSeed: text('revealed_seed').notNull(),
  result: jsonb('result').notNull(),
  drawnAt: ts('drawn_at').notNull(),
});

export const installments = pgTable(
  'installments',
  {
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id),
    spot: smallint('spot').notNull(),
    month: smallint('month').notNull(),
    userId: uuid('user_id'),
    amountFils: fils('amount_fils').notNull(),
    dueDate: date('due_date').notNull(),
    payoutDate: date('payout_date').notNull(),
    defaultsOn: date('defaults_on').notNull(),
    status: text('status').notNull(), // UNPAID | PAID | ADVANCED | REPAID | WAIVED
    paidAt: ts('paid_at'),
  },
  (t) => [
    primaryKey({ columns: [t.circleId, t.spot, t.month] }),
    index('installments_user').on(t.userId, t.dueDate),
  ],
);

// ───────────── Money movement ─────────────

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    purpose: text('purpose').notNull(), // ENTRY_FEE | CONTRIBUTION | REPLACEMENT
    circleId: uuid('circle_id'),
    month: smallint('month'),
    spot: smallint('spot'),
    monthlyFils: fils('monthly_fils').notNull(),
    amountFils: fils('amount_fils').notNull(),
    penaltyFils: fils('penalty_fils')
      .notNull()
      .default(sql`0`),
    status: text('status').notNull(), // PENDING | SUCCEEDED | APPLIED | FAILED | REFUND_REQUIRED | REFUNDED
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').unique(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
    succeededAt: ts('succeeded_at'),
    appliedAt: ts('applied_at'),
  },
  (t) => [index('payments_user').on(t.userId, t.createdAt)],
);

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(), // POT | HOLDBACK_RELEASE
    month: smallint('month'),
    amountFils: fils('amount_fils').notNull(),
    status: text('status').notNull(), // PENDING | SENT | FAILED
    dedupeKey: text('dedupe_key').notNull().unique(),
    providerRef: text('provider_ref'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('payouts_status').on(t.status)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    circleId: uuid('circle_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(), // ENTRY_FEE | COMPLETION | DEFAULTER | PAYMENT_REVERSAL
    paymentId: uuid('payment_id'),
    amountFils: fils('amount_fils').notNull(),
    status: text('status').notNull(), // PENDING | SENT | FAILED
    dedupeKey: text('dedupe_key').notNull().unique(),
    providerRef: text('provider_ref'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('refunds_status').on(t.status)],
);

// ───────────── Ledger (append-only; see migration triggers) ─────────────

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: text('id').primaryKey(),
  side: text('side').notNull(), // cash | claims
  normal: text('normal').notNull(), // debit | credit
  createdAt: createdAt(),
});

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    key: text('key').notNull().unique(),
    type: text('type').notNull(),
    circleId: uuid('circle_id'),
    memberId: uuid('member_id'),
    month: smallint('month'),
    memo: text('memo'),
    reverses: text('reverses'),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_tx_circle').on(t.circleId), index('ledger_tx_type').on(t.type)],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    transactionKey: text('transaction_key')
      .notNull()
      .references(() => ledgerTransactions.key),
    account: text('account')
      .notNull()
      .references(() => ledgerAccounts.id),
    amountFils: fils('amount_fils').notNull(),
    circleId: uuid('circle_id'),
    memberId: uuid('member_id'),
  },
  (t) => [
    index('ledger_entries_account').on(t.account),
    index('ledger_entries_circle').on(t.circleId),
  ],
);

// ───────────── Defaults & legal ─────────────

export const defaults = pgTable(
  'defaults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(), // PRE_PAYOUT | POST_PAYOUT
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('defaults_unique').on(t.circleId, t.userId)],
);

export const legalCases = pgTable('legal_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  circleId: uuid('circle_id')
    .notNull()
    .references(() => circles.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  status: text('status').notNull().default('OPEN'),
  grossOwedFils: fils('gross_owed_fils').notNull(),
  holdbackAppliedFils: fils('holdback_applied_fils').notNull(),
  netClaimFils: fils('net_claim_fils').notNull(),
  recoveredFils: fils('recovered_fils')
    .notNull()
    .default(sql`0`),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const legalCaseEvents = pgTable('legal_case_events', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => legalCases.id),
  status: text('status').notNull(),
  note: text('note'),
  amountFils: fils('amount_fils'),
  actorAdminId: uuid('actor_admin_id'),
  createdAt: createdAt(),
});

// ───────────── Notifications, support, audit, admin ─────────────

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    key: text('key').notNull(),
    language: text('language').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    channels: text('channels').array().notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.language] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    eventKey: text('event_key').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    channels: text('channels').array().notNull(),
    data: jsonb('data'),
    dedupeKey: text('dedupe_key').notNull().unique(),
    status: text('status').notNull().default('PENDING'), // PENDING | SENT | FAILED
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
    readAt: ts('read_at'),
  },
  (t) => [index('notifications_user').on(t.userId, t.createdAt)],
);

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('OPEN'),
  createdAt: createdAt(),
});

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecretEncrypted: text('totp_secret_encrypted').notNull(),
  roles: text('roles').array().notNull(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    actorType: text('actor_type').notNull(), // admin | member | system
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    details: jsonb('details'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created').on(t.createdAt)],
);

export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
