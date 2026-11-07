import { describe, expect, it } from 'vitest';
import {
  DRAW_ALGORITHM_VERSION,
  commitmentFor,
  runDraw,
  seedFromBytes,
  verifyDraw,
} from './draw.js';
import { fixtureSeed } from './scenario.js';

const seed = fixtureSeed('draw-test');
const input = { seed, circleId: 'c1', memberIds: ['m3', 'm1', 'm2', 'm4'], spots: [4, 2, 3, 1] };

describe('provably fair draw', () => {
  it('commits with SHA-256 of the seed bytes (known vector)', () => {
    const zero = seedFromBytes(new Uint8Array(32));
    expect(zero).toBe('0'.repeat(64));
    // SHA-256 of 32 zero bytes
    expect(commitmentFor(zero)).toBe(
      '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
    );
    expect(DRAW_ALGORITHM_VERSION).toBe(1);
  });

  it('rejects malformed seeds', () => {
    expect(() => seedFromBytes(new Uint8Array(16))).toThrow(/INVALID_SEED/);
    expect(() => commitmentFor('XYZ')).toThrow(/INVALID_SEED/);
  });

  it('is deterministic and independent of input order', () => {
    const a = runDraw(input);
    const b = runDraw({ ...input, memberIds: ['m4', 'm2', 'm1', 'm3'], spots: [1, 2, 3, 4] });
    expect(a).toEqual(b);
    expect(a.map((x) => x.spot)).toEqual([1, 2, 3, 4]);
    expect(new Set(a.map((x) => x.memberId)).size).toBe(4);
  });

  it('changes with the seed and the circle id', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      results.add(JSON.stringify(runDraw({ ...input, seed: fixtureSeed(`s${i}`) })));
    }
    expect(results.size).toBeGreaterThan(5);
    expect(JSON.stringify(runDraw({ ...input, circleId: 'c2' }))).not.toBe(
      JSON.stringify(runDraw(input)),
    );
  });

  it('is roughly uniform (each member lands in spot 1 about 1/4 of the time)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 2_000; i += 1) {
      const first = runDraw({ ...input, seed: fixtureSeed(`u${i}`) })[0]?.memberId as string;
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    for (const c of counts.values()) expect(c).toBeGreaterThan(400);
  });

  it('handles single-member and empty draws', () => {
    expect(runDraw({ ...input, memberIds: ['x'], spots: [7] })).toEqual([
      { memberId: 'x', spot: 7 },
    ]);
    expect(runDraw({ ...input, memberIds: [], spots: [] })).toEqual([]);
  });

  it('validates inputs', () => {
    expect(() => runDraw({ ...input, spots: [1, 2] })).toThrow(/DRAW_MISMATCH/);
    expect(() => runDraw({ ...input, memberIds: ['a', 'a', 'b', 'c'] })).toThrow(
      /duplicate member/,
    );
    expect(() => runDraw({ ...input, spots: [1, 1, 2, 3] })).toThrow(/duplicate spot/);
  });

  it('verifies on-device', () => {
    const result = runDraw(input);
    const commitment = commitmentFor(seed);
    expect(verifyDraw({ ...input, commitment, result })).toEqual({ ok: true });
    expect(verifyDraw({ ...input, commitment: commitment.toUpperCase(), result })).toEqual({
      ok: true,
    });
    expect(verifyDraw({ ...input, commitment: '0'.repeat(64), result })).toEqual({
      ok: false,
      reason: 'COMMITMENT_MISMATCH',
    });
    const swapped = result.map((r, i) => ({
      ...r,
      spot: result[(i + 1) % result.length]?.spot as number,
    }));
    expect(verifyDraw({ ...input, commitment, result: swapped })).toEqual({
      ok: false,
      reason: 'RESULT_MISMATCH',
    });
    expect(verifyDraw({ ...input, commitment, result: result.slice(1) })).toEqual({
      ok: false,
      reason: 'RESULT_MISMATCH',
    });
    expect(verifyDraw({ ...input, seed: 'bad', commitment, result })).toEqual({
      ok: false,
      reason: 'INVALID_SEED',
    });
  });
});
