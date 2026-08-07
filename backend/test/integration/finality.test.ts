import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, defineChain, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, bindWalletFlow, pollUntil, spawnBackend, testEnv } from "../helpers.js";

/**
 * Finality-window suite (docs/security.md T6): runs a SECOND backend
 * instance against the shared anvil with CONFIRMATION_BLOCKS=3. A freshly
 * minted token must report state "pending", be rejected from loadout
 * (not_confirmed) and resolve to the default skin in entitlement checks;
 * after anvil mines enough blocks it flips to "confirmed" and equips.
 */

const env = testEnv();
const PLAYER_ID = "p_fin_alice";
const MATCH_ID = "m_fin_0001";
const REWARD_ID = "rw_fin_0001_0";

const chain = defineChain({
  id: 31337,
  name: "anvil-test",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
});
const testClient = createTestClient({ chain, transport: http(env.rpcUrl), mode: "anvil" });

const playerAccount = privateKeyToAccount(generatePrivateKey());

let backend: Awaited<ReturnType<typeof spawnBackend>>;
let baseUrl = "";
let token = "";
let tokenId = "";

beforeAll(async () => {
  backend = await spawnBackend({
    port: Number(process.env.TEST_FINALITY_PORT ?? 18788),
    env: {
      CONFIRMATION_BLOCKS: "3",
      // Quiet worker: no attestation txs mining surprise blocks mid-test.
      ATTEST_INTERVAL_MS: "3600000",
      ASSETS_CACHE_TTL_SECONDS: "20", // deliberately long — proves state re-derivation on cache hits
    },
  });
  baseUrl = backend.baseUrl;

  const login = await api(baseUrl, "POST", "/v1/auth/login", { body: { playerId: PLAYER_ID } });
  token = login.body.accessToken;
  await bindWalletFlow(baseUrl, env.webOrigin, token, playerAccount);
}, 60_000);

afterAll(async () => {
  await backend?.kill();
});

describe("finality window (CONFIRMATION_BLOCKS=3)", () => {
  it("mints a reward whose token starts as pending", async () => {
    const submit = await api(baseUrl, "POST", "/internal/v1/matches", {
      token: env.internalToken,
      body: {
        version: "1.0",
        matchId: MATCH_ID,
        modeId: "tdm",
        mapId: "map",
        startedAt: 1,
        endedAt: 2,
        serverBuild: "fin-test",
        tournamentId: null,
        players: [
          {
            playerId: PLAYER_ID,
            teamId: "a",
            kills: 1,
            deaths: 0,
            score: 100,
            placement: 1,
            result: "win",
          },
        ],
        antiCheatState: "passed",
        rewardSlots: [{ slot: 0, playerId: PLAYER_ID, rewardId: REWARD_ID }],
      },
    });
    expect(submit.status).toBe(200);

    const claim = await api(baseUrl, "POST", `/v1/rewards/${REWARD_ID}/claim`, { token });
    expect(claim.status).toBe(200);
    const final = await pollUntil(
      async () => (await api(baseUrl, "GET", `/v1/rewards/${REWARD_ID}`, { token })).body,
      (r: any) => r.state === "confirmed" || r.state === "failed",
    );
    expect(final.state).toBe("confirmed");
    tokenId = final.tokenId;

    // The mint block is the head (nothing mined since) → 0 confirmations < 3.
    const assets = await api(baseUrl, "GET", "/v1/assets", { token });
    expect(assets.status).toBe(200);
    const item = assets.body.items.find((i: any) => i.tokenId === tokenId);
    expect(item).toBeDefined();
    expect(item.state).toBe("pending");
  });

  it("rejects the pending token from loadout with not_confirmed", async () => {
    const res = await api(baseUrl, "PUT", "/v1/loadout", {
      token,
      body: { tokenIdsBySlot: [tokenId] },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_confirmed");
  });

  it("resolves the pending token to the default skin in entitlement checks", async () => {
    const res = await api(baseUrl, "POST", "/internal/v1/entitlement-check", {
      token: env.internalToken,
      body: { playerId: PLAYER_ID, matchId: MATCH_ID, tokenIds: [tokenId] },
    });
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.resolvedSkins[0]).toMatchObject({ slot: 0, isDefault: true, skinDefId: 0 });
    expect(res.body.rejectedTokenIds).toEqual([{ tokenId, reason: "not_confirmed" }]);
  });

  it("flips to confirmed once the window has passed (anvil_mine), even on a cache hit", async () => {
    await testClient.mine({ blocks: 3 });

    // The closet cache (TTL 20s) still holds the pending fetch — the state
    // must be re-derived against the fresh head, not served stale.
    const assets = await pollUntil(
      async () => (await api(baseUrl, "GET", "/v1/assets", { token })).body,
      (body: any) => body.items.find((i: any) => i.tokenId === tokenId)?.state === "confirmed",
      { timeoutMs: 10_000, intervalMs: 300 },
    );
    const item = assets.items.find((i: any) => i.tokenId === tokenId);
    expect(item.state).toBe("confirmed");

    const loadout = await api(baseUrl, "PUT", "/v1/loadout", {
      token,
      body: { tokenIdsBySlot: [tokenId] },
    });
    expect(loadout.status).toBe(204);

    const entitle = await api(baseUrl, "POST", "/internal/v1/entitlement-check", {
      token: env.internalToken,
      body: { playerId: PLAYER_ID, matchId: MATCH_ID, tokenIds: [tokenId] },
    });
    expect(entitle.status).toBe(200);
    expect(entitle.body.resolvedSkins[0]).toMatchObject({
      slot: 0,
      tokenId,
      isDefault: false,
    });
    expect(entitle.body.rejectedTokenIds).toEqual([]);
  });
});
