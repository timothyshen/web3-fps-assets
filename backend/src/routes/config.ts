import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

/**
 * GET /v1/config — public (openapi: security: []). Clients must never
 * hardcode chainId or contract addresses.
 */
export function registerConfigRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/v1/config", async () => {
    const { config } = ctx;
    return {
      chainId: config.chainId,
      chainName: config.chainName,
      nativeCurrency: { symbol: config.nativeSymbol, decimals: config.nativeDecimals },
      // Compat extra for the Unity SDK's flat ChainConfig model (its
      // `nativeSymbol` field cannot read the nested object above; see the
      // contract-mismatch note in backend/README.md).
      nativeSymbol: config.nativeSymbol,
      isTestnet: config.isTestnet,
      explorerBaseUrl: config.explorerBaseUrl,
      marketplaceUrl: config.marketplaceUrl,
      contracts: {
        gameAssetRegistry: config.contracts.gameAssetRegistry,
        weaponSkin: config.contracts.weaponSkin,
        rewardDistributor: config.contracts.rewardDistributor,
        skinMarket: config.contracts.skinMarket,
        matchAttestation: config.contracts.matchAttestation,
        tournamentEscrow: config.contracts.tournamentEscrow,
      },
    };
  });
}
