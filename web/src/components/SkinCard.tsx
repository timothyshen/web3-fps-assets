import type { ReactNode } from 'react'
import { explorerTokenUrl } from '../config/chain'
import { formatDate, formatWear, rarityClass, rarityLabel, shortHex } from '../lib/format'
import { useContracts } from '../providers/ContractsProvider'

export interface SkinCardData {
  /** uint256 as decimal string. */
  tokenId: string
  name: string
  rarity: number | null
  serial: number
  maxSupply: number | null
  wear: number
  seasonId: number
  mintedAt?: number
  contentHash?: `0x${string}` | null
  frozen?: boolean | null
}

/** Shared card for closet items and market listings. */
export function SkinCard({ data, footer }: { data: SkinCardData; footer?: ReactNode }) {
  const { addresses } = useContracts()
  const tokenUrl = addresses.weaponSkin
    ? explorerTokenUrl(addresses.weaponSkin, data.tokenId)
    : undefined

  return (
    <article className={`skin-card ${rarityClass(data.rarity)}`}>
      <header className="skin-card-head">
        <span className="rarity-tag">{rarityLabel(data.rarity)}</span>
        {data.frozen && <span className="tag" title="contentHash frozen on-chain">FROZEN</span>}
      </header>
      <h3 className="skin-name">{data.name}</h3>
      <div className="skin-serial">
        <span className="serial-num">#{data.serial}</span>
        <span className="serial-max">/ {data.maxSupply ?? '?'}</span>
      </div>
      <dl className="kv">
        <div>
          <dt>Wear</dt>
          <dd className="mono">{formatWear(data.wear)}</dd>
        </div>
        <div>
          <dt>Season</dt>
          <dd className="mono">S{data.seasonId}</dd>
        </div>
        {data.mintedAt !== undefined && (
          <div>
            <dt>Minted</dt>
            <dd className="mono">{formatDate(data.mintedAt)}</dd>
          </div>
        )}
        <div>
          <dt>Token ID</dt>
          <dd className="mono token-id" title={`uint256 (decimal): ${data.tokenId}`}>
            {tokenUrl ? (
              <a href={tokenUrl} target="_blank" rel="noreferrer">
                {data.tokenId}
              </a>
            ) : (
              data.tokenId
            )}
          </dd>
        </div>
        {data.contentHash && (
          <div>
            <dt>Content hash</dt>
            <dd className="mono" title={data.contentHash}>
              {shortHex(data.contentHash)}
            </dd>
          </div>
        )}
      </dl>
      {footer && <footer className="skin-card-foot">{footer}</footer>}
    </article>
  )
}
