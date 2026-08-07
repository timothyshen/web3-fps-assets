import type { AppConfig } from "../config.js";
import { TtlCache } from "../cache.js";
import { previewKey, skinName } from "../catalog.js";
import { gameAssetRegistryAbi, weaponSkinAbi } from "./abi.js";
import { revertErrorName, type ChainContext } from "./client.js";

export interface SkinDef {
  maxSupply: number;
  minted: number;
  rarity: number;
  frozen: boolean;
  exists: boolean;
  contentHash: `0x${string}`;
}

export interface SkinDataOnChain {
  skinDefId: number;
  serial: number;
  wear: number;
  seasonId: number;
  mintedAt: bigint;
}

/** SkinItem exactly as api/openapi.yaml defines it. */
export interface SkinItemDto {
  tokenId: string;
  skinDefId: number;
  name: string;
  serial: number;
  maxSupply: number;
  wear: number;
  rarity: number;
  seasonId: number;
  previewKey: string;
  bundleUri: string;
  contentHash: string;
  state: "confirmed" | "pending";
}

export class ChainReads {
  /** Skin definitions barely change — cache for a minute. */
  private defCache = new TtlCache<SkinDef>(60_000);

  constructor(
    private readonly ctx: ChainContext,
    private readonly config: AppConfig,
  ) {}

  async getSkinDef(skinDefId: number): Promise<SkinDef> {
    const cached = this.defCache.getFresh(String(skinDefId));
    if (cached) return cached.value;
    const def = (await this.ctx.publicClient.readContract({
      address: this.config.contracts.gameAssetRegistry,
      abi: gameAssetRegistryAbi,
      functionName: "getSkin",
      args: [skinDefId],
    })) as SkinDef;
    this.defCache.set(String(skinDefId), def);
    return def;
  }

  async skinDataOf(tokenId: bigint): Promise<SkinDataOnChain> {
    return (await this.ctx.publicClient.readContract({
      address: this.config.contracts.weaponSkin,
      abi: weaponSkinAbi,
      functionName: "skinData",
      args: [tokenId],
    })) as SkinDataOnChain;
  }

  /** Owner address, or null when the token does not exist. */
  async ownerOf(tokenId: bigint): Promise<`0x${string}` | null> {
    try {
      return await this.ctx.publicClient.readContract({
        address: this.config.contracts.weaponSkin,
        abi: weaponSkinAbi,
        functionName: "ownerOf",
        args: [tokenId],
      });
    } catch (error) {
      const name = revertErrorName(error);
      if (name === "ERC721NonexistentToken" || name === "TokenDoesNotExist") return null;
      throw error;
    }
  }

  async balanceOf(wallet: `0x${string}`): Promise<bigint> {
    return this.ctx.publicClient.readContract({
      address: this.config.contracts.weaponSkin,
      abi: weaponSkinAbi,
      functionName: "balanceOf",
      args: [wallet],
    });
  }

  /**
   * Full closet read, the docs/integration.md recipe:
   * tokensOfOwner → skinData per token → registry.getSkin per unique defId.
   * Uses multicall when the chain has Multicall3 configured, parallel
   * eth_call otherwise (plain anvil has no Multicall3).
   */
  async readCloset(wallet: `0x${string}`): Promise<SkinItemDto[]> {
    const tokenIds = (await this.ctx.publicClient.readContract({
      address: this.config.contracts.weaponSkin,
      abi: weaponSkinAbi,
      functionName: "tokensOfOwner",
      args: [wallet],
    })) as readonly bigint[];

    if (tokenIds.length === 0) return [];

    const skinDatas = await this.batchSkinData(tokenIds);

    const uniqueDefIds = [...new Set(skinDatas.map((d) => d.skinDefId))];
    const defs = new Map<number, SkinDef>();
    await Promise.all(
      uniqueDefIds.map(async (defId) => {
        defs.set(defId, await this.getSkinDef(defId));
      }),
    );

    return tokenIds.map((tokenId, i) => {
      const data = skinDatas[i];
      if (!data) throw new Error("skinData batch length mismatch");
      const def = defs.get(data.skinDefId);
      if (!def) throw new Error(`missing skin definition ${data.skinDefId}`);
      return this.toSkinItem(tokenId, data, def);
    });
  }

  private async batchSkinData(tokenIds: readonly bigint[]): Promise<SkinDataOnChain[]> {
    const useMulticall = Boolean(this.ctx.chain.contracts?.multicall3);
    if (useMulticall) {
      const results = await this.ctx.publicClient.multicall({
        allowFailure: false,
        contracts: tokenIds.map((tokenId) => ({
          address: this.config.contracts.weaponSkin,
          abi: weaponSkinAbi,
          functionName: "skinData" as const,
          args: [tokenId] as const,
        })),
      });
      return results as unknown as SkinDataOnChain[];
    }
    return Promise.all(tokenIds.map((tokenId) => this.skinDataOf(tokenId)));
  }

  toSkinItem(tokenId: bigint, data: SkinDataOnChain, def: SkinDef): SkinItemDto {
    return {
      tokenId: tokenId.toString(10), // decimal string, never a JS number
      skinDefId: data.skinDefId,
      name: skinName(data.skinDefId),
      serial: data.serial,
      maxSupply: def.maxSupply,
      wear: data.wear / 10_000, // chain stores 万分比 uint16; API exposes 0..1 float
      rarity: def.rarity,
      seasonId: data.seasonId,
      previewKey: previewKey(data.skinDefId),
      bundleUri: `${this.config.bundleBaseUrl}/${data.skinDefId}.bundle`,
      contentHash: def.contentHash,
      // Monad's MonadBFT finality is fast; the demo reads settled state and
      // reports it as confirmed. A finality-窗口 policy would go here
      // (docs/security.md T6).
      state: "confirmed",
    };
  }
}
