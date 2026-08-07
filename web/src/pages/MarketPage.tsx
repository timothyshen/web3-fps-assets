import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseEther, type PublicClient } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { weaponSkinAbi } from '../abi/weaponSkin'
import { ConnectPanel } from '../components/ConnectPanel'
import { ConfigMissing, Notice } from '../components/Notice'
import { SkinCard } from '../components/SkinCard'
import { activeChain, nativeSymbol } from '../config/chain'
import { useCloset } from '../hooks/useCloset'
import { ENUMERATION_CAP, useMarket, type MarketListingItem } from '../hooks/useMarket'
import { useMarketActions, type MarketStep } from '../hooks/useMarketActions'
import { errorText } from '../lib/errors'
import { addressesEqual, formatNative, shortAddress } from '../lib/format'
import { useContracts } from '../providers/ContractsProvider'

const MAX_UINT96 = 2n ** 96n - 1n

const STEP_TEXT: Record<MarketStep, string> = {
  idle: '',
  approve: 'Confirm the one-time market approval in your wallet…',
  'approve-wait': 'Waiting for the approval transaction…',
  list: 'Confirm the listing in your wallet…',
  'list-wait': 'Waiting for the listing transaction…',
  buy: 'Confirm the purchase in your wallet…',
  'buy-wait': 'Waiting for the purchase transaction…',
  cancel: 'Confirm the cancellation in your wallet…',
  'cancel-wait': 'Waiting for the cancellation transaction…',
}

function ListSkinForm({
  listedTokenIds,
  actions,
}: {
  listedTokenIds: Set<string>
  actions: ReturnType<typeof useMarketActions>
}) {
  const { addresses } = useContracts()
  const { address: account, chainId } = useAccount()
  const client = usePublicClient()
  const closet = useCloset()
  const [searchParams] = useSearchParams()
  const [tokenId, setTokenId] = useState('')
  const [price, setPrice] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  // Prefill from /market?tokenId=… (closet "List on market" links).
  const prefill = searchParams.get('tokenId') ?? ''
  useEffect(() => {
    if (prefill) setTokenId(prefill)
  }, [prefill])

  const approvalQuery = useQuery({
    queryKey: ['approval', activeChain.id, addresses.weaponSkin, account ?? null, addresses.skinMarket],
    enabled: Boolean(client && account && addresses.weaponSkin && addresses.skinMarket),
    queryFn: async () =>
      (client as PublicClient).readContract({
        address: addresses.weaponSkin!,
        abi: weaponSkinAbi,
        functionName: 'isApprovedForAll',
        args: [account!, addresses.skinMarket!],
      }) as Promise<boolean>,
  })

  const wrongNetwork = Boolean(account) && chainId !== activeChain.id
  const items = closet.data ?? []

  const submit = () => {
    setFormError(null)
    if (!tokenId) {
      setFormError('Pick a skin to list.')
      return
    }
    let priceWei: bigint
    try {
      priceWei = parseEther(price)
    } catch {
      setFormError(`Enter a price in ${nativeSymbol}, e.g. 1.5`)
      return
    }
    if (priceWei <= 0n) {
      setFormError('Price must be greater than zero.')
      return
    }
    if (priceWei > MAX_UINT96) {
      setFormError('Price exceeds uint96 — pick something smaller.')
      return
    }
    actions.list.mutate({ tokenId, priceWei })
  }

  if (!account) {
    return (
      <section className="card">
        <h2>List a skin</h2>
        <p>Connect a wallet to list one of your skins.</p>
        <ConnectPanel />
      </section>
    )
  }

  return (
    <section className="card">
      <h2>List a skin</h2>
      <div className="form-row">
        <label className="field">
          <span>Skin</span>
          <select value={tokenId} onChange={(e) => setTokenId(e.target.value)}>
            <option value="">— select from your closet —</option>
            {items.map((item) => {
              const alreadyListed = listedTokenIds.has(item.tokenId)
              return (
                <option key={item.tokenId} value={item.tokenId} disabled={alreadyListed}>
                  {item.name} #{item.serial}
                  {alreadyListed ? ' (already listed)' : ''}
                </option>
              )
            })}
          </select>
        </label>
        <label className="field">
          <span>Price ({nativeSymbol})</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="1.0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <button
          className="btn btn-primary"
          disabled={actions.list.isPending || wrongNetwork || items.length === 0}
          onClick={submit}
        >
          {actions.list.isPending ? 'Listing…' : 'List for sale'}
        </button>
      </div>
      {items.length === 0 && !closet.isPending && (
        <p className="hint">No skins in this wallet to list.</p>
      )}
      {approvalQuery.data === false && (
        <p className="hint">
          First listing includes a one-time setApprovalForAll transaction so the market can
          transfer the skin when it sells.
        </p>
      )}
      {wrongNetwork && <p className="error-text">Switch the wallet to {activeChain.name} first.</p>}
      {STEP_TEXT[actions.step] && (actions.step.startsWith('approve') || actions.step.startsWith('list')) && (
        <p className="tx-step">
          <span className="spinner" /> {STEP_TEXT[actions.step]}
        </p>
      )}
      {formError && <p className="error-text">{formError}</p>}
      {actions.list.isError && <p className="error-text">{errorText(actions.list.error)}</p>}
      {actions.list.isSuccess && <p className="ok-text">Listed. It appears below once refreshed.</p>}
    </section>
  )
}

function ListingCard({
  listing,
  actions,
}: {
  listing: MarketListingItem
  actions: ReturnType<typeof useMarketActions>
}) {
  const { address: account, chainId } = useAccount()
  const mine = addressesEqual(listing.seller, account)
  const wrongNetwork = Boolean(account) && chainId !== activeChain.id

  const buyPending =
    actions.buy.isPending && actions.buy.variables?.tokenId === listing.tokenId
  const cancelPending =
    actions.cancel.isPending && actions.cancel.variables?.tokenId === listing.tokenId

  return (
    <SkinCard
      data={listing}
      footer={
        <div className="listing-foot">
          <div className="listing-price mono" title={`${listing.priceWei.toString()} wei`}>
            {formatNative(listing.priceWei)}
          </div>
          <div className="listing-meta">
            <span className="muted">
              seller {mine ? 'you' : shortAddress(listing.seller)}
            </span>
            {listing.royaltyReceiver && (
              <span
                className="muted"
                title={`EIP-2981: ${listing.royaltyWei.toString()} wei to ${listing.royaltyReceiver}`}
              >
                royalty {(listing.royaltyBps / 100).toFixed(1).replace(/\.0$/, '')}% to{' '}
                {shortAddress(listing.royaltyReceiver)}
              </span>
            )}
            {!listing.active && (
              <span className="tag tag-stale" title="Seller moved the skin or revoked approval — cannot be bought.">
                STALE
              </span>
            )}
          </div>
          {mine ? (
            <button
              className="btn btn-block"
              disabled={cancelPending || actions.cancel.isPending || wrongNetwork}
              onClick={() => actions.cancel.mutate({ tokenId: listing.tokenId })}
            >
              {cancelPending ? 'Cancelling…' : 'Cancel listing'}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-block"
              disabled={!account || !listing.active || buyPending || actions.buy.isPending || wrongNetwork}
              onClick={() =>
                actions.buy.mutate({ tokenId: listing.tokenId, priceWei: listing.priceWei })
              }
            >
              {buyPending
                ? 'Buying…'
                : !account
                  ? 'Connect to buy'
                  : listing.active
                    ? `Buy for ${formatNative(listing.priceWei)}`
                    : 'Unavailable'}
            </button>
          )}
        </div>
      }
    />
  )
}

export function MarketPage() {
  const { addresses } = useContracts()
  const market = useMarket()
  const actions = useMarketActions()

  const listedTokenIds = useMemo(
    () => new Set((market.data?.listings ?? []).map((l) => l.tokenId)),
    [market.data],
  )

  if (!addresses.weaponSkin || !addresses.skinMarket) {
    return (
      <div className="page">
        <h1 className="page-title">Market</h1>
        <ConfigMissing needed={['WeaponSkin', 'SkinMarket']} />
      </div>
    )
  }

  const actionError = actions.buy.error ?? actions.cancel.error

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Market</h1>
        <div className="page-head-right">
          <span className="muted">
            fixed-price listings · native {nativeSymbol} · royalties via EIP-2981
          </span>
          <button
            className="btn btn-small"
            disabled={market.isFetching}
            onClick={() => market.refetch()}
          >
            {market.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <ListSkinForm listedTokenIds={listedTokenIds} actions={actions} />

      {market.isPending && (
        <div className="card center">
          <span className="spinner" /> Scanning listings…
        </div>
      )}

      {market.isError && (
        <Notice tone="error" title="Could not load listings">
          <p>{errorText(market.error)}</p>
          <button className="btn" onClick={() => market.refetch()}>
            Retry
          </button>
        </Notice>
      )}

      {market.data && !market.data.scannedAll && (
        <Notice tone="warn">
          Collection has {market.data.totalTokens} tokens; only the first {ENUMERATION_CAP} were
          scanned for listings. See web/README.md for the indexer/getLogs upgrade path.
        </Notice>
      )}

      {(STEP_TEXT[actions.step] && (actions.step.startsWith('buy') || actions.step.startsWith('cancel'))) && (
        <p className="tx-step">
          <span className="spinner" /> {STEP_TEXT[actions.step]}
        </p>
      )}
      {actionError != null && <p className="error-text">{errorText(actionError)}</p>}

      {market.data && market.data.listings.length === 0 && (
        <div className="card empty">
          <p>No listings right now.</p>
          <p className="hint">List one of your skins above — the full loop runs on-chain.</p>
        </div>
      )}

      {market.data && market.data.listings.length > 0 && (
        <div className="grid-cards">
          {market.data.listings.map((listing) => (
            <ListingCard key={listing.tokenId} listing={listing} actions={actions} />
          ))}
        </div>
      )}
    </div>
  )
}
