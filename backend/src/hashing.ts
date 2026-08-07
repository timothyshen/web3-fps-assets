import { encodeAbiParameters, keccak256, stringToBytes } from "viem";
import { canonicalize } from "./jcs.js";

/**
 * resultHash = keccak256(UTF-8 bytes of the RFC 8785 canonical JSON).
 * Validated against fixtures/match-result-v1.expected.json in unit tests.
 */
export function canonicalJsonOf(matchResult: unknown): string {
  return canonicalize(matchResult);
}

export function resultHashOf(canonicalJson: string): `0x${string}` {
  return keccak256(stringToBytes(canonicalJson));
}

/** On-chain attestation key: keccak256(UTF-8(matchId)) (PRD MAT-004). */
export function matchIdKeyOf(matchId: string): `0x${string}` {
  return keccak256(stringToBytes(matchId));
}

/**
 * Push-mint idempotency key, exactly as docs/integration.md prescribes:
 *
 *   requestId = keccak256(encodeAbiParameters(
 *     [{type:'string'},{type:'string'},{type:'uint8'}],
 *     [matchId, playerId, slot]
 *   ))
 *
 * The (matchId, playerId, slot) triple is ALSO a UNIQUE index on the rewards
 * table, so retries never even reach the chain (saving gas on top of the
 * contract-side requestId guard).
 */
export function rewardRequestId(matchId: string, playerId: string, slot: number): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint8" }],
      [matchId, playerId, slot],
    ),
  );
}
