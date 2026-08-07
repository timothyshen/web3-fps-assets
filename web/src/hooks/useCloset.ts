import { useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { gameAssetRegistryAbi } from '../abi/gameAssetRegistry'
import { weaponSkinAbi } from '../abi/weaponSkin'
import { activeChain } from '../config/chain'
import { skinName } from '../config/skinCatalog'
import { batchRead } from '../lib/batchRead'
import { useContracts } from '../providers/ContractsProvider'

/**
 * Closet pipeline (mirrors docs/integration.md "库存读取"):
 *   WeaponSkin.tokensOfOwner(owner)          -> uint256[] tokenIds
 *   WeaponSkin.skinData(tokenId)   [batched] -> per-token attributes
 *   GameAssetRegistry.getSkin(defId)[batched]-> definition (rarity/maxSupply/…)
 *
 * tokenIds are uint256: they live as DECIMAL STRINGS in all UI state and are
 * converted to BigInt only at the call boundary.
 */

export interface ClosetItem {
  /** uint256 as decimal string — never Number. */
  tokenId: string
  skinDefId: number
  serial: number
  /** Ten-thousandths, 0..10000 (raw chain value). */
  wear: number
  seasonId: number
  /** Unix seconds. */
  mintedAt: number
  name: string
  /** null when GameAssetRegistry is not configured. */
  rarity: number | null
  maxSupply: number | null
  minted: number | null
  frozen: boolean | null
  contentHash: `0x${string}` | null
}

/** viem decodes uint8/16/32 as number, uint64+ as bigint. */
interface SkinDataStruct {
  skinDefId: number
  serial: number
  wear: number
  seasonId: number
  mintedAt: bigint
}

interface SkinDefinitionStruct {
  maxSupply: number
  minted: number
  rarity: number
  frozen: boolean
  exists: boolean
  contentHash: `0x${string}`
}

async function fetchCloset(
  client: PublicClient,
  owner: Address,
  weaponSkin: Address,
  registry: Address | undefined,
): Promise<ClosetItem[]> {
  const tokenIds = (await client.readContract({
    address: weaponSkin,
    abi: weaponSkinAbi,
    functionName: 'tokensOfOwner',
    args: [owner],
  })) as readonly bigint[]

  if (tokenIds.length === 0) return []

  const skinDatas = await batchRead<SkinDataStruct>(
    client,
    tokenIds.map((id) => ({
      address: weaponSkin,
      abi: weaponSkinAbi,
      functionName: 'skinData',
      args: [id],
    })),
  )

  const uniqueDefIds = [...new Set(skinDatas.map((d) => d.skinDefId))]
  const defsById = new Map<number, SkinDefinitionStruct>()
  if (registry && uniqueDefIds.length > 0) {
    const defs = await batchRead<SkinDefinitionStruct>(
      client,
      uniqueDefIds.map((defId) => ({
        address: registry,
        abi: gameAssetRegistryAbi,
        functionName: 'getSkin',
        args: [defId],
      })),
    )
    uniqueDefIds.forEach((defId, i) => defsById.set(defId, defs[i]))
  }

  const items = tokenIds.map((id, i): ClosetItem => {
    const data = skinDatas[i]
    const def = defsById.get(data.skinDefId)
    return {
      tokenId: id.toString(),
      skinDefId: data.skinDefId,
      serial: data.serial,
      wear: data.wear,
      seasonId: data.seasonId,
      mintedAt: Number(data.mintedAt),
      name: skinName(data.skinDefId),
      rarity: def?.rarity ?? null,
      maxSupply: def?.maxSupply ?? null,
      minted: def?.minted ?? null,
      frozen: def?.frozen ?? null,
      contentHash: def?.contentHash ?? null,
    }
  })

  // Newest first — freshly minted rewards surface at the top.
  return items.sort((a, b) => b.mintedAt - a.mintedAt)
}

export function useCloset() {
  const { address: owner } = useAccount()
  const client = usePublicClient()
  const { addresses } = useContracts()
  const weaponSkin = addresses.weaponSkin
  const registry = addresses.gameAssetRegistry

  return useQuery({
    queryKey: [
      'closet',
      activeChain.id,
      weaponSkin ?? null,
      registry ?? null,
      owner ?? null,
    ],
    enabled: Boolean(client && owner && weaponSkin),
    queryFn: () => fetchCloset(client as PublicClient, owner!, weaponSkin!, registry),
  })
}
