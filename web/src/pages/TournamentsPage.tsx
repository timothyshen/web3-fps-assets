import { Link } from 'react-router-dom'
import { ConfigMissing, Notice } from '../components/Notice'
import { activeChain, nativeSymbol } from '../config/chain'
import { LIST_SCAN_CAP, useTournaments } from '../hooks/useTournaments'
import { errorText } from '../lib/errors'
import { formatNative } from '../lib/format'
import {
  formatBps,
  formatUnix,
  PHASE_CLASS,
  PHASE_LABEL,
  relativeTime,
  tournamentPhase,
  type TournamentInfo,
} from '../lib/tournament'
import { useContracts } from '../providers/ContractsProvider'

function TournamentRow({ info, nowSec }: { info: TournamentInfo; nowSec: number }) {
  const phase = tournamentPhase(info, nowSec)
  return (
    <Link to={`/tournaments/${info.id}`} className="tournament-row">
      <div className="tournament-row-main">
        <span className="tournament-id mono">#{info.id}</span>
        <span className={`pill ${PHASE_CLASS[phase]}`}>{PHASE_LABEL[phase]}</span>
      </div>
      <div className="tournament-row-facts">
        <span title={`${info.prizePool.toString()} wei`}>
          <span className="muted">pool</span>{' '}
          <span className="mono strong">{formatNative(info.prizePool)}</span>
        </span>
        <span title={info.entryFee > 0n ? `${info.entryFee.toString()} wei` : undefined}>
          <span className="muted">entry</span>{' '}
          <span className="mono">
            {info.entryFee > 0n ? formatNative(info.entryFee) : 'free'}
          </span>
        </span>
        <span>
          <span className="muted">players</span>{' '}
          <span className="mono">
            {info.participantCount} · min {info.minParticipants} · max {info.maxParticipants}
          </span>
        </span>
        <span>
          <span className="muted">org fee</span>{' '}
          <span className="mono">{formatBps(info.organizerFeeBps)}</span>
        </span>
        <span>
          <span className="muted">reg closes</span>{' '}
          <span className="mono">
            {formatUnix(info.registrationDeadline)} ({relativeTime(info.registrationDeadline, nowSec)})
          </span>
        </span>
        <span>
          <span className="muted">results due</span>{' '}
          <span className="mono">{formatUnix(info.resultDeadline)}</span>
        </span>
      </div>
    </Link>
  )
}

/** All tournaments, newest first, enumerated via tournamentCount (sequential ids). */
export function TournamentsPage() {
  const { addresses } = useContracts()
  const list = useTournaments()
  const nowSec = Math.floor(Date.now() / 1000)

  if (!addresses.tournamentEscrow) {
    return (
      <div className="page">
        <h1 className="page-title">Tournaments</h1>
        <ConfigMissing needed={['TournamentEscrow']} />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Tournaments</h1>
        <div className="page-head-right">
          <span className="muted">
            prize-pool escrow · entry fees locked on-chain · {nativeSymbol}
          </span>
          <button className="btn btn-small" disabled={list.isFetching} onClick={() => list.refetch()}>
            {list.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <Notice tone="info">
        Entry fees go into the escrow contract, not to the organizer — the organizer can only
        ever take the fee declared at creation (hard cap 10%). If results never arrive,
        anyone can trigger cancellation and everyone reclaims their money.
      </Notice>

      {list.isPending && (
        <div className="card center">
          <span className="spinner" /> Reading tournamentCount…
        </div>
      )}

      {list.isError && (
        <Notice tone="error" title="Could not load tournaments">
          <p>{errorText(list.error)}</p>
          <button className="btn" onClick={() => list.refetch()}>
            Retry
          </button>
        </Notice>
      )}

      {list.data && !list.data.scannedAll && (
        <Notice tone="warn">
          Showing the newest {LIST_SCAN_CAP} of {list.data.totalCount} tournaments.
        </Notice>
      )}

      {list.data && list.data.tournaments.length === 0 && (
        <div className="card empty">
          <p>No tournaments created yet on {activeChain.name}.</p>
          <p className="hint">
            Anyone can create one by calling TournamentEscrow.createTournament — see
            docs/onchain-features.md.
          </p>
        </div>
      )}

      {list.data && list.data.tournaments.length > 0 && (
        <div className="tournament-list">
          {list.data.tournaments.map((info) => (
            <TournamentRow key={info.id} info={info} nowSec={nowSec} />
          ))}
        </div>
      )}
    </div>
  )
}
