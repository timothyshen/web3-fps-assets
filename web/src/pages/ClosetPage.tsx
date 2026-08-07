import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ConnectPanel } from '../components/ConnectPanel'
import { ConfigMissing, Notice } from '../components/Notice'
import { SkinCard } from '../components/SkinCard'
import { activeChain } from '../config/chain'
import { useCloset } from '../hooks/useCloset'
import { errorText } from '../lib/errors'
import { useContracts } from '../providers/ContractsProvider'

/** The player's on-chain inventory, read live via WeaponSkin.tokensOfOwner. */
export function ClosetPage() {
  const { addresses } = useContracts()
  const { isConnected } = useAccount()
  const closet = useCloset()

  if (!addresses.weaponSkin) {
    return (
      <div className="page">
        <h1 className="page-title">Closet</h1>
        <ConfigMissing needed={['WeaponSkin', 'GameAssetRegistry (optional, for rarity/supply)']} />
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="page">
        <h1 className="page-title">Closet</h1>
        <section className="card">
          <p>Connect a wallet to view the skins it holds.</p>
          <ConnectPanel />
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Closet</h1>
        <div className="page-head-right">
          <span className="muted">
            {closet.data ? `${closet.data.length} skin${closet.data.length === 1 ? '' : 's'}` : ''}
            {' · read live from '}
            {activeChain.name}
          </span>
          <button
            className="btn btn-small"
            disabled={closet.isFetching}
            onClick={() => closet.refetch()}
          >
            {closet.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {!addresses.gameAssetRegistry && (
        <Notice tone="info">
          GameAssetRegistry address not set — rarity, max supply and content hash are hidden.
        </Notice>
      )}

      {closet.isPending && (
        <div className="card center">
          <span className="spinner" /> Reading tokensOfOwner…
        </div>
      )}

      {closet.isError && (
        <Notice tone="error" title="Could not read the closet">
          <p>{errorText(closet.error)}</p>
          <p className="hint">
            Check the RPC and the configured contract addresses, then retry.
          </p>
          <button className="btn" onClick={() => closet.refetch()}>
            Retry
          </button>
        </Notice>
      )}

      {closet.data && closet.data.length === 0 && (
        <div className="card empty">
          <p>No skins in this wallet yet.</p>
          <p className="hint">
            Rewards minted after matches land here automatically — or buy one on the{' '}
            <Link to="/market">market</Link>.
          </p>
        </div>
      )}

      {closet.data && closet.data.length > 0 && (
        <div className="grid-cards">
          {closet.data.map((item) => (
            <SkinCard
              key={item.tokenId}
              data={item}
              footer={
                <Link className="btn btn-block" to={`/market?tokenId=${item.tokenId}`}>
                  List on market
                </Link>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
