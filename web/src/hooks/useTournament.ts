import { useQuery } from '@tanstack/react-query'
import { zeroAddress, type Address, type PublicClient } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import {
  cancelledEvent,
  prizeAssignedEvent,
  settledEvent,
  tournamentEscrowAbi,
} from '../abi/tournamentEscrow'
import { activeChain } from '../config/chain'
import { env } from '../config/env'
import {
  toTournamentInfo,
  TournamentStatus,
  type TournamentInfo,
  type TournamentStruct,
} from '../lib/tournament'
import { useContracts } from '../providers/ContractsProvider'

/**
 * Detail = pure state reads (always available):
 *   getTournament + getPayoutBps + canCancel, and per connected wallet
 *   isRegistered / prizeOf / refundableOf.
 *
 * Winners, cancellation reason and resultHash exist ONLY in events
 * (PrizeAssigned / Cancelled / Settled — verified in the .sol; prizes and
 * refunds are per-account mappings, not enumerable). They load in a separate
 * query so an RPC that rejects the log range degrades that section alone —
 * claims still work because amounts come from state.
 * VITE_ESCROW_DEPLOY_BLOCK bounds the scan (defaults to 'earliest').
 */

export interface TournamentDetailData {
  info: TournamentInfo
  payoutBps: number[]
  /** canCancel(id, connected-or-zero): true when the refund escape hatch is armed. */
  anyoneCanCancel: boolean
  me: {
    registered: boolean
    prizeWei: bigint
    refundableWei: bigint
  } | null
}

export interface TournamentWinnerRow {
  rank: number
  wallet: Address
  amountWei: bigint
}

export interface TournamentEventData {
  winners: TournamentWinnerRow[]
  resultHash: `0x${string}` | null
  cancelReason: string | null
  cancelTriggeredBy: Address | null
}

async function fetchTournamentDetail(
  client: PublicClient,
  escrow: Address,
  id: string,
  account: Address | undefined,
): Promise<TournamentDetailData> {
  const tournamentId = BigInt(id)

  const [struct, payoutBps, anyoneCanCancel] = await Promise.all([
    client.readContract({
      address: escrow,
      abi: tournamentEscrowAbi,
      functionName: 'getTournament',
      args: [tournamentId],
    }) as Promise<TournamentStruct>,
    client.readContract({
      address: escrow,
      abi: tournamentEscrowAbi,
      functionName: 'getPayoutBps',
      args: [tournamentId],
    }) as Promise<readonly number[]>,
    client.readContract({
      address: escrow,
      abi: tournamentEscrowAbi,
      functionName: 'canCancel',
      args: [tournamentId, account ?? zeroAddress],
    }) as Promise<boolean>,
  ])

  let me: TournamentDetailData['me'] = null
  if (account) {
    const [registered, prizeWei, refundableWei] = await Promise.all([
      client.readContract({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'isRegistered',
        args: [tournamentId, account],
      }) as Promise<boolean>,
      client.readContract({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'prizeOf',
        args: [tournamentId, account],
      }) as Promise<bigint>,
      client.readContract({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'refundableOf',
        args: [tournamentId, account],
      }) as Promise<bigint>,
    ])
    me = { registered, prizeWei, refundableWei }
  }

  return {
    info: toTournamentInfo(id, struct),
    payoutBps: [...payoutBps],
    anyoneCanCancel,
    me,
  }
}

export function useTournament(id: string | undefined, enabled = true) {
  const client = usePublicClient()
  const { address: account } = useAccount()
  const { addresses } = useContracts()
  const escrow = addresses.tournamentEscrow

  return useQuery({
    queryKey: ['tournament', activeChain.id, escrow ?? null, id ?? null, account ?? null],
    enabled: Boolean(enabled && client && escrow && id),
    queryFn: () => fetchTournamentDetail(client as PublicClient, escrow!, id!, account),
    retry: (failureCount, error) => {
      // TournamentNotFound reverts are terminal — do not hammer the RPC.
      if (String(error).includes('TournamentNotFound')) return false
      return failureCount < 2
    },
  })
}

async function fetchTournamentEvents(
  client: PublicClient,
  escrow: Address,
  id: string,
  status: number,
): Promise<TournamentEventData> {
  const tournamentId = BigInt(id)
  const fromBlock = env.escrowDeployBlock !== undefined ? BigInt(env.escrowDeployBlock) : 'earliest'
  const base = { address: escrow, fromBlock, toBlock: 'latest' } as const

  const result: TournamentEventData = {
    winners: [],
    resultHash: null,
    cancelReason: null,
    cancelTriggeredBy: null,
  }

  if (status === TournamentStatus.Settled) {
    const [prizeLogs, settledLogs] = await Promise.all([
      client.getLogs({ ...base, event: prizeAssignedEvent, args: { tournamentId } }),
      client.getLogs({ ...base, event: settledEvent, args: { tournamentId } }),
    ])
    result.winners = prizeLogs
      .filter((log) => log.args.winner !== undefined && log.args.rank !== undefined)
      .map((log) => ({
        rank: log.args.rank!,
        wallet: log.args.winner!,
        amountWei: log.args.amount ?? 0n,
      }))
      .sort((a, b) => a.rank - b.rank)
    result.resultHash = settledLogs[0]?.args.resultHash ?? null
  } else if (status === TournamentStatus.Cancelled) {
    const cancelLogs = await client.getLogs({
      ...base,
      event: cancelledEvent,
      args: { tournamentId },
    })
    const last = cancelLogs[cancelLogs.length - 1]
    result.cancelReason = last?.args.reason ?? null
    result.cancelTriggeredBy = last?.args.triggeredBy ?? null
  }

  return result
}

/** Event-backed extras for terminal states; failures degrade only this section. */
export function useTournamentEvents(id: string | undefined, status: number | undefined) {
  const client = usePublicClient()
  const { addresses } = useContracts()
  const escrow = addresses.tournamentEscrow
  const terminal = status === TournamentStatus.Settled || status === TournamentStatus.Cancelled

  return useQuery({
    queryKey: ['tournament-events', activeChain.id, escrow ?? null, id ?? null, status ?? null],
    enabled: Boolean(client && escrow && id && terminal),
    queryFn: () => fetchTournamentEvents(client as PublicClient, escrow!, id!, status!),
    staleTime: 60_000,
  })
}
