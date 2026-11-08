import { Injectable } from '@nestjs/common';
import {
  ACCOUNTS,
  accountSide,
  isDebitNormal,
  validateTransaction,
  type Fils,
  type Transaction,
} from '@sanad/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { conflict } from '../common/errors.js';
import type { Tx } from '../db/db.service.js';
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from '../db/schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | undefined) => (v !== undefined && UUID.test(v) ? v : null);

/**
 * Persists @sanad/core ledger transactions (spec §6). Append-only (DB triggers forbid UPDATE/
 * DELETE), balanced (deferred DB trigger + core validation) and idempotent by key.
 */
@Injectable()
export class LedgerRepository {
  async post(tx: Tx, txns: readonly Transaction[]): Promise<void> {
    if (txns.length === 0) return;
    for (const t of txns) validateTransaction(t);
    const accounts = [...new Set(txns.flatMap((t) => t.entries.map((e) => e.account)))];
    await tx
      .insert(ledgerAccounts)
      .values(
        accounts.map((id) => ({
          id,
          side: accountSide(id),
          normal: isDebitNormal(id) ? 'debit' : 'credit',
        })),
      )
      .onConflictDoNothing();

    const existing = await tx
      .select({ key: ledgerTransactions.key })
      .from(ledgerTransactions)
      .where(
        inArray(
          ledgerTransactions.key,
          txns.map((t) => t.key),
        ),
      );
    const seen = new Set(existing.map((r) => r.key));
    for (const t of txns) {
      if (seen.has(t.key)) {
        await this.assertSame(tx, t);
        continue;
      }
      await tx.insert(ledgerTransactions).values({
        key: t.key,
        type: t.type,
        circleId: uuidOrNull(t.circleId),
        memberId: uuidOrNull(t.memberId),
        month: t.month ?? null,
        memo: t.memo ?? null,
        reverses: t.reverses ?? null,
      });
      await tx.insert(ledgerEntries).values(
        t.entries.map((e) => ({
          transactionKey: t.key,
          account: e.account,
          amountFils: e.amount,
          circleId: uuidOrNull(e.circleId),
          memberId: uuidOrNull(e.memberId),
        })),
      );
    }
  }

  private async assertSame(tx: Tx, t: Transaction): Promise<void> {
    const rows = await tx
      .select({ account: ledgerEntries.account, amount: ledgerEntries.amountFils })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionKey, t.key));
    const a = rows.map((r) => `${r.account}:${r.amount}`).sort();
    const b = t.entries.map((e) => `${e.account}:${e.amount}`).sort();
    if (a.join('|') !== b.join('|'))
      throw conflict('IDEMPOTENCY_CONFLICT', `ledger key ${t.key} reused`);
  }

  /** Balance in the account's normal direction. */
  async balance(tx: Tx, account: string, circleId?: string): Promise<Fils> {
    const where = circleId
      ? and(eq(ledgerEntries.account, account), eq(ledgerEntries.circleId, circleId))
      : eq(ledgerEntries.account, account);
    const [row] = await tx
      .select({ s: sql<string>`COALESCE(SUM(${ledgerEntries.amountFils}), 0)::text` })
      .from(ledgerEntries)
      .where(where);
    const raw = BigInt(row?.s ?? '0');
    return isDebitNormal(account) ? raw : -raw;
  }

  fundBalance(tx: Tx): Promise<Fils> {
    return this.balance(tx, ACCOUNTS.fund);
  }

  async allBalances(tx: Tx): Promise<{ account: string; balance: Fils }[]> {
    const rows = await tx
      .select({
        account: ledgerEntries.account,
        s: sql<string>`SUM(${ledgerEntries.amountFils})::text`,
      })
      .from(ledgerEntries)
      .groupBy(ledgerEntries.account)
      .orderBy(ledgerEntries.account);
    return rows.map((r) => ({
      account: r.account,
      balance: isDebitNormal(r.account) ? BigInt(r.s) : -BigInt(r.s),
    }));
  }

  /** Global check: total of all entries is zero and the cash side balances. */
  async assertBalanced(tx: Tx): Promise<void> {
    const rows = await this.allBalances(tx);
    let total = 0n;
    let cash = 0n;
    for (const r of rows) {
      const raw = isDebitNormal(r.account) ? r.balance : -r.balance;
      total += raw;
      if (accountSide(r.account) === 'cash') cash += raw;
    }
    if (total !== 0n || cash !== 0n)
      throw new Error(`ledger out of balance: total=${total} cash=${cash}`);
  }
}
