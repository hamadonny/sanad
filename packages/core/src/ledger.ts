/**
 * Double-entry ledger (spec §6, organiser model D-017).
 *
 * Sign convention: an entry's `amount` is positive for a DEBIT and negative for a CREDIT.
 * Every transaction's entries sum to zero. Balances are always derived from entries.
 *
 * Two self-balancing sides — each must sum to zero inside every transaction:
 *
 * CASH side (real money):
 *   gateway_clearing (debit-normal) — all money currently held via the payment provider/bank.
 *   Credit-normal "who the held money belongs to":
 *     circle_pot:{c} (members' contributions not yet paid out), fees_held:{c} (organising fees
 *     until the draw), holdbacks_payable, refunds_payable, platform_revenue, charity_payable.
 *   ⇒ money in − money out = gateway_clearing = pots + held fees + payables + revenue + charity.
 *   There is no guarantee fund: Sanad never pays members' contributions (D-017).
 *
 * CLAIMS side (memo — what defaulters owe the group, not Sanad's money):
 *   member_receivable:{m} (debit-normal) vs receivables_control (credit-normal).
 */
import { RuleError, invariant } from './errors.js';
import type { Fils } from './money.js';

export const ACCOUNTS = {
  gateway: 'gateway_clearing',
  holdbacks: 'holdbacks_payable',
  refunds: 'refunds_payable',
  revenue: 'platform_revenue',
  charity: 'charity_payable',
  receivablesControl: 'receivables_control',
  pot: (circleId: string) => `circle_pot:${circleId}`,
  feesHeld: (circleId: string) => `fees_held:${circleId}`,
  receivable: (memberId: string) => `member_receivable:${memberId}`,
} as const;

export type AccountSide = 'cash' | 'claims';

export function accountSide(account: string): AccountSide {
  if (account.startsWith('member_receivable:') || account === ACCOUNTS.receivablesControl) {
    return 'claims';
  }
  return 'cash';
}

const FIXED_ACCOUNTS: ReadonlySet<string> = new Set([
  ACCOUNTS.gateway,
  ACCOUNTS.holdbacks,
  ACCOUNTS.refunds,
  ACCOUNTS.revenue,
  ACCOUNTS.charity,
  ACCOUNTS.receivablesControl,
]);

const PREFIXED = /^(circle_pot|fees_held|member_receivable):[A-Za-z0-9_-]+$/;

export function isKnownAccount(account: string): boolean {
  return FIXED_ACCOUNTS.has(account) || PREFIXED.test(account);
}

/** Debit-normal accounts show their raw balance; credit-normal ones show its negation. */
export function isDebitNormal(account: string): boolean {
  return account === ACCOUNTS.gateway || account.startsWith('member_receivable:');
}

export const TRANSACTION_TYPES = [
  /** Organising fee paid on joining (held until the draw). */
  'FEE_PAID',
  /** Held fee returned (left while forming, or the circle never filled). */
  'FEE_REFUNDED',
  /** Held fee becomes Sanad's revenue at the draw. */
  'FEE_EARNED',
  /** Replacement fee (paid straight to revenue). */
  'REPLACEMENT_FEE',
  'CONTRIBUTION_PAID',
  /** Months a replacement member pays to catch up with the circle. */
  'CATCH_UP',
  'PAYOUT',
  /** Money for a month that arrived after its payout, forwarded to that month's recipient. */
  'TOP_UP',
  'BID_REVENUE',
  'HOLDBACK_HELD',
  'HOLDBACK_RELEASED',
  /** A defaulter's holdback moved into the pot to cover the months they owe. */
  'HOLDBACK_APPLIED',
  /** Money owed back to a member (e.g. a pre-payout defaulter's own contributions). */
  'REFUND_DUE',
  'REFUND_PAID',
  'LATE_PENALTY',
  'CHARITY_TRANSFER',
  /** Memo: what a post-payout defaulter owes the group. */
  'CLAIM_OPENED',
  /** Money recovered from a defaulter: to the affected members, recovery fee to revenue. */
  'RECOVERY',
  'REVERSAL',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

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
  if (txn.type === 'REVERSAL') {
    invariant(txn.reverses, 'LEDGER_REVERSAL', `${txn.key}: reversal must reference a transaction`);
  }
}

const sameTxn = (a: Transaction, b: Transaction): boolean =>
  JSON.stringify(a, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ===
  JSON.stringify(b, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

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
