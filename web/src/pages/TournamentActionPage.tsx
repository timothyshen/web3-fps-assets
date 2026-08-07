import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { parseEther } from 'viem'
import { useAccount } from 'wagmi'
import { ConnectPanel } from '../components/ConnectPanel'
import { ConfigMissing, Notice } from '../components/Notice'
import { TournamentTrustPanel, TxError } from '../components/TournamentTrustPanel'
import { activeChain, explorerTxUrl, nativeSymbol } from '../config/chain'
import { useTournament } from '../hooks/useTournament'
import { useTournamentActions } from '../hooks/useTournamentActions'
import { errorText } from '../lib/errors'
import { formatNative } from '../lib/format'
import {
  isTournamentAction,
  isValidTournamentId,
  PHASE_CLASS,
  PHASE_LABEL,
  formatUnix,
  tournamentPhase,
  TournamentStatus,
  VALID_ACTIONS,
  type TournamentAction,
} from '../lib/tournament'
import { useContracts } from '../providers/ContractsProvider'

const ACTION_TITLE: Record<TournamentAction, string> = {
  register: 'Register',
  sponsor: 'Sponsor the pool',
  'claim-prize': 'Claim prize',
  'claim-refund': 'Claim refund',
}

function SuccessPanel({ hash, children }: { hash: `0x${string}` | null; children: React.ReactNode }) {
  const url = hash ? explorerTxUrl(hash) : undefined
  return (
    <div className="card success-panel">
      <h2>Transaction confirmed</h2>
      <p>{children}</p>
      {hash && (
        <p className="mono hint" title={hash}>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {hash.slice(0, 18)}… on the explorer
            </a>
          ) : (
            hash
          )}
        </p>
      )}
      <p className="hint">
        You can close this tab — return to the game and refresh the lobby to see the update.
      </p>
    </div>
  )
}

/**
 * /tournaments/:id/:action — the page the backend's actionUrl points at and
 * Unity opens in the system browser (action ∈ register | sponsor |
 * claim-prize | claim-refund, per api/openapi.yaml TournamentIntent).
 */
export function TournamentActionPage() {
  const { id = '', action = '' } = useParams()
  const { addresses } = useContracts()
  const { address: account, chainId } = useAccount()
  const validId = isValidTournamentId(id)
  const validAction = isTournamentAction(action)
  const detail = useTournament(validId ? id : undefined, validId && validAction)
  const actions = useTournamentActions()
  const [sponsorAmount, setSponsorAmount] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const nowSec = Math.floor(Date.now() / 1000)
  const wrongNetwork = Boolean(account) && chainId !== activeChain.id

  if (!addresses.tournamentEscrow) {
    return (
      <div className="page page-narrow">
        <ConfigMissing needed={['TournamentEscrow']} />
      </div>
    )
  }

  if (!validAction || !validId) {
    return (
      <div className="page page-narrow">
        <Notice tone="error" title={!validAction ? 'Unknown action' : 'Invalid tournament id'}>
          {!validAction ? (
            <p>
              &quot;{action}&quot; is not a tournament action. Valid actions:{' '}
              <span className="mono">{VALID_ACTIONS.join(', ')}</span>.
            </p>
          ) : (
            <p>
              &quot;{id}&quot; is not a tournament id — ids are positive integers.
            </p>
          )}
          <Link className="btn" to="/tournaments">
            All tournaments
          </Link>
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
        <Notice
          tone="error"
          title={notFound ? `Tournament #${id} does not exist` : 'Could not load tournament'}
        >
          <p>
            {notFound
              ? 'No tournament with this id has been created on this chain. If you arrived from the game, the lobby may be pointing at a different deployment.'
              : errorText(detail.error)}
          </p>
          <Link className="btn" to="/tournaments">
            All tournaments
          </Link>
        </Notice>
      </div>
    )
  }

  const { info, payoutBps, anyoneCanCancel, me } = detail.data
  const phase = tournamentPhase(info, nowSec)
  const act = action as TournamentAction

  // ---- per-action state ----------------------------------------------------

  const registerBlockers: string[] = []
  if (act === 'register') {
    if (info.status !== TournamentStatus.Open) registerBlockers.push('The tournament is no longer open.')
    else {
      if (nowSec > info.registrationDeadline)
        registerBlockers.push(`Registration closed ${formatUnix(info.registrationDeadline)}.`)
      if (info.participantCount >= info.maxParticipants)
        registerBlockers.push('The tournament is full.')
      if (me?.registered) registerBlockers.push('This wallet is already registered.')
    }
  }

  const sponsorClosed =
    info.status !== TournamentStatus.Open || nowSec > info.registrationDeadline

  const submitSponsor = () => {
    setFormError(null)
    let amountWei: bigint
    try {
      amountWei = parseEther(sponsorAmount)
    } catch {
      setFormError(`Enter an amount in ${nativeSymbol}, e.g. 0.5`)
      return
    }
    if (amountWei <= 0n) {
      setFormError('Amount must be greater than zero.')
      return
    }
    actions.sponsor.mutate({ id: info.id, amountWei })
  }

  const stepLine =
    actions.step === 'wallet' ? (
      <p className="tx-step">
        <span className="spinner" /> Confirm the transaction in your wallet…
      </p>
    ) : actions.step === 'pending' ? (
      <p className="tx-step">
        <span className="spinner" /> Transaction submitted — waiting for confirmation…{' '}
        {actions.lastHash && explorerTxUrl(actions.lastHash) && (
          <a href={explorerTxUrl(actions.lastHash)} target="_blank" rel="noreferrer">
            view
          </a>
        )}
      </p>
    ) : null

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1 className="page-title">
          {ACTION_TITLE[act]} · <span className="mono">#{info.id}</span>
        </h1>
        <div className="page-head-right">
          <span className={`pill ${PHASE_CLASS[phase]}`}>{PHASE_LABEL[phase]}</span>
          <Link className="btn btn-small" to={`/tournaments/${info.id}`}>
            Full details
          </Link>
        </div>
      </div>

      {!account && (
        <section className="card">
          <h2>Connect the wallet to use</h2>
          <ConnectPanel />
        </section>
      )}

      {wrongNetwork && (
        <Notice tone="warn">Switch the wallet to {activeChain.name} to continue.</Notice>
      )}

      {/* ---------------- register ---------------- */}
      {act === 'register' && (
        <>
          <TournamentTrustPanel info={info} payoutBps={payoutBps} />
          {actions.register.isSuccess ? (
            <SuccessPanel hash={actions.lastHash}>
              Registered. Your entry fee is escrowed — refundable in full if the tournament is
              cancelled.
            </SuccessPanel>
          ) : registerBlockers.length > 0 ? (
            <Notice tone="warn" title="Registration not possible">
              {registerBlockers.map((b) => (
                <p key={b}>{b}</p>
              ))}
            </Notice>
          ) : (
            <section className="card">
              <h2>What this transaction does</h2>
              <ul className="fact-list">
                <li>
                  Sends exactly{' '}
                  <span className="mono strong" title={`${info.entryFee.toString()} wei`}>
                    {info.entryFee > 0n ? formatNative(info.entryFee) : `0 ${nativeSymbol} (free entry)`}
                  </span>{' '}
                  to the escrow contract — the contract rejects any other amount.
                </li>
                <li>The fee joins the prize pool; the organizer cannot withdraw it.</li>
                <li>If the tournament is cancelled for any reason, you reclaim it in full.</li>
              </ul>
              <button
                className="btn btn-primary btn-block"
                disabled={!account || wrongNetwork || actions.register.isPending}
                onClick={() => actions.register.mutate({ id: info.id, entryFee: info.entryFee })}
              >
                {actions.register.isPending
                  ? 'Registering…'
                  : info.entryFee > 0n
                    ? `Register and pay ${formatNative(info.entryFee)}`
                    : 'Register (free)'}
              </button>
              {stepLine}
              <TxError error={actions.register.error} />
            </section>
          )}
        </>
      )}

      {/* ---------------- sponsor ---------------- */}
      {act === 'sponsor' && (
        <>
          {actions.sponsor.isSuccess ? (
            <SuccessPanel hash={actions.lastHash}>
              Sponsorship added to the prize pool. If the tournament is cancelled, it is
              refundable in full; once settled it pays out to the winners.
            </SuccessPanel>
          ) : sponsorClosed ? (
            <Notice tone="warn" title="Sponsorship window closed">
              Sponsorships are accepted only while the tournament is open and before the
              registration deadline ({formatUnix(info.registrationDeadline)}).
            </Notice>
          ) : (
            <section className="card">
              <h2>What this transaction does</h2>
              <ul className="fact-list">
                <li>
                  Adds your chosen amount to the prize pool (currently{' '}
                  <span className="mono" title={`${info.prizePool.toString()} wei`}>
                    {formatNative(info.prizePool)}
                  </span>
                  ).
                </li>
                <li>Refundable in full if the tournament is cancelled.</li>
                <li>Paid out to winners (minus the organizer fee) once settled.</li>
              </ul>
              <div className="form-row">
                <label className="field">
                  <span>Amount ({nativeSymbol})</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.5"
                    value={sponsorAmount}
                    onChange={(e) => setSponsorAmount(e.target.value)}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={!account || wrongNetwork || actions.sponsor.isPending}
                  onClick={submitSponsor}
                >
                  {actions.sponsor.isPending ? 'Sponsoring…' : 'Sponsor'}
                </button>
              </div>
              {formError && <p className="error-text">{formError}</p>}
              {stepLine}
              <TxError error={actions.sponsor.error} />
            </section>
          )}
        </>
      )}

      {/* ---------------- claim-prize ---------------- */}
      {act === 'claim-prize' && (
        <>
          {actions.claimPrize.isSuccess ? (
            <SuccessPanel hash={actions.lastHash}>Prize paid out to your wallet.</SuccessPanel>
          ) : info.status !== TournamentStatus.Settled ? (
            <Notice tone="warn" title="No prizes yet">
              Prizes exist only after the tournament settles. Current state:{' '}
              {PHASE_LABEL[phase]}.
            </Notice>
          ) : !account ? null : me && me.prizeWei > 0n ? (
            <section className="card">
              <h2>What this transaction does</h2>
              <ul className="fact-list">
                <li>Sends nothing — claiming is free apart from gas.</li>
                <li>
                  Pays{' '}
                  <span className="mono strong" title={`${me.prizeWei.toString()} wei`}>
                    {formatNative(me.prizeWei)}
                  </span>{' '}
                  from the escrow to this wallet.
                </li>
              </ul>
              <button
                className="btn btn-primary btn-block"
                disabled={wrongNetwork || actions.claimPrize.isPending}
                onClick={() => actions.claimPrize.mutate({ id: info.id })}
              >
                {actions.claimPrize.isPending
                  ? 'Claiming…'
                  : `Claim ${formatNative(me.prizeWei)}`}
              </button>
              {stepLine}
              <TxError error={actions.claimPrize.error} />
            </section>
          ) : (
            <Notice tone="info" title="Nothing to claim">
              The connected wallet has no unclaimed prize in this tournament. Prizes go to the
              wallets the result submitter reported as winners (and the organizer&apos;s fee to
              the organizer).
            </Notice>
          )}
        </>
      )}

      {/* ---------------- claim-refund ---------------- */}
      {act === 'claim-refund' && (
        <>
          {actions.claimRefund.isSuccess ? (
            <SuccessPanel hash={actions.lastHash}>
              Refund paid back to your wallet in full.
            </SuccessPanel>
          ) : info.status === TournamentStatus.Open ? (
            anyoneCanCancel ? (
              <section className="card">
                <h2>One step first: cancel the tournament</h2>
                <p className="hint">
                  Refunds unlock only once the tournament is cancelled. The conditions are
                  met — <strong>anyone</strong> may trigger it now (this is the escrow&apos;s
                  escape hatch; it voids the tournament and unlocks everyone&apos;s refunds).
                </p>
                <button
                  className="btn btn-primary"
                  disabled={!account || wrongNetwork || actions.cancel.isPending}
                  onClick={() => actions.cancel.mutate({ id: info.id })}
                >
                  {actions.cancel.isPending ? 'Cancelling…' : 'Trigger cancellation'}
                </button>
                {stepLine}
                <TxError error={actions.cancel.error} />
                {actions.cancel.isSuccess && (
                  <p className="ok-text">Cancelled — the refund button appears below shortly.</p>
                )}
              </section>
            ) : (
              <Notice tone="warn" title="No refund available yet">
                Refunds exist only after cancellation. This tournament is still open and none
                of the cancellation conditions currently hold (organizer before the
                registration deadline; too few participants after it; or the result deadline
                passing unsettled).
              </Notice>
            )
          ) : info.status !== TournamentStatus.Cancelled ? (
            <Notice tone="warn" title="No refund available">
              This tournament settled — entry fees were paid out as prizes, so there is
              nothing to refund.
            </Notice>
          ) : !account ? null : me && me.refundableWei > 0n ? (
            <section className="card">
              <h2>What this transaction does</h2>
              <ul className="fact-list">
                <li>Sends nothing — claiming is free apart from gas.</li>
                <li>
                  Returns{' '}
                  <span className="mono strong" title={`${me.refundableWei.toString()} wei`}>
                    {formatNative(me.refundableWei)}
                  </span>{' '}
                  (your entry fee plus any sponsorships) to this wallet.
                </li>
              </ul>
              <button
                className="btn btn-primary btn-block"
                disabled={wrongNetwork || actions.claimRefund.isPending}
                onClick={() => actions.claimRefund.mutate({ id: info.id })}
              >
                {actions.claimRefund.isPending
                  ? 'Claiming…'
                  : `Reclaim ${formatNative(me.refundableWei)}`}
              </button>
              {stepLine}
              <TxError error={actions.claimRefund.error} />
            </section>
          ) : (
            <Notice tone="info" title="Nothing to refund">
              The connected wallet paid nothing into this tournament (or already reclaimed
              it).
            </Notice>
          )}
        </>
      )}
    </div>
  )
}
