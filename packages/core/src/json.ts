/**
 * Bigint-safe JSON for persisting engine state (e.g. Postgres JSONB snapshots).
 * Bigints are written as `{ "$fils": "123" }` and restored exactly; nothing else changes.
 */
const TAG = '$fils';

export function encodeJson(value: unknown): unknown {
  if (typeof value === 'bigint') return { [TAG]: value.toString() };
  if (Array.isArray(value)) return value.map(encodeJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeJson(v)]));
  }
  return value;
}

export function decodeJson<T>(value: unknown): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === TAG)
        return BigInt((v as Record<string, string>)[TAG] as string);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
