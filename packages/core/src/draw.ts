/**
 * Provably fair draw (spec §5.7). Runs identically on the server and on the phone
 * ("Verify draw" screen), so it uses a pure-JS hash library (@noble/hashes) instead of node:crypto.
 *
 * Algorithm (version 1) — published so anyone can re-run it:
 * 1. At AUCTION start the server picks a 256-bit `seed` from a CSPRNG and publishes
 *    `commitment = hex(SHA-256(seed bytes))`.
 * 2. At DRAWING, unassigned members are sorted by member id (plain code-unit order) and
 *    unassigned spots ascending.
 * 3. Random integers come from `HMAC-SHA256(key = seed, msg = utf8(circleId) || uint32be(counter))`,
 *    counter starting at 0 and incremented on every HMAC call. The first 4 bytes are read as a
 *    big-endian uint32 `x`. For a range `r`, values `x ≥ floor(2^32 / r) × r` are rejected
 *    (counter++ and retry) to avoid modulo bias; otherwise the result is `x mod r`.
 * 4. Fisher–Yates: for i = len−1 down to 1, j = randInt(i + 1), swap(members[i], members[j]).
 * 5. members[k] receives spots[k].
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { invariant } from './errors.js';

export const DRAW_ALGORITHM_VERSION = 1;

const SEED_HEX = /^[0-9a-f]{64}$/;

/** Create a seed from 32 random bytes supplied by the caller (keeps this module I/O-free). */
export function seedFromBytes(bytes: Uint8Array): string {
  invariant(bytes.length === 32, 'INVALID_SEED', 'seed must be 32 bytes (256 bits)');
  return bytesToHex(bytes);
}

export function commitmentFor(seedHex: string): string {
  invariant(SEED_HEX.test(seedHex), 'INVALID_SEED', 'seed must be 64 lowercase hex characters');
  return bytesToHex(sha256(hexToBytes(seedHex)));
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function rng(seedHex: string, circleId: string): (range: number) => number {
  const key = hexToBytes(seedHex);
  const prefix = utf8ToBytes(circleId);
  let counter = 0;
  const next = (): number => {
    const msg = new Uint8Array(prefix.length + 4);
    msg.set(prefix, 0);
    new DataView(msg.buffer).setUint32(prefix.length, counter, false);
    counter += 1;
    const out = hmac(sha256, key, msg);
    return new DataView(out.buffer, out.byteOffset, 4).getUint32(0, false);
  };
  return (range) => {
    const limit = Math.floor(0x1_0000_0000 / range) * range;
    for (;;) {
      const x = next();
      if (x < limit) return x % range;
    }
  };
}

export interface DrawInput {
  seed: string;
  circleId: string;
  memberIds: readonly string[];
  spots: readonly number[];
}

export interface DrawAssignment {
  memberId: string;
  spot: number;
}

export function runDraw(input: DrawInput): DrawAssignment[] {
  invariant(
    input.memberIds.length === input.spots.length,
    'DRAW_MISMATCH',
    'number of members and spots must match',
  );
  invariant(
    new Set(input.memberIds).size === input.memberIds.length,
    'DRAW_MISMATCH',
    'duplicate member',
  );
  invariant(new Set(input.spots).size === input.spots.length, 'DRAW_MISMATCH', 'duplicate spot');
  commitmentFor(input.seed); // validates seed format
  const members = [...input.memberIds].sort(compareIds);
  const spots = [...input.spots].sort((a, b) => a - b);
  const randInt = rng(input.seed, input.circleId);
  for (let i = members.length - 1; i >= 1; i -= 1) {
    const j = randInt(i + 1);
    const tmp = members[i] as string;
    members[i] = members[j] as string;
    members[j] = tmp;
  }
  return members.map((memberId, k) => ({ memberId, spot: spots[k] as number }));
}

export type DrawVerification =
  { ok: true } | { ok: false; reason: 'COMMITMENT_MISMATCH' | 'RESULT_MISMATCH' | 'INVALID_SEED' };

/** What the "Verify draw" screen runs on-device. */
export function verifyDraw(
  input: DrawInput & { commitment: string; result: readonly DrawAssignment[] },
): DrawVerification {
  if (!SEED_HEX.test(input.seed)) return { ok: false, reason: 'INVALID_SEED' };
  if (commitmentFor(input.seed) !== input.commitment.toLowerCase()) {
    return { ok: false, reason: 'COMMITMENT_MISMATCH' };
  }
  const expected = runDraw(input);
  const key = (a: DrawAssignment) => `${a.memberId}→${a.spot}`;
  const got = new Set(input.result.map(key));
  const same = expected.length === input.result.length && expected.every((a) => got.has(key(a)));
  return same ? { ok: true } : { ok: false, reason: 'RESULT_MISMATCH' };
}
