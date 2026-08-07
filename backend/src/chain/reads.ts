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

/**
 * Closet cache entry: the API item plus the block the wallet acquired the
 * token in (latest Transfer(to=wallet)), so `state` can be re-derived
 * against the current head on cache hits without re-reading the closet.
 */
export interface ClosetEntry {
  item: SkinItemDto;
  acquisitionBlock?: bigint;
}

const TRANSFER_EVENT = weaponSkinAbi.find(
  (item) => item.type === "event" && item.name === "Transfer",
) as Extract<(typeof weaponSkinAbi)[number], { type: "event" }>;

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

  /** Un-memoized chain head (per-call cacheTime 0 — finality checks need it fresh). */
  async currentBlockNumber(): Promise<bigint> {
    return this.ctx.publicClient.getBlockNumber({ cacheTime: 0 });
  }

  /**
   * Full closet read, the docs/integration.md recipe:
   * tokensOfOwner → skinData per token → registry.getSkin per unique defId.
   * Uses multicall when the chain has Multicall3 configured, parallel
   * eth_call otherwise (plain anvil has no Multicall3).
   *
   * With CONFIRMATION_BLOCKS > 0 each entry also resolves its acquisition
   * block (latest Transfer(to=wallet), one getLogs for the whole wallet)
   * and derives state per docs/security.md T6. If the log query fails the
   * item keeps the optimistic `confirmed` (documented degradation), unless
   * `mintedBlockOf` (our own mint receipts in the DB) knows the block.
   */
  async readCloset(
    wallet: `0x${string}`,
    mintedBlockOf?: (tokenId: string) => number | null | undefined,
  ): Promise<ClosetEntry[]> {
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

    let acquisitionBlocks = new Map<string, bigint>();
    let currentBlock: bigint | undefined;
    if (this.config.confirmationBlocks > 0) {
      try {
        [acquisitionBlocks, currentBlock] = await Promise.all([
          this.acquisitionBlocksOf(wallet),
          this.currentBlockNumber(),
        ]);
      } catch {
        // Optimistic fallback (see doc comment); the DB fallback below may
        // still supply mint blocks for tokens we minted ourselves.
        acquisitionBlocks = new Map();
        currentBlock = undefined;
      }
    }

    return tokenIds.map((tokenId, i) => {
      const data = skinDatas[i];
      if (!data) throw new Error("skinData batch length mismatch");
      const def = defs.get(data.skinDefId);
      if (!def) throw new Error(`missing skin definition ${data.skinDefId}`);

      const decimalId = tokenId.toString(10);
      let acquisitionBlock = acquisitionBlocks.get(decimalId);
      if (acquisitionBlock === undefined) {
        const fallback = mintedBlockOf?.(decimalId);
        if (fallback !== null && fallback !== undefined) acquisitionBlock = BigInt(fallback);
      }
      const state = this.deriveFinalityState(acquisitionBlock, currentBlock);
      return { item: this.toSkinItem(tokenId, data, def, state), acquisitionBlock };
    });
  }

  /** Latest Transfer(to=wallet) block per tokenId (decimal-string keyed). */
  private async acquisitionBlocksOf(wallet: `0x${string}`): Promise<Map<string, bigint>> {
    const logs = await this.ctx.publicClient.getLogs({
      address: this.config.contracts.weaponSkin,
      event: TRANSFER_EVENT,
      args: { to: wallet },
      fromBlock: 0n,
    });
    const blocks = new Map<string, bigint>();
    for (const log of logs) {
      const args = log.args as { tokenId?: bigint };
      if (args.tokenId === undefined || log.blockNumber === null) continue;
      const key = args.tokenId.toString(10);
      const existing = blocks.get(key);
      if (existing === undefined || log.blockNumber > existing) {
        blocks.set(key, log.blockNumber);
      }
    }
    return blocks;
  }

  /**
   * Finality state of one token held by `wallet` (loadout / entitlement).
   * Optimistic on resolution failure — ownership has already been verified
   * by the time this runs, and blocking play on a log-RPC hiccup would
   * violate the degradation matrix.
   */
  async tokenFinalityState(
    wallet: `0x${string}`,
    tokenId: bigint,
    mintedBlockFallback?: number | null,
  ): Promise<"confirmed" | "pending"> {
    if (this.config.confirmationBlocks === 0) return "confirmed";
    try {
      const [logs, currentBlock] = await Promise.all([
        this.ctx.publicClient.getLogs({
          address: this.config.contracts.weaponSkin,
          event: TRANSFER_EVENT,
          args: { to: wallet, tokenId },
          fromBlock: 0n,
        }),
        this.currentBlockNumber(),
      ]);
      let acquisitionBlock: bigint | undefined;
      for (const log of logs) {
        if (
          log.blockNumber !== null &&
          (acquisitionBlock === undefined || log.blockNumber > acquisitionBlock)
        ) {
          acquisitionBlock = log.blockNumber;
        }
      }
      if (acquisitionBlock === undefined && mintedBlockFallback != null) {
        acquisitionBlock = BigInt(mintedBlockFallback);
      }
      return this.deriveFinalityState(acquisitionBlock, currentBlock);
    } catch {
      return "confirmed"; // optimistic degradation
    }
  }

  /**
   * confirmed iff (head - acquisitionBlock) >= CONFIRMATION_BLOCKS.
   * Unknown acquisition block → optimistic confirmed (documented fallback).
   */
  deriveFinalityState(
    acquisitionBlock: bigint | undefined,
    currentBlock: bigint | undefined,
  ): "confirmed" | "pending" {
    if (this.config.confirmationBlocks === 0) return "confirmed";
    if (acquisitionBlock === undefined || currentBlock === undefined) return "confirmed";
    return currentBlock - acquisitionBlock >= BigInt(this.config.confirmationBlocks)
      ? "confirmed"
      : "pending";
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

  toSkinItem(
    tokenId: bigint,
    data: SkinDataOnChain,
    def: SkinDef,
    state: "confirmed" | "pending",
  ): SkinItemDto {
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
      // Finality window per docs/security.md T6 (CONFIRMATION_BLOCKS env);
      // 0 keeps the optimistic behavior for instant-finality local chains.
      state,
    };
  }
}
