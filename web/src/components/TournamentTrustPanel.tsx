import { useAccount } from 'wagmi'
import { explorerAddressUrl } from '../config/chain'
import { errorText } from '../lib/errors'
import { addressesEqual, formatNative, shortAddress } from '../lib/format'
import {
  formatBps,
  ordinal,
  projectedPayout,
  type TournamentInfo,
} from '../lib/tournament'

function AddressValue({ address }: { address: string }) {
  const url = explorerAddressUrl(address)
  const body = (
    <span className="mono" title={address}>
      {shortAddress(address, 6)}
    </span>
  )
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    body
  )
}

/**
 * PRD TRN-002: before registering, a player MUST see who they are trusting —
 * organizer, resultSubmitter, the organizer's cut, and the payout split.
 * Shown on the detail page and again on the register action page.
 */
export function TournamentTrustPanel({
  info,
  payoutBps,
}: {
  info: TournamentInfo
  payoutBps: number[]
}) {
  const { address: account } = useAccount()

  return (
    <section className="card trust-panel">
      <h2>Trust terms — read before paying</h2>
      <div className="kv-row">
        <span className="muted">Organizer</span>
        <span>
          <AddressValue address={info.organizer} />
          {addressesEqual(info.organizer, account) && <span className="tag you-tag">YOU</span>}
        </span>
      </div>
      <div className="kv-row">
        <span className="muted">Organizer fee</span>
        <span className="mono">
          {formatBps(info.organizerFeeBps)} of the pool (contract hard cap: 10%)
        </span>
      </div>
      <div className="kv-row">
        <span className="muted">Result submitter</span>
        <span>
          <AddressValue address={info.resultSubmitter} />
          {addressesEqual(info.resultSubmitter, account) && (
            <span className="tag you-tag">YOU</span>
          )}
        </span>
      </div>

      <div className="callout callout-warn">
        <strong>This address alone decides the results.</strong> The escrow guarantees the
        organizer cannot take the principal, but it cannot tell who really won — whatever
        ranking the result submitter reports is how the pool is paid. Registering means
        trusting it. It cannot be changed after creation, and if it never submits, the
        escrow unlocks: past the result deadline anyone can cancel for a full refund.
      </div>

      <div className="payout-split">
        <div className="payout-head">
          <span className="muted">Payout split (after organizer fee)</span>
        </div>
        {payoutBps.map((bps, i) => (
          <div className="payout-row" key={i}>
            <span className="payout-rank mono">{ordinal(i + 1)}</span>
            <span className="payout-bar-track">
              <span className="payout-bar" style={{ width: `${Math.max(bps / 100, 2)}%` }} />
            </span>
            <span className="payout-pct mono">{formatBps(bps)}</span>
            {info.prizePool > 0n && (
              <span
                className="payout-proj mono muted"
                title={`${projectedPayout(info.prizePool, info.organizerFeeBps, bps).toString()} wei at the current pool`}
              >
                ≈ {formatNative(projectedPayout(info.prizePool, info.organizerFeeBps, bps))}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/** Standard render for revert / transaction errors under tournament actions. */
export function TxError({ error }: { error: unknown }) {
  if (error == null) return null
  return <p className="error-text">{errorText(error)}</p>
}
