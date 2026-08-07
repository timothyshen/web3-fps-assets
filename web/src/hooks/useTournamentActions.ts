import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { PublicClient } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'
import { tournamentEscrowAbi } from '../abi/tournamentEscrow'
import { activeChain } from '../config/chain'
import { useContracts } from '../providers/ContractsProvider'

/**
 * TournamentEscrow writes. tournamentIds arrive as decimal strings; BigInt
 * conversion happens only at the call boundary. Every mutation returns the
 * tx hash (also kept in `lastHash` for explorer links) and resolves after
 * the receipt, so pages can render wallet -> pending -> confirmed states.
 */
export type TournamentTxStep = 'idle' | 'wallet' | 'pending'

export function useTournamentActions() {
  const { addresses } = useContracts()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<TournamentTxStep>('idle')
  const [lastHash, setLastHash] = useState<`0x${string}` | null>(null)

  const requireSetup = () => {
    const escrow = addresses.tournamentEscrow
    if (!client || !escrow) {
      throw new Error('TournamentEscrow not configured or RPC unavailable.')
    }
    return { client: client as PublicClient, escrow }
  }

  const finish = async (client: PublicClient, hash: `0x${string}`) => {
    setLastHash(hash)
    setStep('pending')
    await client.waitForTransactionReceipt({ hash })
    return hash
  }

  const onSettled = () => {
    setStep('idle')
    void queryClient.invalidateQueries({ queryKey: ['tournament'] })
    void queryClient.invalidateQueries({ queryKey: ['tournaments'] })
    void queryClient.invalidateQueries({ queryKey: ['tournament-events'] })
  }

  const register = useMutation({
    mutationFn: async ({ id, entryFee }: { id: string; entryFee: bigint }) => {
      const { client, escrow } = requireSetup()
      setStep('wallet')
      const hash = await writeContractAsync({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'register',
        args: [BigInt(id)],
        value: entryFee,
        chainId: activeChain.id,
      })
      return finish(client, hash)
    },
    onSettled,
  })

  const sponsor = useMutation({
    mutationFn: async ({ id, amountWei }: { id: string; amountWei: bigint }) => {
      const { client, escrow } = requireSetup()
      setStep('wallet')
      const hash = await writeContractAsync({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'sponsor',
        args: [BigInt(id)],
        value: amountWei,
        chainId: activeChain.id,
      })
      return finish(client, hash)
    },
    onSettled,
  })

  const claimPrize = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { client, escrow } = requireSetup()
      setStep('wallet')
      const hash = await writeContractAsync({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'claimPrize',
        args: [BigInt(id)],
        chainId: activeChain.id,
      })
      return finish(client, hash)
    },
    onSettled,
  })

  const claimRefund = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { client, escrow } = requireSetup()
      setStep('wallet')
      const hash = await writeContractAsync({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'claimRefund',
        args: [BigInt(id)],
        chainId: activeChain.id,
      })
      return finish(client, hash)
    },
    onSettled,
  })

  const cancel = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { client, escrow } = requireSetup()
      setStep('wallet')
      const hash = await writeContractAsync({
        address: escrow,
        abi: tournamentEscrowAbi,
        functionName: 'cancel',
        args: [BigInt(id)],
        chainId: activeChain.id,
      })
      return finish(client, hash)
    },
    onSettled,
  })

  return { step, lastHash, register, sponsor, claimPrize, claimRefund, cancel }
}
