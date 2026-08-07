import { formatEther } from 'viem'
import { nativeSymbol } from '../config/chain'

/** 0x1234…abcd */
export function shortAddress(address: string, chars = 4): string {
  if (address.length <= 2 + chars * 2) return address
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
}

/** 0xab12…cd34 for long hashes. */
export function shortHex(hex: string, chars = 6): string {
  if (hex.length <= 2 + chars * 2) return hex
  return `${hex.slice(0, 2 + chars)}…${hex.slice(-chars)}`
}

export function addressesEqual(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

/**
 * On-chain wear is uint16 in ten-thousandths (0..10000). Display as the
 * 0..1 float the rest of the product uses (api/openapi.yaml SkinItem.wear).
 */
export function formatWear(wear: number): string {
  return (wear / 10_000).toFixed(4)
}

const RARITY_LABELS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] as const

export function rarityLabel(rarity: number | null | undefined): string {
  if (rarity == null) return 'Unknown'
  return RARITY_LABELS[rarity] ?? `Tier ${rarity}`
}

/** CSS class suffix for rarity coloring; unknown rarity renders as common. */
export function rarityClass(rarity: number | null | undefined): string {
  return `rarity-${rarity != null && rarity >= 0 && rarity <= 4 ? rarity : 0}`
}

/** "1.25 MON" — native amount for display; keep the raw wei in a title attr. */
export function formatNative(wei: bigint, symbol: string = nativeSymbol): string {
  const s = formatEther(wei)
  const [whole, frac = ''] = s.split('.')
  const trimmed = frac.replace(/0+$/, '').slice(0, 6)
  return `${whole}${trimmed ? `.${trimmed}` : ''} ${symbol}`
}

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/**
 * tokenId = (skinDefId << 32) | serial (WeaponSkin.encodeTokenId).
 * tokenIds are uint256 and MUST stay decimal strings in UI state; this
 * helper is the only place that touches them numerically (via BigInt).
 */
export function decodeTokenIdString(tokenId: string): { skinDefId: number; serial: number } {
  const value = BigInt(tokenId)
  return {
    skinDefId: Number(value >> 32n),
    serial: Number(value & 0xffffffffn),
  }
}
