import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * All runtime configuration comes from environment variables (see
 * .env.example). Contract addresses may alternatively come from a
 * deployments JSON file (same shape the web app uses:
 * { chainId, contracts: { weaponSkin: "0x…", … } }) via DEPLOYMENTS_FILE —
 * scripts/deploy-local.sh writes one.
 */

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x address");
const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte hex");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),

  // ---- chain ----
  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  CHAIN_NAME: z.string().default("Anvil (local)"),
  NATIVE_SYMBOL: z.string().default("ETH"),
  NATIVE_DECIMALS: z.coerce.number().int().default(18),
  IS_TESTNET: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  EXPLORER_BASE_URL: z.string().default("https://testnet.monadexplorer.com"),
  MULTICALL3_ADDRESS: addressSchema.optional(),

  // ---- contract addresses (env wins; DEPLOYMENTS_FILE is the fallback) ----
  DEPLOYMENTS_FILE: z.string().optional(),
  ADDR_GAME_ASSET_REGISTRY: addressSchema.optional(),
  ADDR_WEAPON_SKIN: addressSchema.optional(),
  ADDR_REWARD_DISTRIBUTOR: addressSchema.optional(),
  ADDR_SKIN_MARKET: addressSchema.optional(),
  ADDR_MATCH_ATTESTATION: addressSchema.optional(),
  ADDR_TOURNAMENT_ESCROW: addressSchema.optional(),

  // ---- keys / secrets ----
  /**
   * Sends mintDirect + attest transactions. Needs OPERATOR_ROLE on
   * RewardDistributor and ATTESTER_ROLE on MatchAttestation.
   * Hackathon: env var. Production: KMS, per docs/security.md T8.
   */
  OPERATOR_PRIVATE_KEY: hex32Schema,
  JWT_SECRET: z.string().min(8).default("dev-only-jwt-secret-change-me"),
  /** Bearer token for /internal/v1/* (game server → asset backend). */
  INTERNAL_SERVICE_TOKEN: z.string().min(8).default("dev-internal-service-token"),

  // ---- web app (bind pages + tournament action pages) ----
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  /** Extra comma-separated SIWE domains accepted besides WEB_ORIGIN's host. */
  WEB_EXTRA_BIND_DOMAINS: z.string().default(""),
  MARKETPLACE_URL: z.string().optional(),

  // ---- behavior knobs ----
  ASSETS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(20),
  BIND_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REWARD_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
  DEFAULT_SEASON_ID: z.coerce.number().int().nonnegative().default(1),
  ATTEST_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  ATTEST_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  BUNDLE_BASE_URL: z.string().default("https://cdn.example.com/bundles"),

  DB_PATH: z.string().default("data/backend.sqlite3"),
  LOG_LEVEL: z.string().default("info"),
});

export interface ContractAddresses {
  gameAssetRegistry: `0x${string}`;
  weaponSkin: `0x${string}`;
  rewardDistributor: `0x${string}`;
  skinMarket: `0x${string}`;
  matchAttestation: `0x${string}`;
  tournamentEscrow: `0x${string}`;
}

export type AppConfig = ReturnType<typeof loadConfig>;

/**
 * Minimal .env loader (no dependency): `npm run dev` works straight after
 * `cp .env.example .env`. Real environment variables always win; lines are
 * KEY=VALUE, `#` comments and surrounding quotes are handled. Set
 * SKIP_DOTENV=1 to disable (the test harness does, for determinism).
 */
export function loadDotEnv(path = ".env", env: NodeJS.ProcessEnv = process.env): void {
  if (env.SKIP_DOTENV === "1" || !existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

function readDeploymentsFile(path: string): Partial<Record<string, string>> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    contracts?: Record<string, string>;
  };
  return parsed.contracts ?? {};
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  const e = parsed.data;

  const fileContracts = e.DEPLOYMENTS_FILE ? readDeploymentsFile(e.DEPLOYMENTS_FILE) : {};
  const pick = (envValue: string | undefined, fileKey: string, label: string): `0x${string}` => {
    const value = envValue ?? fileContracts[fileKey];
    if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(
        `Missing contract address for ${label}. Set ADDR_* env vars or DEPLOYMENTS_FILE ` +
          `(run scripts/deploy-local.sh after starting anvil).`,
      );
    }
    return value as `0x${string}`;
  };

  const contracts: ContractAddresses = {
    gameAssetRegistry: pick(e.ADDR_GAME_ASSET_REGISTRY, "gameAssetRegistry", "GameAssetRegistry"),
    weaponSkin: pick(e.ADDR_WEAPON_SKIN, "weaponSkin", "WeaponSkin"),
    rewardDistributor: pick(e.ADDR_REWARD_DISTRIBUTOR, "rewardDistributor", "RewardDistributor"),
    skinMarket: pick(e.ADDR_SKIN_MARKET, "skinMarket", "SkinMarket"),
    matchAttestation: pick(e.ADDR_MATCH_ATTESTATION, "matchAttestation", "MatchAttestation"),
    tournamentEscrow: pick(e.ADDR_TOURNAMENT_ESCROW, "tournamentEscrow", "TournamentEscrow"),
  };

  const webOrigin = e.WEB_ORIGIN.replace(/\/$/, "");
  const allowedSiweDomains = new Set(
    [new URL(webOrigin).host, ...e.WEB_EXTRA_BIND_DOMAINS.split(",")]
      .map((d) => d.trim())
      .filter((d) => d.length > 0),
  );

  return {
    port: e.PORT,
    host: e.HOST,
    rpcUrl: e.RPC_URL,
    chainId: e.CHAIN_ID,
    chainName: e.CHAIN_NAME,
    nativeSymbol: e.NATIVE_SYMBOL,
    nativeDecimals: e.NATIVE_DECIMALS,
    isTestnet: e.IS_TESTNET,
    explorerBaseUrl: e.EXPLORER_BASE_URL.replace(/\/$/, ""),
    multicall3Address: e.MULTICALL3_ADDRESS as `0x${string}` | undefined,
    contracts,
    operatorPrivateKey: e.OPERATOR_PRIVATE_KEY as `0x${string}`,
    jwtSecret: e.JWT_SECRET,
    internalServiceToken: e.INTERNAL_SERVICE_TOKEN,
    webOrigin,
    allowedSiweDomains,
    marketplaceUrl: e.MARKETPLACE_URL ?? `${webOrigin}/market`,
    assetsCacheTtlSeconds: e.ASSETS_CACHE_TTL_SECONDS,
    bindSessionTtlSeconds: e.BIND_SESSION_TTL_SECONDS,
    rewardExpiryDays: e.REWARD_EXPIRY_DAYS,
    defaultSeasonId: e.DEFAULT_SEASON_ID,
    attestIntervalMs: e.ATTEST_INTERVAL_MS,
    attestMaxAttempts: e.ATTEST_MAX_ATTEMPTS,
    bundleBaseUrl: e.BUNDLE_BASE_URL.replace(/\/$/, ""),
    dbPath: e.DB_PATH,
    logLevel: e.LOG_LEVEL,
  };
}
