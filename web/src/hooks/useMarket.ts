import { useQuery } from '@tanstack/react-query'
import { zeroAddress, type Address, type PublicClient } from 'viem'
import { usePublicClient } from 'wagmi'
import { gameAssetRegistryAbi } from '../abi/gameAssetRegistry'
import { skinMarketAbi } from '../abi/skinMarket'
import { weaponSkinAbi } from '../abi/weaponSkin'
import { activeChain } from '../config/chain'
import { skinName } from '../config/skinCatalog'
import { batchRead } from '../lib/batchRead'
import { useContracts } from '../providers/ContractsProvider'

/**
 * Listing enumeration — the decision, documented:
 *
 * SkinMarket exposes NO "all listings" view; per the .sol source the readable
 * surface is getListing(tokenId), isActive(tokenId) and the Listed /
 * Cancelled / Sold events. Two viable strategies:
 *
 *  (a) getLogs over Listed events, replay against getListing. Needs the
 *      market's deploy block and an RPC whose eth_getLogs range limits are
 *      known — fragile on public endpoints.
 *  (b) Enumerate ALL tokenIds via WeaponSkin's ERC721Enumerable
 *      (totalSupply + tokenByIndex, multicall-batched) and multicall
 *      getListing for each; keep entries whose seller != 0.
 *
 * (b) is used here: the collection carries Enumerable precisely so nobody
 * needs an indexer (docs/contracts.md), it needs zero extra config, works on
 * anvil and Monad alike, and is exact (reads current mapping state, no event
 * replay). It is O(totalSupply), so it is capped at ENUMERATION_CAP tokens —
 * far beyond demo scale. Past that cap, switch to (a) or an indexer; the
 * events are already in src/abi/skinMarket.ts.
 */
export const ENUMERATION_CAP = 2000

export interface MarketListingItem {
  /** uint256 as decimal string — never Number. */
  tokenId: string
  seller: Address
  priceWei: bigint
  /** SkinMarket.isActive: seller still owns the token and approval holds. */
  active: boolean
  name: string
  skinDefId: number
  serial: number
  wear: number
  seasonId: number
  rarity: number | null
  maxSupply: number | null
  /** EIP-2981 royalty for this token at the listed price. */
  royaltyReceiver: Address | null
  royaltyWei: bigint
  royaltyBps: number
}

export interface MarketData {
  listings: MarketListingItem[]
  totalTokens: number
  /** false when totalSupply exceeded ENUMERATION_CAP and the scan was truncated. */
  scannedAll: boolean
}

interface ListingStruct {
  seller: Address
  price: bigint
}

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

async function fetchMarket(
  client: PublicClient,
  weaponSkin: Address,
  market: Address,
  registry: Address | undefined,
): Promise<MarketData> {
  const totalSupply = (await client.readContract({
    address: weaponSkin,
    abi: weaponSkinAbi,
    functionName: 'totalSupply',
  })) as bigint

  const totalTokens = Number(totalSupply)
  const scanCount = Math.min(totalTokens, ENUMERATION_CAP)
  const scannedAll = totalTokens <= ENUMERATION_CAP

  if (scanCount === 0) return { listings: [], totalTokens, scannedAll }

  const tokenIds = await batchRead<bigint>(
    client,
    Array.from({ length: scanCount }, (_, i) => ({
      address: weaponSkin,
      abi: weaponSkinAbi,
      functionName: 'tokenByIndex',
      args: [BigInt(i)],
    })),
  )

  const listings = await batchRead<ListingStruct>(
    client,
    tokenIds.map((id) => ({
      address: market,
      abi: skinMarketAbi,
      functionName: 'getListing',
      args: [id],
    })),
  )

  const listed: { tokenId: bigint; listing: ListingStruct }[] = []
  tokenIds.forEach((id, i) => {
    if (listings[i].seller !== zeroAddress) listed.push({ tokenId: id, listing: listings[i] })
  })

  if (listed.length === 0) return { listings: [], totalTokens, scannedAll }

  const [actives, skinDatas, royalties] = await Promise.all([
    batchRead<boolean>(
      client,
      listed.map(({ tokenId }) => ({
        address: market,
        abi: skinMarketAbi,
        functionName: 'isActive',
        args: [tokenId],
      })),
    ),
    batchRead<SkinDataStruct>(
      client,
      listed.map(({ tokenId }) => ({
        address: weaponSkin,
        abi: weaponSkinAbi,
        functionName: 'skinData',
        args: [tokenId],
      })),
    ),
    batchRead<readonly [Address, bigint]>(
      client,
      listed.map(({ tokenId, listing }) => ({
        address: weaponSkin,
        abi: weaponSkinAbi,
        functionName: 'royaltyInfo',
        args: [tokenId, listing.price],
      })),
    ),
  ])

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

  const items = listed.map(({ tokenId, listing }, i): MarketListingItem => {
    const data = skinDatas[i]
    const def = defsById.get(data.skinDefId)
    const [royaltyReceiver, royaltyWei] = royalties[i]
    return {
      tokenId: tokenId.toString(),
      seller: listing.seller,
      priceWei: listing.price,
      active: actives[i],
      name: skinName(data.skinDefId),
      skinDefId: data.skinDefId,
      serial: data.serial,
      wear: data.wear,
      seasonId: data.seasonId,
      rarity: def?.rarity ?? null,
      maxSupply: def?.maxSupply ?? null,
      royaltyReceiver: royaltyReceiver === zeroAddress ? null : royaltyReceiver,
      royaltyWei,
      royaltyBps: listing.price > 0n ? Number((royaltyWei * 10_000n) / listing.price) : 0,
    }
  })

  // Active listings first, then cheapest first.
  items.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.priceWei < b.priceWei ? -1 : a.priceWei > b.priceWei ? 1 : 0
  })

  return { listings: items, totalTokens, scannedAll }
}

export function useMarket() {
  const client = usePublicClient()
  const { addresses } = useContracts()
  const weaponSkin = addresses.weaponSkin
  const market = addresses.skinMarket
  const registry = addresses.gameAssetRegistry

  return useQuery({
    queryKey: [
      'market',
      activeChain.id,
      weaponSkin ?? null,
      market ?? null,
      registry ?? null,
    ],
    enabled: Boolean(client && weaponSkin && market),
    queryFn: () => fetchMarket(client as PublicClient, weaponSkin!, market!, registry),
  })
}
