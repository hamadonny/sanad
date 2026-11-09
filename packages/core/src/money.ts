/**
 * Money primitives.
 *
 * Decision (spec §5.1): all money is an integer number of **fils** stored as a native `bigint`.
 * 1 KWD = 1,000 fils. `bigint` makes accidental floating-point money impossible:
 * mixing a `bigint` with a `number` throws a TypeError at runtime and fails type-checking.
 *
 * Percentages are expressed in **basis points** (1 bp = 0.01%, 10,000 bp = 100%) as `bigint`,
 * so that percentage maths also stays in integers.
 */

/** An amount of money in fils. Always an integer; may be negative only for ledger deltas. */
export type Fils = bigint;

/** A percentage in basis points. 10_000n = 100%. */
export type BasisPoints = bigint;

export const FILS_PER_KWD = 1_000n;
export const BPS_DENOMINATOR = 10_000n;

/** Construct an amount from whole KWD (e.g. `kwd(100)` → 100,000 fils). */
export function kwd(wholeKwd: number | bigint): Fils {
  if (typeof wholeKwd === 'number' && !Number.isSafeInteger(wholeKwd)) {
    throw new RangeError(`kwd() expects a whole number of KWD, got ${wholeKwd}`);
  }
  return BigInt(wholeKwd) * FILS_PER_KWD;
}

/** Construct an amount from an integer number of fils. */
export function fils(amount: number | bigint): Fils {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new RangeError(`fils() expects an integer, got ${amount}`);
  }
  return BigInt(amount);
}

const KWD_PATTERN = /^(-)?(\d+)(?:\.(\d{1,3}))?$/;

/**
 * Parse a decimal KWD string such as `"100"`, `"12.5"` or `"0.250"` into fils.
 * Rejects more than 3 decimals instead of rounding, because silent rounding of user input is a bug.
 */
export function parseKwd(input: string): Fils {
  const match = KWD_PATTERN.exec(input.trim());
  if (!match) {
    throw new RangeError(`Invalid KWD amount: "${input}"`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  const value = BigInt(whole) * FILS_PER_KWD + BigInt(fraction.padEnd(3, '0'));
  return sign ? -value : value;
}

/** Format fils as a KWD string with exactly 3 decimals, e.g. `100000n` → `"100.000"`. */
export function formatKwd(amount: Fils): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / FILS_PER_KWD;
  const fraction = (abs % FILS_PER_KWD).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/**
 * ROUNDING POINT: take a percentage (in basis points) of an amount, **rounding down** to the
 * nearest fils (spec §5.1). Whatever is rounded away is simply not deducted, so it stays with
 * the member it would have been taken from.
 *
 * @example bpsOf(kwd(100), 3_000n) // 30% of 100 KWD → 30,000 fils
 */
export function bpsOf(amount: Fils, bps: BasisPoints): Fils {
  if (amount < 0n) throw new RangeError('bpsOf() expects a non-negative amount');
  if (bps < 0n) throw new RangeError('bpsOf() expects non-negative basis points');
  // bigint division truncates toward zero, which is floor for non-negative operands.
  return (amount * bps) / BPS_DENOMINATOR;
}

/** Sum a list of amounts. */
export function sum(amounts: readonly Fils[]): Fils {
  return amounts.reduce((acc, a) => acc + a, 0n);
}

/** Throw if the amount is negative. Returns the amount for chaining. */
export function assertNonNegative(amount: Fils, label = 'amount'): Fils {
  if (amount < 0n) throw new RangeError(`${label} must be non-negative, got ${formatKwd(amount)}`);
  return amount;
}
