/**
 * Double-entry ledger (spec §6).
 *
 * Sign convention: an entry's `amount` is positive for a DEBIT and negative for a CREDIT.
 * Every transaction's entries sum to zero. Balances are always derived from entries.
 *
 * Two self-balancing sides — each must sum to zero inside every transaction:
 *
 * CASH side (real money):
 *   gateway_clearing (debit-normal) — all money currently held via the payment provider/bank.
 *   Credit-normal "who the held money belongs to":
 *     circle_pot:{c}, entry_fees_held:{c}, guarantee_fund, holdbacks_payable, refunds_payable,
 *     platform_revenue, charity_payable.
 *   ⇒ money in − money out = gateway_clearing = pots + held fees + fund + payables + revenue + charity.
 *
 * CLAIMS side (memo — amounts members owe, not money):
 *   member_receivable:{m} (debit-normal) — advanced by the fund on a member's behalf.
 *   losses (debit-normal) — claims written off.
 *   receivables_control (credit-normal) and recoveries (credit-normal) — their counterparts.
 *
 * Guard: the Guarantee Fund may only be debited by fund-outflow transaction types
 * (advances, refunds, revenue release, reversals) — so it can never pay operating costs.
 */
import { RuleError, invariant } from './errors.js';
import type { Fils } from './money.js';

export const ACCOUNTS = {
  gateway: 'gateway_clearing',
  fund: 'guarantee_fund',
  holdbacks: 'holdbacks_payable',
  refunds: 'refunds_payable',
  revenue: 'platform_revenue',
  charity: 'charity_payable',
  receivablesControl: 'receivables_control',
  losses: 'losses',
  recoveries: 'recoveries',
  pot: (circleId: string) => `circle_pot:${circleId}`,
  entryFeesHeld: (circleId: string) => `entry_fees_held:${circleId}`,
  receivable: (memberId: string) => `member_receivable:${memberId}`,
} as const;

export type AccountSide = 'cash' | 'claims';

export function accountSide(account: string): AccountSide {
  if (
    account.startsWith('member_receivable:') ||
    account === ACCOUNTS.receivablesControl ||
    account === ACCOUNTS.losses ||
    account === ACCOUNTS.recoveries
  ) {
    return 'claims';
  }
  return 'cash';
}

const FIXED_ACCOUNTS: ReadonlySet<string> = new Set([
  ACCOUNTS.gateway,
  ACCOUNTS.fund,
  ACCOUNTS.holdbacks,
  ACCOUNTS.refunds,
  ACCOUNTS.revenue,
  ACCOUNTS.charity,
  ACCOUNTS.receivablesControl,
  ACCOUNTS.losses,
  ACCOUNTS.recoveries,
]);

const PREFIXED = /^(circle_pot|entry_fees_held|member_receivable):[A-Za-z0-9_-]+$/;

export function isKnownAccount(account: string): boolean {
  return FIXED_ACCOUNTS.has(account) || PREFIXED.test(account);
}

/** Debit-normal accounts show their raw balance; credit-normal ones show its negation. */
export function isDebitNormal(account: string): boolean {
  return (
    account === ACCOUNTS.gateway ||
    account === ACCOUNTS.losses ||
    account.startsWith('member_receivable:')
  );
}

export const TRANSACTION_TYPES = [
  'ENTRY_FEE_PAID',
  'ENTRY_FEE_REFUNDED',
  /** Added: entry fees move from held to the fund once the circle is drawn. */
  'ENTRY_FEE_TRANSFERRED',
  'CONTRIBUTION_PAID',
  'FUND_ADVANCE',
  /** Added: a late payer repays an amount the fund advanced for them. */
  'FUND_ADVANCE_REPAID',
  /** Added: a vacant spot's pot goes back to the fund instead of being paid out. */
  'POT_RETURNED',
  'PAYOUT',
  'BID_REVENUE',
  'HOLDBACK_HELD',
  'HOLDBACK_RELEASED',
  'HOLDBACK_FORFEITED',
  'COMPLETION_REFUND',
  'DEFAULTER_REFUND',
  /** Added: money in refunds_payable is sent to the member. */
  'REFUND_PAID',
  'REVENUE_RELEASE',
  'LATE_PENALTY',
  'CHARITY_TRANSFER',
  'LOSS_WRITE_OFF',
  /** Added: a pre-payout defaulter's advances become a vacancy, not a claim. */
  'CLAIM_CANCELLED',
  'RECOVERY',
  /** Added: company capital paid into the Guarantee Fund (e.g. the launch reserve). */
  'FUND_CAPITAL',
  'REVERSAL',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

const FUND_OUTFLOW_TYPES: ReadonlySet<TransactionType> = new Set([
  'FUND_ADVANCE',
  'COMPLETION_REFUND',
  'DEFAULTER_REFUND',
  'REVENUE_RELEASE',
  'REVERSAL',
]);

export interface Entry {
  account: string;
  amount: Fils;
  circleId?: string;
  memberId?: string;
}

export interface Transaction {
  /** Idempotency key: posting the same key twice is a no-op if identical, an error otherwise. */
  key: string;
  type: TransactionType;
  circleId?: string;
  memberId?: string;
  month?: number;
  entries: Entry[];
  memo?: string;
  /** For REVERSAL: key of the reversed transaction. */
  reverses?: string;
}

function sumOf(entries: readonly Entry[]): Fils {
  return entries.reduce((acc, e) => acc + e.amount, 0n);
}

/** Throws a RuleError describing the first problem found. */
export function validateTransaction(txn: Transaction): void {
  invariant(txn.key.length > 0, 'LEDGER_NO_KEY', 'transaction needs an idempotency key');
  invariant(
    (TRANSACTION_TYPES as readonly string[]).includes(txn.type),
    'LEDGER_TYPE',
    `unknown type ${txn.type}`,
  );
  invariant(txn.entries.length >= 2, 'LEDGER_ENTRIES', `${txn.key}: needs at least two entries`);
  for (const e of txn.entries) {
    invariant(
      isKnownAccount(e.account),
      'LEDGER_ACCOUNT',
      `${txn.key}: unknown account ${e.account}`,
    );
    invariant(e.amount !== 0n, 'LEDGER_ZERO', `${txn.key}: zero-amount entry on ${e.account}`);
  }
  invariant(
    sumOf(txn.entries) === 0n,
    'LEDGER_UNBALANCED',
    `${txn.key}: entries do not sum to zero`,
  );
  for (const side of ['cash', 'claims'] as const) {
    const part = txn.entries.filter((e) => accountSide(e.account) === side);
    invariant(sumOf(part) === 0n, 'LEDGER_UNBALANCED', `${txn.key}: ${side} side does not balance`);
  }
  const debitsFund = txn.entries.some((e) => e.account === ACCOUNTS.fund && e.amount > 0n);
  if (debitsFund && !FUND_OUTFLOW_TYPES.has(txn.type)) {
    throw new RuleError(
      'FUND_MISUSE',
      `${txn.key}: ${txn.type} may not take money out of the fund`,
    );
  }
  if (txn.type === 'REVERSAL') {
    invariant(txn.reverses, 'LEDGER_REVERSAL', `${txn.key}: reversal must reference a transaction`);
  }
}

const sameTxn = (a: Transaction, b: Transaction): boolean =>
  JSON.stringify(a, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ===
  JSON.stringify(b, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

/** Company capital paid into the Guarantee Fund (e.g. to reach the minimum reserve at launch). */
export function fundCapitalTransaction(key: string, amount: Fils, memo?: string): Transaction {
  invariant(amount > 0n, 'INVALID_AMOUNT', 'capital must be positive');
  return {
    key,
    type: 'FUND_CAPITAL',
    entries: [
      { account: ACCOUNTS.gateway, amount },
      { account: ACCOUNTS.fund, amount: -amount },
    ],
    ...(memo !== undefined ? { memo } : {}),
  };
}

/** In-memory, append-only ledger. The API persists the same transactions to Postgres. */
export class Ledger {
  private readonly txns: Transaction[] = [];
  private readonly byKey = new Map<string, Transaction>();
  private readonly raw = new Map<string, Fils>();

  /** Returns 'posted', or 'duplicate' when this exact transaction was already posted. */
  post(txn: Transaction): 'posted' | 'duplicate' {
    const existing = this.byKey.get(txn.key);
    if (existing) {
      if (sameTxn(existing, txn)) return 'duplicate';
      throw new RuleError(
        'IDEMPOTENCY_CONFLICT',
        `key ${txn.key} reused for a different transaction`,
      );
    }
    validateTransaction(txn);
    if (txn.type === 'REVERSAL') {
      invariant(
        this.byKey.has(txn.reverses as string),
        'LEDGER_REVERSAL',
        `nothing to reverse for ${txn.key}`,
      );
    }
    this.txns.push(txn);
    this.byKey.set(txn.key, txn);
    for (const e of txn.entries)
      this.raw.set(e.account, (this.raw.get(e.account) ?? 0n) + e.amount);
    return 'posted';
  }

  postAll(txns: readonly Transaction[]): void {
    for (const t of txns) this.post(t);
  }

  /** Correction by reversing transaction (entries negated). */
  reverse(key: string, reversalKey: string, memo?: string): Transaction {
    const original = this.byKey.get(key);
    if (!original) throw new RuleError('LEDGER_REVERSAL', `no transaction ${key}`);
    const txn: Transaction = {
      key: reversalKey,
      type: 'REVERSAL',
      reverses: key,
      entries: original.entries.map((e) => ({ ...e, amount: -e.amount })),
      ...(original.circleId !== undefined ? { circleId: original.circleId } : {}),
      ...(memo !== undefined ? { memo } : {}),
    };
    this.post(txn);
    return txn;
  }

  /** Raw signed balance (debits − credits). */
  rawBalance(account: string): Fils {
    return this.raw.get(account) ?? 0n;
  }

  /** Balance in the account's normal direction (positive = "has money / is owed"). */
  balance(account: string): Fils {
    const r = this.rawBalance(account);
    return isDebitNormal(account) ? r : -r;
  }

  /** Normal-direction balance of an account restricted to entries tagged with a circle. */
  balanceForCircle(account: string, circleId: string): Fils {
    let r = 0n;
    for (const t of this.txns) {
      for (const e of t.entries)
        if (e.account === account && e.circleId === circleId) r += e.amount;
    }
    return isDebitNormal(account) ? r : -r;
  }

  transactions(): readonly Transaction[] {
    return this.txns;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  accounts(): string[] {
    return [...this.raw.keys()].sort();
  }

  /** Every transaction balanced and cash identity holds. Throws otherwise. */
  assertBalanced(): void {
    let total = 0n;
    for (const t of this.txns) {
      validateTransaction(t);
      total += sumOf(t.entries);
    }
    invariant(total === 0n, 'LEDGER_UNBALANCED', 'ledger does not sum to zero');
    let cash = 0n;
    for (const [account, r] of this.raw) if (accountSide(account) === 'cash') cash += r;
    invariant(cash === 0n, 'LEDGER_UNBALANCED', 'cash side does not balance');
  }
}
