import { formatKwd, type Fils } from '@sanad/core';

/** API money format (D-001): fils as a decimal string plus a display string. */
export interface ApiMoney {
  fils: string;
  kwd: string;
}

export const money = (amount: Fils): ApiMoney => ({
  fils: amount.toString(),
  kwd: formatKwd(amount),
});

export function parseFils(value: string, field = 'amount'): Fils {
  if (!/^\d{1,15}$/.test(value)) throw new Error(`${field} must be an integer number of fils`);
  return BigInt(value);
}

/** JSON.stringify replacer for any stray bigint. */
export const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === 'bigint' ? v.toString() : v;
