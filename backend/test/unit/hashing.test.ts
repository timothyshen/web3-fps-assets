import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../../src/jcs.js";
import { matchIdKeyOf, resultHashOf, rewardRequestId } from "../../src/hashing.js";

const fixturesDir = resolve(import.meta.dirname, "..", "..", "..", "fixtures");
const canonicalRaw = readFileSync(resolve(fixturesDir, "match-result-v1.canonical.json"));
const expected = JSON.parse(
  readFileSync(resolve(fixturesDir, "match-result-v1.expected.json"), "utf8"),
) as { matchId: string; matchIdKey: string; resultHash: string; canonicalByteLength: number };

/**
 * Cross-language reference vectors (fixtures/README.md): a new
 * implementation must reproduce the canonical BYTES exactly — comparing
 * only hashes would hide canonicalization bugs the sample doesn't trigger.
 */
describe("RFC 8785 canonicalization against fixtures", () => {
  it("fixture file has the documented byte length and no trailing newline", () => {
    expect(canonicalRaw.length).toBe(expected.canonicalByteLength);
    expect(canonicalRaw[canonicalRaw.length - 1]).not.toBe(0x0a);
  });

  it("re-canonicalizing the parsed fixture reproduces the exact bytes", () => {
    const reCanonical = canonicalize(JSON.parse(canonicalRaw.toString("utf8")));
    expect(Buffer.from(reCanonical, "utf8").equals(canonicalRaw)).toBe(true);
  });

  it("resultHash matches the expected vector", () => {
    expect(resultHashOf(canonicalRaw.toString("utf8"))).toBe(expected.resultHash);
  });

  it("matchIdKey = keccak256(UTF-8(matchId)) matches the expected vector", () => {
    expect(matchIdKeyOf(expected.matchId)).toBe(expected.matchIdKey);
  });
});

describe("canonicalize edge cases", () => {
  it("sorts object keys by UTF-16 code units and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: 2, Z: 3, "é": 4 })).toBe('{"Z":3,"a":2,"b":1,"é":4}');
  });

  it("serializes numbers in shortest round-trip form", () => {
    expect(canonicalize({ int: 10, neg: -1, zero: 0, frac: 0.5 })).toBe(
      '{"frac":0.5,"int":10,"neg":-1,"zero":0}',
    );
  });

  it("escapes strings minimally", () => {
    expect(canonicalize({ s: 'a"b\\c\nd' })).toBe('{"s":"a\\"b\\\\c\\nd"}');
  });

  it("preserves array order and null", () => {
    expect(canonicalize([null, true, [2, 1]])).toBe("[null,true,[2,1]]");
  });
});

describe("mintDirect requestId derivation (docs/integration.md)", () => {
  // Reference vectors computed independently with foundry:
  //   cast keccak $(cast abi-encode "f(string,string,uint8)" <matchId> <playerId> <slot>)
  it("matches the cast-computed vector for the fixture match", () => {
    expect(rewardRequestId("m_01HXQZ8K3N4P5R6S7T8V9W", "p_alice", 0)).toBe(
      "0x6b19c4ee6ad411dc87cb9d57194757de5b5cf690cca7c913a12cb5e808d7a345",
    );
  });

  it("matches the cast-computed vector for another triple", () => {
    expect(rewardRequestId("m_TEST", "p1", 3)).toBe(
      "0x1a6745077192254259c130819033df3339ba7327f0cb22911806eed6ea463329",
    );
  });
});
