import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import type { ChainContext } from "./chain/client.js";
import { ChainReads, type SkinItemDto } from "./chain/reads.js";
import { TtlCache } from "./cache.js";
import { AuthService } from "./auth.js";
import { MintingService } from "./services/minting.js";
import { AttestationWorker } from "./services/attestation.js";

/** Everything routes need, wired once at boot. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  chain: ChainContext;
  reads: ChainReads;
  auth: AuthService;
  /** wallet(lowercase) → closet items; TTL = config.assetsCacheTtlSeconds. */
  assetsCache: TtlCache<SkinItemDto[]>;
  minting: MintingService;
  attestation: AttestationWorker;
}

export function createAppContext(config: AppConfig, db: Db, chain: ChainContext): AppContext {
  const reads = new ChainReads(chain, config);
  const assetsCache = new TtlCache<SkinItemDto[]>(config.assetsCacheTtlSeconds * 1000);
  const minting = new MintingService(config, db, chain, assetsCache);
  const attestation = new AttestationWorker(config, db, chain);
  return {
    config,
    db,
    chain,
    reads,
    auth: new AuthService(config),
    assetsCache,
    minting,
    attestation,
  };
}
