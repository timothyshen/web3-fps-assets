import type { FastifyInstance } from "fastify";
import { TtlCache } from "../cache.js";
import { errors } from "../errors.js";
import { skinName } from "../catalog.js";
import { isRpcUnavailable, revertErrorName } from "../chain/client.js";
import type { AppContext } from "../context.js";

interface Erc721Metadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: { trait_type: string; value: string | number; display_type?: string }[];
}

/**
 * GET /metadata/{tokenId} — the ERC-721 metadata endpoint WeaponSkin's
 * tokenURI points at (tokenURI = baseTokenURI + decimal tokenId, see
 * contracts/src/WeaponSkin.sol; scripts/deploy-local.sh sets the base URI
 * to {this backend}/metadata/ via setBaseURI).
 *
 * Public by design: wallets, explorers and marketplaces fetch it without
 * auth. Name comes from the skin catalog, everything else from
 * registry.getSkin + skinData. `image` is a placeholder URL scheme
 * ({BUNDLE_BASE_URL}/previews/{skinDefId}.png) until a real art pipeline
 * exists; production also re-points the on-chain base URI at a public
 * host (see README production TODOs).
 */
export function registerMetadataRoutes(app: FastifyInstance, ctx: AppContext): void {
  const cache = new TtlCache<Erc721Metadata>(60_000);

  app.get<{ Params: { tokenId: string } }>("/metadata/:tokenId", async (request, reply) => {
    // Public metadata is fetched cross-origin by wallets/explorers — allow
    // any origin here (the rest of the API stays restricted to WEB_ORIGIN).
    void reply.header("access-control-allow-origin", "*");

    const raw = request.params.tokenId;
    if (!/^[0-9]{1,78}$/.test(raw)) {
      throw errors.notFound("token_not_found", "Unknown token.");
    }

    const cached = cache.getFresh(raw);
    if (cached) return cached.value;

    try {
      const data = await ctx.reads.skinDataOf(BigInt(raw));
      const def = await ctx.reads.getSkinDef(data.skinDefId);
      const name = skinName(data.skinDefId);

      const metadata: Erc721Metadata = {
        name: `${name} #${data.serial}`,
        description:
          `${name} — serial ${data.serial} of ${def.maxSupply}, season ${data.seasonId}. ` +
          "A weapon skin from the web3-fps-assets demo. The contentHash attribute is the " +
          "on-chain keccak256 commitment of the skin's AssetBundle.",
        image: `${ctx.config.bundleBaseUrl}/previews/${data.skinDefId}.png`,
        external_url: `${ctx.config.webOrigin}/closet`,
        attributes: [
          { trait_type: "Skin", value: name },
          { trait_type: "Skin Definition", value: data.skinDefId, display_type: "number" },
          { trait_type: "Rarity", value: def.rarity, display_type: "number" },
          { trait_type: "Wear", value: data.wear / 10_000 },
          { trait_type: "Serial", value: data.serial, display_type: "number" },
          { trait_type: "Max Supply", value: def.maxSupply, display_type: "number" },
          { trait_type: "Season", value: data.seasonId, display_type: "number" },
          { trait_type: "Content Hash", value: def.contentHash },
        ],
      };
      cache.set(raw, metadata);
      return metadata;
    } catch (error) {
      const revertName = revertErrorName(error);
      if (revertName === "TokenDoesNotExist" || revertName === "ERC721NonexistentToken") {
        throw errors.notFound("token_not_found", "Token does not exist (or was burned).");
      }
      if (isRpcUnavailable(error)) {
        const stale = cache.getStale(raw);
        if (stale) return stale.value;
        throw errors.degraded("Chain RPC unavailable; metadata not readable.");
      }
      throw error;
    }
  });
}
