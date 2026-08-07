import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToBytes,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { canonicalize } from "../../src/jcs.js";
import { matchIdKeyOf, resultHashOf } from "../../src/hashing.js";
import {
  matchAttestationAbi,
  rewardDistributorAbi,
  weaponSkinAbi,
} from "../../src/chain/abi.js";
import { api, pollUntil, testEnv, testEscrowAbi } from "../helpers.js";

/**
 * End-to-end suite against live anvil + the running backend (booted by
 * test/globalSetup.ts): login → empty closet → SIWE bind with a real
 * wallet → claim to confirmed → loadout → entitlement → idempotency →
 * match hashing → attestation → tournaments.
 */

const env = testEnv();
const { baseUrl, webOrigin, internalToken, contracts } = env;

// anvil default account #0 — operator (publicly known test key)
const OPERATOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const chain = defineChain({
  id: 31337,
  name: "anvil-test",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
const operator = privateKeyToAccount(OPERATOR_KEY);
const operatorWallet = createWalletClient({ chain, transport: http(env.rpcUrl), account: operator });

const PLAYER_ID = "p_it_alice";
const PLAYER2_ID = "p_it_bob";
const MATCH_ID = "m_e2e_0001";
const REWARD_ID = "rw_e2e_0001_0";

const playerAccount = privateKeyToAccount(generatePrivateKey());

let playerToken = "";
let player2Token = "";
let confirmedTokenId = "";

function siweMessageFor(input: {
  address: `0x${string}`;
  nonce: string;
  sessionId: string;
  expiresAt: string;
}): string {
  // Mirrors web/src/lib/siwe.ts buildBindMessage exactly.
  return createSiweMessage({
    domain: new URL(webOrigin).host,
    uri: webOrigin,
    address: input.address,
    chainId: 31337,
    version: "1",
    nonce: input.nonce,
    statement:
      `Link this wallet to your game account (bind session ${input.sessionId}). ` +
      "Signing is free and authorizes no transaction or spending.",
    issuedAt: new Date(),
    expirationTime: new Date(input.expiresAt),
    requestId: input.sessionId,
  });
}

function baseMatchResult() {
  return {
    version: "1.0",
    matchId: MATCH_ID,
    modeId: "tdm_5v5",
    mapId: "dust_refinery",
    startedAt: 1754380800,
    endedAt: 1754381700,
    serverBuild: "gs-e2e-build",
    tournamentId: null,
    players: [
      {
        playerId: PLAYER_ID,
        teamId: "team_a",
        kills: 21,
        deaths: 4,
        score: 3100,
        placement: 1,
        result: "win",
      },
      {
        playerId: PLAYER2_ID,
        teamId: "team_b",
        kills: 4,
        deaths: 21,
        score: 900,
        placement: 2,
        result: "loss",
      },
    ],
    antiCheatState: "passed",
    rewardSlots: [{ slot: 0, playerId: PLAYER_ID, rewardId: REWARD_ID }],
  };
}

beforeAll(async () => {
  const login = await api(baseUrl, "POST", "/v1/auth/login", { body: { playerId: PLAYER_ID } });
  expect(login.status).toBe(200);
  playerToken = login.body.accessToken;
  const login2 = await api(baseUrl, "POST", "/v1/auth/login", { body: { playerId: PLAYER2_ID } });
  player2Token = login2.body.accessToken;
});

describe("config and auth", () => {
  it("serves public /v1/config with the deployed contract addresses", async () => {
    const res = await api(baseUrl, "GET", "/v1/config");
    expect(res.status).toBe(200);
    expect(res.body.chainId).toBe(31337);
    expect(res.body.contracts.weaponSkin.toLowerCase()).toBe(contracts.weaponSkin.toLowerCase());
    expect(res.body.contracts.rewardDistributor.toLowerCase()).toBe(
      contracts.rewardDistributor.toLowerCase(),
    );
    expect(res.body.nativeCurrency).toEqual({ symbol: "ETH", decimals: 18 });
  });

  it("rejects /v1/assets without a token with the {code,message} envelope", async () => {
    const res = await api(baseUrl, "GET", "/v1/assets");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "unauthorized" });
    expect(typeof res.body.message).toBe("string");
  });

  it("rejects internal endpoints for player JWTs (separate service token)", async () => {
    const res = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: playerToken,
      body: baseMatchResult(),
    });
    expect(res.status).toBe(401);
  });
});

describe("closet before binding", () => {
  it("returns an empty closet with wallet '' (not an error)", async () => {
    const res = await api(baseUrl, "GET", "/v1/assets", { token: playerToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ playerId: PLAYER_ID, wallet: "", items: [] });
    expect(res.body.pendingRewards).toEqual([]);
    expect(typeof res.body.stalenessSeconds).toBe("number");
  });
});

describe("SIWE wallet bind", () => {
  let sessionId = "";
  let nonce = "";
  let expiresAt = "";

  it("begins a bind session with bindUrl = {WEB_ORIGIN}/bind/{sessionId}", async () => {
    const res = await api(baseUrl, "POST", "/v1/wallet/bind", { token: playerToken });
    expect(res.status).toBe(200);
    sessionId = res.body.sessionId;
    expect(sessionId.length).toBeGreaterThan(8);
    expect(res.body.bindUrl).toBe(`${webOrigin}/bind/${sessionId}`);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("polls pending from Unity's endpoint", async () => {
    const res = await api(baseUrl, "GET", `/v1/wallet/bind/${sessionId}`, { token: playerToken });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("pending");
  });

  it("serves the web challenge without game auth", async () => {
    const res = await api(baseUrl, "GET", `/v1/wallet/bind/${sessionId}/challenge`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(sessionId);
    expect(res.body.state).toBe("pending");
    expect(res.body.nonce).toMatch(/^[a-zA-Z0-9]{8,}$/);
    nonce = res.body.nonce;
    expiresAt = res.body.expiresAt;
  });

  it("404s the challenge of an unknown session", async () => {
    const res = await api(baseUrl, "GET", "/v1/wallet/bind/does-not-exist/challenge");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("session_not_found");
  });

  it("rejects a signature from a different key as invalid_signature", async () => {
    const message = siweMessageFor({ address: playerAccount.address, nonce, sessionId, expiresAt });
    const impostor = privateKeyToAccount(generatePrivateKey());
    const signature = await impostor.signMessage({ message });
    const res = await api(baseUrl, "POST", `/v1/wallet/bind/${sessionId}/complete`, {
      body: { message, signature },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_signature");
  });

  it("rejects a message with the wrong nonce as invalid_message", async () => {
    const message = siweMessageFor({
      address: playerAccount.address,
      nonce: "deadbeefdeadbeef",
      sessionId,
      expiresAt,
    });
    const signature = await playerAccount.signMessage({ message });
    const res = await api(baseUrl, "POST", `/v1/wallet/bind/${sessionId}/complete`, {
      body: { message, signature },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_message");
  });

  it("completes the bind with a real signed SIWE message", async () => {
    const message = siweMessageFor({ address: playerAccount.address, nonce, sessionId, expiresAt });
    const signature = await playerAccount.signMessage({ message });
    const res = await api(baseUrl, "POST", `/v1/wallet/bind/${sessionId}/complete`, {
      body: { message, signature },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "bound", wallet: playerAccount.address });
  });

  it("rejects a replay of the completed session (single-use nonce)", async () => {
    const message = siweMessageFor({ address: playerAccount.address, nonce, sessionId, expiresAt });
    const signature = await playerAccount.signMessage({ message });
    const res = await api(baseUrl, "POST", `/v1/wallet/bind/${sessionId}/complete`, {
      body: { message, signature },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already_bound");
  });

  it("lets Unity's poll observe pending → bound", async () => {
    const res = await api(baseUrl, "GET", `/v1/wallet/bind/${sessionId}`, { token: playerToken });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("bound");
    expect(res.body.wallet).toBe(playerAccount.address);
  });

  it("409s a second bind for the already-bound player", async () => {
    const res = await api(baseUrl, "POST", "/v1/wallet/bind", { token: playerToken });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already_bound");
  });

  it("409s wallet_already_bound when another player binds the same wallet", async () => {
    const begin = await api(baseUrl, "POST", "/v1/wallet/bind", { token: player2Token });
    expect(begin.status).toBe(200);
    const challenge = await api(
      baseUrl,
      "GET",
      `/v1/wallet/bind/${begin.body.sessionId}/challenge`,
    );
    const message = siweMessageFor({
      address: playerAccount.address,
      nonce: challenge.body.nonce,
      sessionId: begin.body.sessionId,
      expiresAt: challenge.body.expiresAt,
    });
    const signature = await playerAccount.signMessage({ message });
    const res = await api(baseUrl, "POST", `/v1/wallet/bind/${begin.body.sessionId}/complete`, {
      body: { message, signature },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("wallet_already_bound");
  });
});

describe("match submission and hashing", () => {
  it("accepts the match, deriving resultHash = keccak256(canonical UTF-8)", async () => {
    const body = baseMatchResult();
    const res = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: internalToken,
      body,
    });
    expect(res.status).toBe(200);
    const expectedCanonical = canonicalize(body);
    expect(res.body.canonicalJson).toBe(expectedCanonical);
    expect(res.body.resultHash).toBe(resultHashOf(expectedCanonical));
    expect(res.body.matchId).toBe(MATCH_ID);
    expect(["pending", "attested"]).toContain(res.body.attestation.state);
  });

  it("returns the existing record for an identical duplicate push", async () => {
    const res = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: internalToken,
      body: baseMatchResult(),
    });
    expect(res.status).toBe(200);
    expect(res.body.matchId).toBe(MATCH_ID);
  });

  it("409s the same matchId with different content (wrong hash)", async () => {
    const tampered = baseMatchResult();
    tampered.players[0]!.score += 1;
    const res = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: internalToken,
      body: tampered,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("match_conflict");
  });

  it("reproduces the cross-language fixture hash through the API", async () => {
    const fixturesDir = resolve(import.meta.dirname, "..", "..", "..", "fixtures");
    const canonicalRaw = readFileSync(
      resolve(fixturesDir, "match-result-v1.canonical.json"),
      "utf8",
    );
    const expected = JSON.parse(
      readFileSync(resolve(fixturesDir, "match-result-v1.expected.json"), "utf8"),
    ) as { resultHash: string; matchId: string };

    const res = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: internalToken,
      body: JSON.parse(canonicalRaw),
    });
    expect(res.status).toBe(200);
    expect(res.body.canonicalJson).toBe(canonicalRaw);
    expect(res.body.resultHash).toBe(expected.resultHash);
    expect(res.body.matchId).toBe(expected.matchId);
  });

  it("rejects unsorted players (business rule, not JCS)", async () => {
    const unsorted = baseMatchResult();
    unsorted.matchId = "m_e2e_unsorted";
    unsorted.players.reverse();
    unsorted.rewardSlots = [];
    const res = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: internalToken,
      body: unsorted,
    });
    expect(res.status).toBe(400);
  });
});

describe("reward claim to confirmed", () => {
  it("shows the reward as claimable in pendingRewards", async () => {
    const res = await api(baseUrl, "GET", "/v1/assets", { token: playerToken });
    expect(res.status).toBe(200);
    const reward = res.body.pendingRewards.find((r: any) => r.rewardId === REWARD_ID);
    expect(reward).toBeDefined();
    expect(reward.state).toBe("claimable");
    expect(reward.skinDefId).toBeGreaterThan(0);
    expect(typeof reward.name).toBe("string");
    expect(new Date(reward.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("claims via push (requiresPlayerAction=false) and reaches confirmed with a tokenId", async () => {
    const claim = await api(baseUrl, "POST", `/v1/rewards/${REWARD_ID}/claim`, {
      token: playerToken,
    });
    expect(claim.status).toBe(200);
    expect(claim.body.requiresPlayerAction).toBe(false);
    expect(["processing", "pending_chain", "confirmed"]).toContain(claim.body.state);

    const final = await pollUntil(
      async () => (await api(baseUrl, "GET", `/v1/rewards/${REWARD_ID}`, { token: playerToken })).body,
      (status: any) => status.state === "confirmed" || status.state === "failed",
    );
    expect(final.state).toBe("confirmed");
    expect(final.tokenId).toMatch(/^[0-9]+$/);
    expect(final.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    confirmedTokenId = final.tokenId;

    const owner = await publicClient.readContract({
      address: contracts.weaponSkin as `0x${string}`,
      abi: weaponSkinAbi,
      functionName: "ownerOf",
      args: [BigInt(confirmedTokenId)],
    });
    expect(owner.toLowerCase()).toBe(playerAccount.address.toLowerCase());
  });

  it("shows the minted skin in the closet with mapped fields", async () => {
    const res = await api(baseUrl, "GET", "/v1/assets", { token: playerToken });
    expect(res.status).toBe(200);
    expect(res.body.wallet).toBe(playerAccount.address);
    const item = res.body.items.find((i: any) => i.tokenId === confirmedTokenId);
    expect(item).toBeDefined();
    expect(item.state).toBe("confirmed");
    expect(item.serial).toBeGreaterThanOrEqual(1);
    expect(item.maxSupply).toBeGreaterThan(0);
    expect(item.wear).toBeGreaterThanOrEqual(0);
    expect(item.wear).toBeLessThanOrEqual(1);
    expect(item.rarity).toBeGreaterThanOrEqual(0);
    expect(item.rarity).toBeLessThanOrEqual(4);
    expect(item.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(item.name.length).toBeGreaterThan(0);
    expect(item.previewKey).toBe(`skins/${item.skinDefId}`);
    // Reward no longer pending once confirmed.
    expect(res.body.pendingRewards.find((r: any) => r.rewardId === REWARD_ID)).toBeUndefined();
  });

  it("does NOT double-mint on claim retries (chain balance stays constant)", async () => {
    const balanceBefore = await publicClient.readContract({
      address: contracts.weaponSkin as `0x${string}`,
      abi: weaponSkinAbi,
      functionName: "balanceOf",
      args: [playerAccount.address],
    });

    for (let i = 0; i < 3; i++) {
      const retry = await api(baseUrl, "POST", `/v1/rewards/${REWARD_ID}/claim`, {
        token: playerToken,
      });
      expect(retry.status).toBe(200);
      expect(retry.body.state).toBe("confirmed");
    }
    await new Promise((r) => setTimeout(r, 750));

    const balanceAfter = await publicClient.readContract({
      address: contracts.weaponSkin as `0x${string}`,
      abi: weaponSkinAbi,
      functionName: "balanceOf",
      args: [playerAccount.address],
    });
    expect(balanceAfter).toBe(balanceBefore);

    const status = await api(baseUrl, "GET", `/v1/rewards/${REWARD_ID}`, { token: playerToken });
    expect(status.body.tokenId).toBe(confirmedTokenId);
  });

  it("holds rewards from anti-cheat-held matches (409 reward_held on claim)", async () => {
    const held = baseMatchResult();
    held.matchId = "m_e2e_held";
    held.antiCheatState = "held";
    held.rewardSlots = [{ slot: 0, playerId: PLAYER_ID, rewardId: "rw_e2e_held_0" }];
    const submit = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: internalToken,
      body: held,
    });
    expect(submit.status).toBe(200);

    const claim = await api(baseUrl, "POST", "/v1/rewards/rw_e2e_held_0/claim", {
      token: playerToken,
    });
    expect(claim.status).toBe(409);
    expect(claim.body.code).toBe("reward_held");
  });
});

describe("loadout", () => {
  let foreignTokenId = "";

  it("accepts a loadout of an owned confirmed token with 204", async () => {
    const res = await api(baseUrl, "PUT", "/v1/loadout", {
      token: playerToken,
      body: { tokenIdsBySlot: [confirmedTokenId, ""] },
    });
    expect(res.status).toBe(204);
  });

  it("403s a loadout containing a foreign token", async () => {
    // Mint a token to a DIFFERENT wallet directly via the distributor.
    const stranger = privateKeyToAccount(generatePrivateKey());
    const { request } = await publicClient.simulateContract({
      account: operator,
      address: contracts.rewardDistributor as `0x${string}`,
      abi: rewardDistributorAbi,
      functionName: "mintDirect",
      args: [stranger.address, 1001, 100, 1, keccak256(stringToBytes("e2e-foreign-mint"))],
    });
    const txHash = await operatorWallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const minted = parseEventLogs({
      abi: rewardDistributorAbi,
      logs: receipt.logs,
      eventName: "RewardMinted",
    })[0];
    expect(minted).toBeDefined();
    foreignTokenId = minted!.args.tokenId.toString(10);

    const res = await api(baseUrl, "PUT", "/v1/loadout", {
      token: playerToken,
      body: { tokenIdsBySlot: [foreignTokenId] },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_owned");
  });

  it("403s a loadout containing a nonexistent token", async () => {
    const res = await api(baseUrl, "PUT", "/v1/loadout", {
      token: playerToken,
      body: { tokenIdsBySlot: ["999999999999999"] },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("unknown_token");
  });

  it("entitlement-check grants owned tokens and rejects foreign ones per slot", async () => {
    const res = await api(baseUrl, "POST", "/internal/v1/entitlement-check", {
      token: internalToken,
      body: {
        playerId: PLAYER_ID,
        matchId: MATCH_ID,
        wallet: playerAccount.address,
        tokenIds: [confirmedTokenId, "", foreignTokenId],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.degraded).toBe(false);
    expect(res.body.snapshotId).toMatch(/^snap_/);
    expect(typeof res.body.cacheAgeSeconds).toBe("number");

    const granted = res.body.resolvedSkins[0];
    expect(granted).toMatchObject({ slot: 0, tokenId: confirmedTokenId, isDefault: false });
    expect(granted.skinDefId).toBeGreaterThan(0);
    expect(granted.contentHash).toMatch(/^0x[0-9a-f]{64}$/);

    expect(res.body.resolvedSkins[1]).toMatchObject({ slot: 1, isDefault: true, skinDefId: 0 });
    expect(res.body.resolvedSkins[2]).toMatchObject({ slot: 2, isDefault: true });
    expect(res.body.rejectedTokenIds).toEqual([
      { tokenId: foreignTokenId, reason: "not_owned" },
    ]);
  });
});

describe("attestation", () => {
  it("attests the match on-chain in the background; GET /v1/matches is public", async () => {
    const record = await pollUntil(
      async () => (await api(baseUrl, "GET", `/v1/matches/${MATCH_ID}`)).body,
      (r: any) => r.attestation.state !== "pending",
      { timeoutMs: 30_000 },
    );
    expect(record.attestation.state).toBe("attested");
    expect(record.attestation.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const verified = await publicClient.readContract({
      address: contracts.matchAttestation as `0x${string}`,
      abi: matchAttestationAbi,
      functionName: "verify",
      args: [matchIdKeyOf(MATCH_ID), record.resultHash as `0x${string}`],
    });
    expect(verified).toBe(true);
  });

  it("404s an unknown match", async () => {
    const res = await api(baseUrl, "GET", "/v1/matches/m_no_such");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("match_not_found");
  });
});

describe("tournaments", () => {
  it("lists tournaments read from TournamentEscrow", async () => {
    const before = await api(baseUrl, "GET", "/v1/tournaments", { token: playerToken });
    expect(before.status).toBe(200);
    expect(Array.isArray(before.body.items)).toBe(true);
    const countBefore = before.body.items.length;

    const nowSec = Math.floor(Date.now() / 1000);
    const { request } = await publicClient.simulateContract({
      account: operator,
      address: contracts.tournamentEscrow as `0x${string}`,
      abi: testEscrowAbi,
      functionName: "createTournament",
      args: [
        {
          resultSubmitter: operator.address,
          entryFee: parseEther("0.1"),
          minParticipants: 2,
          maxParticipants: 8,
          registrationDeadline: BigInt(nowSec + 3600),
          resultDeadline: BigInt(nowSec + 7200),
          organizerFeeBps: 500,
          payoutBps: [6000, 4000],
        },
      ],
    });
    const txHash = await operatorWallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // The backend caches tournament cores for 10s — poll until visible.
    const after = await pollUntil(
      async () => (await api(baseUrl, "GET", "/v1/tournaments", { token: playerToken })).body,
      (body: any) => body.items.length === countBefore + 1,
      { timeoutMs: 15_000, intervalMs: 500 },
    );
    const summary = after.items[after.items.length - 1];
    expect(summary.status).toBe("open");
    expect(summary.entryFee).toEqual({ wei: "100000000000000000", formatted: "0.1", symbol: "ETH" });
    expect(summary.maxParticipants).toBe(8);
    expect(summary.isRegistered).toBe(false);

    const detail = await api(baseUrl, "GET", `/v1/tournaments/${summary.tournamentId}`, {
      token: playerToken,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.organizer.toLowerCase()).toBe(operator.address.toLowerCase());
    expect(detail.body.resultSubmitter.toLowerCase()).toBe(operator.address.toLowerCase());
    expect(detail.body.organizerFeeBps).toBe(500);
    expect(detail.body.payoutBps).toEqual([6000, 4000]);

    const intent = await api(
      baseUrl,
      "POST",
      `/v1/tournaments/${summary.tournamentId}/intents/register`,
      { token: playerToken },
    );
    expect(intent.status).toBe(200);
    expect(intent.body.actionUrl).toBe(`${webOrigin}/tournaments/${summary.tournamentId}/register`);

    const badIntent = await api(
      baseUrl,
      "POST",
      `/v1/tournaments/${summary.tournamentId}/intents/claim-prize`,
      { token: playerToken },
    );
    expect(badIntent.status).toBe(409);
    expect(badIntent.body.code).toBe("wrong_status");
  });

  it("404s an unknown tournament", async () => {
    const res = await api(baseUrl, "GET", "/v1/tournaments/999999", { token: playerToken });
    expect(res.status).toBe(404);
  });
});
