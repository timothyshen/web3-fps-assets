import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

const execFileAsync = promisify(execFile);

/**
 * Boots the full stack for the integration suite:
 *   anvil → forge script Deploy → forge script SeedSkins → backend (tsx)
 * Anvil's default accounts are publicly known TEST keys.
 */

const ANVIL_PORT = Number(process.env.TEST_ANVIL_PORT ?? 18545);
const BACKEND_PORT = Number(process.env.TEST_BACKEND_PORT ?? 18787);
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const BASE_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const WEB_ORIGIN = "http://localhost:5173";
const INTERNAL_TOKEN = "test-internal-service-token";

// anvil default account #0 (deployer/admin/operator) and #1 (reward signer)
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const backendDir = resolve(import.meta.dirname, "..");
const contractsDir = resolve(backendDir, "..", "contracts");

function foundryBin(tool: string): string {
  const home = process.env.HOME ?? "";
  const candidate = join(home, ".foundry", "bin", tool);
  return existsSync(candidate) ? candidate : tool;
}

async function waitFor(probe: () => Promise<boolean>, label: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      if (await probe()) return;
    } catch {
      // keep polling
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function rpcReady(): Promise<boolean> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  return res.ok;
}

function parseAddress(log: string, label: string): string {
  const pattern = new RegExp(`${label}\\s*:\\s*(0x[0-9a-fA-F]{40})`);
  const match = pattern.exec(log);
  if (!match?.[1]) throw new Error(`could not find "${label}" address in forge output:\n${log}`);
  return match[1];
}

function killProcess(child: ChildProcess | undefined): Promise<void> {
  return new Promise((resolveKill) => {
    if (!child || child.exitCode !== null) return resolveKill();
    child.once("exit", () => resolveKill());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveKill();
    }, 3000).unref();
  });
}

export default async function globalSetup(project: TestProject): Promise<() => Promise<void>> {
  const tmpDir = mkdtempSync(join(tmpdir(), "asset-backend-test-"));
  let anvil: ChildProcess | undefined;
  let backend: ChildProcess | undefined;

  const teardown = async () => {
    await killProcess(backend);
    await killProcess(anvil);
    rmSync(tmpDir, { recursive: true, force: true });
  };

  try {
    // 1. anvil ----------------------------------------------------------
    anvil = spawn(foundryBin("anvil"), ["--port", String(ANVIL_PORT), "--silent"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    anvil.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[anvil] ${chunk.toString()}`));
    await waitFor(rpcReady, "anvil RPC");

    // 2. deploy ---------------------------------------------------------
    const forge = foundryBin("forge");
    const deployEnv = {
      ...process.env,
      PRIVATE_KEY: KEY0,
      REWARD_SIGNER_ADDRESS: ADDR1,
    };
    const { stdout: deployOut } = await execFileAsync(
      forge,
      ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC_URL, "--broadcast"],
      { cwd: contractsDir, env: deployEnv, maxBuffer: 32 * 1024 * 1024 },
    );
    const contracts = {
      gameAssetRegistry: parseAddress(deployOut, "GameAssetRegistry"),
      weaponSkin: parseAddress(deployOut, "WeaponSkin"),
      rewardDistributor: parseAddress(deployOut, "RewardDistributor"),
      skinMarket: parseAddress(deployOut, "SkinMarket"),
      matchAttestation: parseAddress(deployOut, "MatchAttestation"),
      tournamentEscrow: parseAddress(deployOut, "TournamentEscrow"),
    };

    // 3. seed skins -----------------------------------------------------
    await execFileAsync(
      forge,
      ["script", "script/SeedSkins.s.sol:SeedSkins", "--rpc-url", RPC_URL, "--broadcast"],
      {
        cwd: contractsDir,
        env: {
          ...deployEnv,
          REGISTRY_ADDRESS: contracts.gameAssetRegistry,
          DISTRIBUTOR_ADDRESS: contracts.rewardDistributor,
        },
        maxBuffer: 32 * 1024 * 1024,
      },
    );

    // 3b. point WeaponSkin.tokenURI at the backend's metadata endpoint
    // (setBaseURI, URI_ADMIN_ROLE is held by the deployer).
    await execFileAsync(
      foundryBin("cast"),
      [
        "send",
        contracts.weaponSkin,
        "setBaseURI(string)",
        `${BASE_URL}/metadata/`,
        "--private-key",
        KEY0,
        "--rpc-url",
        RPC_URL,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );

    // 4. backend --------------------------------------------------------
    backend = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SKIP_DOTENV: "1", // a stray backend/.env must not leak into tests
        PORT: String(BACKEND_PORT),
        HOST: "127.0.0.1",
        LOG_LEVEL: "warn",
        RPC_URL,
        CHAIN_ID: "31337",
        CHAIN_NAME: "Anvil (test)",
        NATIVE_SYMBOL: "ETH",
        IS_TESTNET: "true",
        EXPLORER_BASE_URL: "https://example-explorer.invalid",
        DEPLOYMENTS_FILE: "",
        ADDR_GAME_ASSET_REGISTRY: contracts.gameAssetRegistry,
        ADDR_WEAPON_SKIN: contracts.weaponSkin,
        ADDR_REWARD_DISTRIBUTOR: contracts.rewardDistributor,
        ADDR_SKIN_MARKET: contracts.skinMarket,
        ADDR_MATCH_ATTESTATION: contracts.matchAttestation,
        ADDR_TOURNAMENT_ESCROW: contracts.tournamentEscrow,
        OPERATOR_PRIVATE_KEY: KEY0,
        JWT_SECRET: "integration-test-jwt-secret",
        INTERNAL_SERVICE_TOKEN: INTERNAL_TOKEN,
        WEB_ORIGIN,
        ATTEST_INTERVAL_MS: "300",
        ASSETS_CACHE_TTL_SECONDS: "20",
        DEFAULT_SEASON_ID: "1",
        DB_PATH: join(tmpDir, "backend.sqlite3"),
      },
    });
    backend.stdout?.on("data", () => undefined);
    backend.stderr?.on("data", (chunk: Buffer) =>
      process.stderr.write(`[backend] ${chunk.toString()}`),
    );
    await waitFor(async () => (await fetch(`${BASE_URL}/v1/config`)).ok, "backend /v1/config");

    // 5. hand endpoints to the tests ------------------------------------
    project.provide("baseUrl", BASE_URL);
    project.provide("rpcUrl", RPC_URL);
    project.provide("webOrigin", WEB_ORIGIN);
    project.provide("internalToken", INTERNAL_TOKEN);
    project.provide("contracts", contracts);
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}
