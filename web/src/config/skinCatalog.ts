/**
 * Display names for skin definitions.
 *
 * The chain stores only rarity / supply / contentHash per skinDefId — names
 * live off-chain. In production they come from the tokenURI metadata API
 * (docs/asset-model.md); that backend does not exist yet, so this catalog
 * mirrors contracts/script/SeedSkins.s.sol for the demo. Unknown ids fall
 * back to "Skin #<id>".
 */

export interface SkinCatalogEntry {
  name: string
  weapon: string
}

export const SKIN_CATALOG: Record<number, SkinCatalogEntry> = {
  1001: { name: 'Standard AK-47', weapon: 'AK-47' },
  1010: { name: 'Desert Tan M4', weapon: 'M4' },
  1025: { name: 'Urban Camo AWP', weapon: 'AWP' },
  1042: { name: 'Frostbite AK-47', weapon: 'AK-47' },
  1077: { name: 'Solar Flare AWP', weapon: 'AWP' },
}

export function skinName(skinDefId: number): string {
  return SKIN_CATALOG[skinDefId]?.name ?? `Skin #${skinDefId}`
}
