import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  Ledger,
  accountSide,
  isDebitNormal,
  isKnownAccount,
  validateTransaction,
  type Transaction,
} from './ledger.js';
import { kwd } from './money.js';

const fee: Transaction = {
  key: 'c1:FEE_PAID:m1',
  type: 'FEE_PAID',
  circleId: 'c1',
  entries: [
    { account: ACCOUNTS.gateway, amount: kwd(100), circleId: 'c1' },
    { account: ACCOUNTS.feesHeld('c1'), amount: -kwd(100), circleId: 'c1' },
  ],
};

describe('ledger', () => {
  it('posts balanced transactions and derives balances', () => {
    const l = new Ledger();
    expect(l.post(fee)).toBe('posted');
    expect(l.balance(ACCOUNTS.gateway)).toBe(kwd(100));
    expect(l.balance(ACCOUNTS.feesHeld('c1'))).toBe(kwd(100));
    expect(l.rawBalance(ACCOUNTS.feesHeld('c1'))).toBe(-kwd(100));
    expect(l.balanceForCircle(ACCOUNTS.gateway, 'c1')).toBe(kwd(100));
    expect(l.balanceForCircle(ACCOUNTS.gateway, 'c2')).toBe(0n);
    expect(l.accounts()).toEqual(['fees_held:c1', 'gateway_clearing']);
    expect(l.has(fee.key)).toBe(true);
    l.assertBalanced();
  });

  it('is idempotent by key', () => {
    const l = new Ledger();
    l.post(fee);
    expect(l.post(structuredClone(fee))).toBe('duplicate');
    expect(l.transactions()).toHaveLength(1);
    const different = {
      ...fee,
      entries: fee.entries.map((e) => ({ ...e, amount: e.amount * 2n })),
    };
    expect(() => l.post(different)).toThrow(/IDEMPOTENCY_CONFLICT/);
  });

  it('rejects malformed transactions', () => {
    const bad = (t: Partial<Transaction>) => () => validateTransaction({ ...fee, ...t });
    expect(bad({ key: '' })).toThrow(/LEDGER_NO_KEY/);
    expect(bad({ type: 'NOPE' as never })).toThrow(/LEDGER_TYPE/);
    expect(bad({ entries: fee.entries.slice(0, 1) })).toThrow(/LEDGER_ENTRIES/);
    expect(
      bad({
        entries: [
          { account: 'mystery', amount: 1n },
          { account: ACCOUNTS.gateway, amount: -1n },
        ],
      }),
    ).toThrow(/LEDGER_ACCOUNT/);
    expect(
      bad({
        entries: [
          { account: ACCOUNTS.gateway, amount: 0n },
          { account: ACCOUNTS.revenue, amount: 0n },
        ],
      }),
    ).toThrow(/LEDGER_ZERO/);
    expect(
      bad({
        entries: [
          { account: ACCOUNTS.gateway, amount: 2n },
          { account: ACCOUNTS.revenue, amount: -1n },
        ],
      }),
    ).toThrow(/LEDGER_UNBALANCED/);
    // balanced overall but money ↔ claims mixed
    expect(
      bad({
        entries: [
          { account: ACCOUNTS.gateway, amount: 1n },
          { account: ACCOUNTS.receivablesControl, amount: -1n },
        ],
      }),
    ).toThrow(/cash side/);
  });

  it('corrects with reversing transactions only', () => {
    const l = new Ledger();
    l.post(fee);
    const rev = l.reverse(fee.key, 'rev-1', 'typo');
    expect(rev.type).toBe('REVERSAL');
    expect(l.balance(ACCOUNTS.gateway)).toBe(0n);
    expect(() => l.reverse('missing', 'rev-2')).toThrow(/LEDGER_REVERSAL/);
    expect(() => l.post({ ...fee, key: 'rev-3', type: 'REVERSAL' })).toThrow(/must reference/);
    expect(() => l.post({ ...fee, key: 'rev-4', type: 'REVERSAL', reverses: 'missing' })).toThrow(
      /nothing to reverse/,
    );
    const noCircle = new Ledger();
    noCircle.post({ ...fee, key: 'k', circleId: undefined } as unknown as Transaction);
    expect(noCircle.reverse('k', 'k-rev').circleId).toBeUndefined();
    l.assertBalanced();
  });

  it('classifies accounts', () => {
    expect(accountSide(ACCOUNTS.receivable('m1'))).toBe('claims');
    expect(accountSide(ACCOUNTS.pot('c1'))).toBe('cash');
    expect(isDebitNormal(ACCOUNTS.receivable('m1'))).toBe(true);
    expect(isDebitNormal(ACCOUNTS.revenue)).toBe(false);
    expect(isKnownAccount('fees_held:c1')).toBe(true);
    expect(isKnownAccount('guarantee_fund')).toBe(false);
    expect(isKnownAccount('circle_pot:abc-1')).toBe(true);
    expect(isKnownAccount('circle_pot:bad id')).toBe(false);
  });

  it('postAll posts in order', () => {
    const l = new Ledger();
    l.postAll([fee]);
    expect(l.transactions()).toHaveLength(1);
  });
});
