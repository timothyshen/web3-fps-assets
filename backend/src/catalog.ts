import { keccak256, stringToBytes } from "viem";

/**
 * Off-chain skin display data.
 *
 * The chain stores no names — for the demo they live only in
 * contracts/script/SeedSkins.s.sol, so this module mirrors that script
 * (same approach as web/src/config/skinCatalog.ts). KEEP IN SYNC with the
 * seed script; production replaces this with the real content pipeline /
 * tokenURI metadata service.
 *
 * Rarity/supply/contentHash are intentionally NOT mirrored here — those are
 * read from GameAssetRegistry, the source of truth.
 */
export interface CatalogEntry {
  name: string;
  weapon: string;
}

export const SKIN_CATALOG: Record<number, CatalogEntry> = {
  1001: { name: "Standard AK-47", weapon: "AK-47" },
  1010: { name: "Desert Tan M4", weapon: "M4" },
  1025: { name: "Urban Camo AWP", weapon: "AWP" },
  1042: { name: "Frostbite AK-47", weapon: "AK-47" },
  1077: { name: "Solar Flare AWP", weapon: "AWP" },
};

/** Ordered list used by the demo reward-assignment policy. */
export const SEEDED_SKIN_DEF_IDS = [1001, 1010, 1025, 1042, 1077] as const;

export function skinName(skinDefId: number): string {
  return SKIN_CATALOG[skinDefId]?.name ?? `Skin #${skinDefId}`;
}

/**
 * previewKey is a resource key, deliberately not a full URL
 * (api/openapi.yaml: avoids client poisoning).
 */
export function previewKey(skinDefId: number): string {
  return `skins/${skinDefId}`;
}

/**
 * DEMO reward-assignment policy: which skin a match reward mints.
 *
 * The game server's rewardSlots payload carries only (slot, playerId,
 * rewardId) — picking the skin is game design, which does not exist in a
 * hackathon, so we derive it deterministically from the rewardId. It MUST
 * be deterministic: retries re-derive the same (skinDefId, wear) for the
 * same reward, keeping mintDirect's requestId idempotency meaningful.
 * Production replaces this with the loot table / season reward config.
 */
export function assignRewardSkin(rewardId: string): { skinDefId: number; wear: number } {
  const digest = keccak256(stringToBytes(`reward-skin:${rewardId}`));
  const pick = Number(BigInt(digest) % BigInt(SEEDED_SKIN_DEF_IDS.length));
  const wearDigest = keccak256(stringToBytes(`reward-wear:${rewardId}`));
  const wear = Number(BigInt(wearDigest) % 10_001n); // uint16 万分比, 0..10000
  return { skinDefId: SEEDED_SKIN_DEF_IDS[pick] ?? 1001, wear };
}
