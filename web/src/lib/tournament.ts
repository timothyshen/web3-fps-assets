import type { Address } from 'viem'

/**
 * Pure tournament view-model types and helpers.
 * tournamentIds are uint256 and stay DECIMAL STRINGS in all UI state.
 */

/** Mirrors ITournamentEscrow.Status. */
export const TournamentStatus = {
  None: 0,
  Open: 1,
  Settled: 2,
  Cancelled: 3,
} as const

export interface TournamentInfo {
  /** uint256 as decimal string. */
  id: string
  organizer: Address
  resultSubmitter: Address
  entryFee: bigint
  minParticipants: number
  maxParticipants: number
  organizerFeeBps: number
  status: number
  /** Unix seconds. */
  registrationDeadline: number
  resultDeadline: number
  participantCount: number
  prizePool: bigint
}

/** Raw viem decode of the Tournament struct (uint64 -> bigint, <=uint32 -> number). */
export interface TournamentStruct {
  organizer: Address
  entryFee: bigint
  resultSubmitter: Address
  maxParticipants: number
  minParticipants: number
  organizerFeeBps: number
  status: number
  registrationDeadline: bigint
  resultDeadline: bigint
  participantCount: number
  prizePool: bigint
}

export function toTournamentInfo(id: string, t: TournamentStruct): TournamentInfo {
  return {
    id,
    organizer: t.organizer,
    resultSubmitter: t.resultSubmitter,
    entryFee: t.entryFee,
    minParticipants: t.minParticipants,
    maxParticipants: t.maxParticipants,
    organizerFeeBps: t.organizerFeeBps,
    status: t.status,
    registrationDeadline: Number(t.registrationDeadline),
    resultDeadline: Number(t.resultDeadline),
    participantCount: t.participantCount,
    prizePool: t.prizePool,
  }
}

/**
 * Display phase. The contract only knows Open/Settled/Cancelled; within Open
 * the deadlines and fill level determine what a player can actually do.
 */
export type TournamentPhase =
  | 'registration' // Open, before registration deadline, seats left
  | 'awaiting-results' // Open, registration over (deadline passed or full)
  | 'overdue' // Open but past resultDeadline — anyone may cancel for refunds
  | 'settled'
  | 'cancelled'
  | 'unknown'

export function tournamentPhase(t: TournamentInfo, nowSec: number): TournamentPhase {
  if (t.status === TournamentStatus.Settled) return 'settled'
  if (t.status === TournamentStatus.Cancelled) return 'cancelled'
  if (t.status !== TournamentStatus.Open) return 'unknown'
  if (nowSec > t.resultDeadline) return 'overdue'
  if (nowSec > t.registrationDeadline || t.participantCount >= t.maxParticipants) {
    return 'awaiting-results'
  }
  return 'registration'
}

export const PHASE_LABEL: Record<TournamentPhase, string> = {
  registration: 'Registration open',
  'awaiting-results': 'Awaiting results',
  overdue: 'Overdue — refundable',
  settled: 'Settled',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
}

export const PHASE_CLASS: Record<TournamentPhase, string> = {
  registration: 'pill-open',
  'awaiting-results': 'pill-wait',
  overdue: 'pill-overdue',
  settled: 'pill-settled',
  cancelled: 'pill-cancelled',
  unknown: 'pill-wait',
}

/** "5%" / "2.5%" from basis points. */
export function formatBps(bps: number): string {
  const pct = bps / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`
}

/** "2026-08-08 14:00" in the viewer's local time. */
export function formatUnix(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Coarse relative time: "in 2d 4h" / "3h 12m ago". */
export function relativeTime(unixSec: number, nowSec: number): string {
  let diff = unixSec - nowSec
  const past = diff < 0
  diff = Math.abs(diff)
  const days = Math.floor(diff / 86_400)
  const hours = Math.floor((diff % 86_400) / 3_600)
  const minutes = Math.floor((diff % 3_600) / 60)
  const parts =
    days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  return past ? `${parts} ago` : `in ${parts}`
}

/**
 * The three cancellation reasons (contract emits them as the exact strings
 * below in the Cancelled event). PRD TRN-005: each must be displayed
 * distinctly — a player must be able to tell WHY the tournament died.
 */
export const CANCEL_REASON_TEXT: Record<string, { title: string; body: string }> = {
  organizer_cancelled: {
    title: 'Cancelled by the organizer',
    body:
      'The organizer called the tournament off before the registration deadline. ' +
      'Every entry fee and sponsorship is refundable in full.',
  },
  not_enough_participants: {
    title: 'Not enough participants',
    body:
      'Registration closed below the required minimum, so the tournament was voided ' +
      '(anyone may trigger this cancellation). Every payment is refundable in full.',
  },
  result_deadline_passed: {
    title: 'Results never arrived',
    body:
      'The result submitter failed to settle before the result deadline. This is the ' +
      'escape hatch built into the escrow: anyone may trigger cancellation, and every ' +
      'entry fee and sponsorship is refundable in full — funds can never be locked forever.',
  },
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th"… */
export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/**
 * Projected payout for one rank from the current pool, mirroring the
 * contract's integer math: organizer fee comes off the top, then
 * (distributable * bps) / 10000 per rank (division dust goes to rank 1 on
 * settlement — projections here ignore dust).
 */
export function projectedPayout(pool: bigint, organizerFeeBps: number, rankBps: number): bigint {
  const distributable = pool - (pool * BigInt(organizerFeeBps)) / 10_000n
  return (distributable * BigInt(rankBps)) / 10_000n
}

export const VALID_ACTIONS = ['register', 'sponsor', 'claim-prize', 'claim-refund'] as const
export type TournamentAction = (typeof VALID_ACTIONS)[number]

export function isTournamentAction(value: string): value is TournamentAction {
  return (VALID_ACTIONS as readonly string[]).includes(value)
}

/** Route param sanity: tournament ids are positive decimal integers. */
export function isValidTournamentId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value)
}
