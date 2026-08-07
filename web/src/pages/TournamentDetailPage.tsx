import { Link, useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ConfigMissing, Notice } from '../components/Notice'
import { TournamentTrustPanel, TxError } from '../components/TournamentTrustPanel'
import { explorerTxUrl, nativeSymbol } from '../config/chain'
import { env } from '../config/env'
import { useTournament, useTournamentEvents } from '../hooks/useTournament'
import { useTournamentActions } from '../hooks/useTournamentActions'
import { errorText } from '../lib/errors'
import { addressesEqual, formatNative, shortAddress, shortHex } from '../lib/format'
import {
  CANCEL_REASON_TEXT,
  formatUnix,
  isValidTournamentId,
  ordinal,
  PHASE_CLASS,
  PHASE_LABEL,
  relativeTime,
  tournamentPhase,
} from '../lib/tournament'
import { useContracts } from '../providers/ContractsProvider'

function EventsDegraded({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Notice tone="warn" title="Event lookup failed">
      <p>
        This section reads contract events (the data is not in contract state) and the RPC
        rejected the log query: {errorText(error)}
      </p>
      <p className="hint">
        Set VITE_ESCROW_DEPLOY_BLOCK to the escrow&apos;s deploy block to bound the scan
        {env.escrowDeployBlock ? ` (currently ${env.escrowDeployBlock})` : ''}, or use an RPC
        without log-range limits. Claims are unaffected — amounts come from contract state.
      </p>
      <button className="btn btn-small" onClick={retry}>
        Retry
      </button>
    </Notice>
  )
}

export function TournamentDetailPage() {
  const { id = '' } = useParams()
  const validId = isValidTournamentId(id)
  const { addresses } = useContracts()
  const { address: account } = useAccount()
  const detail = useTournament(validId ? id : undefined, validId)
  const events = useTournamentEvents(validId ? id : undefined, detail.data?.info.status)
  const actions = useTournamentActions()
  const nowSec = Math.floor(Date.now() / 1000)

  if (!addresses.tournamentEscrow) {
    return (
      <div className="page">
        <h1 className="page-title">Tournament</h1>
        <ConfigMissing needed={['TournamentEscrow']} />
      </div>
    )
  }

  if (!validId) {
    return (
      <div className="page page-narrow">
        <Notice tone="error" title="Invalid tournament id">
          &quot;{id}&quot; is not a tournament id — ids are positive integers, e.g.
          /tournaments/1.
        </Notice>
      </div>
    )
  }

  if (detail.isPending) {
    return (
      <div className="page page-narrow">
        <div className="card center">
          <span className="spinner" /> Reading tournament #{id}…
        </div>
      </div>
    )
  }

  if (detail.isError) {
    const notFound = String(detail.error).includes('TournamentNotFound')
    return (
      <div className="page page-narrow">
        <Notice tone="error" title={notFound ? `Tournament #${id} does not exist` : 'Could not load tournament'}>
          <p>{notFound ? 'No tournament with this id has been created on this chain.' : errorText(detail.error)}</p>
          <Link className="btn" to="/tournaments">
            All tournaments
          </Link>
        </Notice>
      </div>
    )
  }

  const { info, payoutBps, anyoneCanCancel, me } = detail.data
  const phase = tournamentPhase(info, nowSec)
  const registrationOpen = phase === 'registration'
  const sponsorOpen = info.status === 1 && nowSec <= info.registrationDeadline
  const cancelReason = events.data?.cancelReason ?? null
  const reasonText = cancelReason ? CANCEL_REASON_TEXT[cancelReason] : undefined

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          Tournament <span className="mono">#{info.id}</span>
        </h1>
        <div className="page-head-right">
          <span className={`pill ${PHASE_CLASS[phase]}`}>{PHASE_LABEL[phase]}</span>
          <Link className="btn btn-small" to="/tournaments">
            All tournaments
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Pool and schedule</h2>
          <div className="amount-big mono" title={`${info.prizePool.toString()} wei`}>
            {formatNative(info.prizePool)}
          </div>
          <p className="hint">current prize pool (entry fees + sponsorships, escrowed)</p>
          <div className="kv-row">
            <span className="muted">Entry fee</span>
            <span className="mono" title={`${info.entryFee.toString()} wei`}>
              {info.entryFee > 0n ? formatNative(info.entryFee) : 'free'}
            </span>
          </div>
          <div className="kv-row">
            <span className="muted">Participants</span>
            <span className="mono">
              {info.participantCount} joined · min {info.minParticipants} · max{' '}
              {info.maxParticipants}
            </span>
          </div>
          <div className="kv-row">
            <span className="muted">Registration closes</span>
            <span className="mono">
              {formatUnix(info.registrationDeadline)} · {relativeTime(info.registrationDeadline, nowSec)}
            </span>
          </div>
          <div className="kv-row">
            <span className="muted">Results due</span>
            <span className="mono">
              {formatUnix(info.resultDeadline)} · {relativeTime(info.resultDeadline, nowSec)}
            </span>
          </div>
          {me?.registered && (
            <p className="ok-text">This wallet is registered in this tournament.</p>
          )}
        </section>

        <TournamentTrustPanel info={info} payoutBps={payoutBps} />
      </div>

      {/* ---- status-dependent sections ---------------------------------- */}

      {registrationOpen && (
        <section className="card">
          <h2>Join</h2>
          <div className="cta-row">
            <Link className="btn btn-primary" to={`/tournaments/${info.id}/register`}>
              Register — {info.entryFee > 0n ? `pay ${formatNative(info.entryFee)}` : 'free'}
            </Link>
            <Link className="btn" to={`/tournaments/${info.id}/sponsor`}>
              Sponsor the pool
            </Link>
          </div>
          {me?.registered && (
            <p className="hint">Already registered — a wallet can only register once.</p>
          )}
        </section>
      )}

      {!registrationOpen && sponsorOpen && (
        <section className="card">
          <h2>Sponsor</h2>
          <p className="hint">
            Registration is closed (full), but sponsorships stay open until the registration
            deadline.
          </p>
          <Link className="btn" to={`/tournaments/${info.id}/sponsor`}>
            Sponsor the pool
          </Link>
        </section>
      )}

      {phase === 'awaiting-results' && (
        <Notice tone="info" title="Waiting for results">
          Registration is closed. The result submitter (
          <span className="mono">{shortAddress(info.resultSubmitter, 6)}</span>) must settle
          before {formatUnix(info.resultDeadline)}. If it fails to, anyone can cancel and
          everyone gets refunded in full.
        </Notice>
      )}

      {phase === 'overdue' && (
        <Notice tone="warn" title="Result deadline passed — escape hatch armed">
          <p>
            No results were submitted in time. The escrow now allows <strong>anyone</strong> to
            cancel this tournament, which unlocks full refunds of all entry fees and
            sponsorships.
          </p>
          <div className="cta-row">
            <button
              className="btn btn-primary"
              disabled={actions.cancel.isPending || !account || !anyoneCanCancel}
              onClick={() => actions.cancel.mutate({ id: info.id })}
            >
              {actions.cancel.isPending ? 'Cancelling…' : 'Trigger cancellation'}
            </button>
            <Link className="btn" to={`/tournaments/${info.id}/claim-refund`}>
              Refund page
            </Link>
          </div>
          {!account && <p className="hint">Connect a wallet to trigger the cancellation.</p>}
          <TxError error={actions.cancel.error} />
        </Notice>
      )}

      {phase === 'registration' &&
        anyoneCanCancel &&
        addressesEqual(info.organizer, account) && (
          <section className="card">
            <h2>Organizer controls</h2>
            <p className="hint">
              Before the registration deadline the organizer may call the tournament off;
              every payment becomes refundable. After the deadline this option disappears —
              the organizer cannot flip the table once the field is set.
            </p>
            <button
              className="btn"
              disabled={actions.cancel.isPending}
              onClick={() => actions.cancel.mutate({ id: info.id })}
            >
              {actions.cancel.isPending ? 'Cancelling…' : 'Cancel tournament (organizer)'}
            </button>
            <TxError error={actions.cancel.error} />
          </section>
        )}

      {actions.cancel.isSuccess && actions.lastHash && (
        <Notice tone="success" title="Cancellation confirmed">
          Refunds are now claimable by every participant and sponsor.{' '}
          {explorerTxUrl(actions.lastHash) && (
            <a href={explorerTxUrl(actions.lastHash)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </Notice>
      )}

      {phase === 'settled' && (
        <section className="card">
          <h2>Final standings</h2>
          {events.isPending && (
            <p className="muted">
              <span className="spinner" /> Reading PrizeAssigned events…
            </p>
          )}
          {events.isError && <EventsDegraded error={events.error} retry={() => events.refetch()} />}
          {events.data && events.data.winners.length > 0 && (
            <table className="winners-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Wallet</th>
                  <th>Prize</th>
                </tr>
              </thead>
              <tbody>
                {events.data.winners.map((w) => (
                  <tr key={w.rank}>
                    <td className="mono">{ordinal(w.rank)}</td>
                    <td className="mono">
                      {shortAddress(w.wallet, 6)}
                      {addressesEqual(w.wallet, account) && <span className="tag you-tag">YOU</span>}
                    </td>
                    <td className="mono" title={`${w.amountWei.toString()} wei`}>
                      {formatNative(w.amountWei)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {events.data && (
            <p className="hint">
              Division dust goes to the champion; the organizer&apos;s{' '}
              {(info.organizerFeeBps / 100).toFixed(2).replace(/\.?0+$/, '')}% fee is claimed
              separately. Result hash:{' '}
              {events.data.resultHash ? (
                <span className="mono" title={events.data.resultHash}>
                  {shortHex(events.data.resultHash)}
                </span>
              ) : (
                'unavailable'
              )}{' '}
              — cross-checkable against the MatchAttestation record.
            </p>
          )}

          {me && me.prizeWei > 0n && (
            <div className="claim-strip">
              <span>
                Claimable by this wallet:{' '}
                <span className="mono strong" title={`${me.prizeWei.toString()} wei`}>
                  {formatNative(me.prizeWei)}
                </span>
              </span>
              <Link className="btn btn-primary" to={`/tournaments/${info.id}/claim-prize`}>
                Claim prize
              </Link>
            </div>
          )}
          {me && me.prizeWei === 0n && (
            <p className="hint">Nothing claimable for the connected wallet.</p>
          )}
          {!account && <p className="hint">Connect a wallet to check for claimable prizes.</p>}
        </section>
      )}

      {phase === 'cancelled' && (
        <section className="card">
          <h2>Why it was cancelled</h2>
          {events.isPending && (
            <p className="muted">
              <span className="spinner" /> Reading Cancelled event…
            </p>
          )}
          {events.isError && <EventsDegraded error={events.error} retry={() => events.refetch()} />}
          {reasonText && (
            <Notice tone="warn" title={reasonText.title}>
              <p>{reasonText.body}</p>
              {events.data?.cancelTriggeredBy && (
                <p className="hint">
                  Triggered by{' '}
                  <span className="mono">{shortAddress(events.data.cancelTriggeredBy, 6)}</span>
                </p>
              )}
            </Notice>
          )}
          {events.data && !reasonText && (
            <p className="muted">
              Cancelled{cancelReason ? ` (reason: ${cancelReason})` : ' — reason event not found in the scanned range.'}
            </p>
          )}

          {me && me.refundableWei > 0n && (
            <div className="claim-strip">
              <span>
                Refundable to this wallet:{' '}
                <span className="mono strong" title={`${me.refundableWei.toString()} wei`}>
                  {formatNative(me.refundableWei)}
                </span>
              </span>
              <Link className="btn btn-primary" to={`/tournaments/${info.id}/claim-refund`}>
                Claim refund
              </Link>
            </div>
          )}
          {me && me.refundableWei === 0n && (
            <p className="hint">
              Nothing refundable for the connected wallet (entry fees and sponsorships are
              refunded to the paying address, in {nativeSymbol}).
            </p>
          )}
          {!account && <p className="hint">Connect a wallet to check for refunds.</p>}
        </section>
      )}
    </div>
  )
}
