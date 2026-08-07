import { useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'
import { usePublicClient } from 'wagmi'
import { tournamentEscrowAbi } from '../abi/tournamentEscrow'
import { activeChain } from '../config/chain'
import { batchRead } from '../lib/batchRead'
import { toTournamentInfo, type TournamentInfo, type TournamentStruct } from '../lib/tournament'
import { useContracts } from '../providers/ContractsProvider'

/**
 * List enumeration — the decision, documented:
 *
 * TournamentEscrow needs NO event scanning for the list. Verified in the
 * .sol: `tournamentCount` is a public counter and ids are assigned
 * sequentially (`tournamentId = ++tournamentCount`), so every id in
 * 1..count exists. The list is one `tournamentCount` read plus a multicall
 * of `getTournament(id)` — exact current state, no deploy-block config, no
 * RPC log-range limits. Only the detail page touches events (winners /
 * cancel reason / resultHash are not stored in state).
 *
 * Newest LIST_SCAN_CAP tournaments are read (newest first); beyond that the
 * UI reports truncation.
 */
export const LIST_SCAN_CAP = 200

export interface TournamentListData {
  tournaments: TournamentInfo[]
  totalCount: number
  scannedAll: boolean
}

async function fetchTournaments(
  client: PublicClient,
  escrow: Address,
): Promise<TournamentListData> {
  const count = (await client.readContract({
    address: escrow,
    abi: tournamentEscrowAbi,
    functionName: 'tournamentCount',
  })) as bigint

  const totalCount = Number(count)
  if (totalCount === 0) return { tournaments: [], totalCount, scannedAll: true }

  const newestFirstIds: string[] = []
  const lowest = Math.max(1, totalCount - LIST_SCAN_CAP + 1)
  for (let id = totalCount; id >= lowest; id--) newestFirstIds.push(String(id))

  const structs = await batchRead<TournamentStruct>(
    client,
    newestFirstIds.map((id) => ({
      address: escrow,
      abi: tournamentEscrowAbi,
      functionName: 'getTournament',
      args: [BigInt(id)],
    })),
  )

  return {
    tournaments: newestFirstIds.map((id, i) => toTournamentInfo(id, structs[i])),
    totalCount,
    scannedAll: lowest === 1,
  }
}

export function useTournaments() {
  const client = usePublicClient()
  const { addresses } = useContracts()
  const escrow = addresses.tournamentEscrow

  return useQuery({
    queryKey: ['tournaments', activeChain.id, escrow ?? null],
    enabled: Boolean(client && escrow),
    queryFn: () => fetchTournaments(client as PublicClient, escrow!),
  })
}
