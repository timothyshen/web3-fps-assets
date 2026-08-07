/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Small local implementation instead of a dependency; it is validated
 * byte-for-byte against fixtures/match-result-v1.canonical.json in
 * test/unit/hashing.test.ts (the fixtures README requires new
 * implementations to reproduce the canonical bytes exactly, not just the
 * hash).
 *
 * Why this is correct:
 * - JCS primitive serialization is defined as ECMAScript `JSON.stringify`
 *   behavior (minimal string escaping, shortest round-trip numbers).
 * - JCS object member ordering is ascending by UTF-16 code units, which is
 *   exactly `Array.prototype.sort()`'s default comparator.
 * - Array order is preserved (business rules such as "players sorted by
 *   playerId" are the producer's responsibility, not JCS's).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("JCS cannot serialize non-finite numbers");
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(); // default comparator = ascending UTF-16 code units, per JCS
      const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new Error(`JCS cannot serialize a ${typeof value}`);
  }
}
