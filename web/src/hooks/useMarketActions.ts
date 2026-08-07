import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { PublicClient } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { skinMarketAbi } from '../abi/skinMarket'
import { weaponSkinAbi } from '../abi/weaponSkin'
import { activeChain } from '../config/chain'
import { useContracts } from '../providers/ContractsProvider'

/**
 * Write flows against SkinMarket. tokenIds arrive as decimal strings and are
 * converted to BigInt only here, at the call boundary.
 *
 * list: checks isApprovedForAll fresh, runs setApprovalForAll first if
 * needed (SkinMarket.list requires operator approval), then list(tokenId,
 * price). Each tx is awaited to receipt so the UI can show which step the
 * flow is in.
 */
export type MarketStep =
  | 'idle'
  | 'approve'
  | 'approve-wait'
  | 'list'
  | 'list-wait'
  | 'buy'
  | 'buy-wait'
  | 'cancel'
  | 'cancel-wait'

export function useMarketActions() {
  const { addresses } = useContracts()
  const { address: account } = useAccount()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<MarketStep>('idle')

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['market'] })
    void queryClient.invalidateQueries({ queryKey: ['closet'] })
    void queryClient.invalidateQueries({ queryKey: ['approval'] })
  }

  const requireSetup = () => {
    const weaponSkin = addresses.weaponSkin
    const market = addresses.skinMarket
    if (!client || !account || !weaponSkin || !market) {
      throw new Error('Wallet not connected or market contracts not configured.')
    }
    return { client: client as PublicClient, account, weaponSkin, market }
  }

  const list = useMutation({
    mutationFn: async ({ tokenId, priceWei }: { tokenId: string; priceWei: bigint }) => {
      const { client, account, weaponSkin, market } = requireSetup()

      const approved = (await client.readContract({
        address: weaponSkin,
        abi: weaponSkinAbi,
        functionName: 'isApprovedForAll',
        args: [account, market],
      })) as boolean

      if (!approved) {
        setStep('approve')
        const approveHash = await writeContractAsync({
          address: weaponSkin,
          abi: weaponSkinAbi,
          functionName: 'setApprovalForAll',
          args: [market, true],
          chainId: activeChain.id,
        })
        setStep('approve-wait')
        await client.waitForTransactionReceipt({ hash: approveHash })
      }

      setStep('list')
      const hash = await writeContractAsync({
        address: market,
        abi: skinMarketAbi,
        functionName: 'list',
        args: [BigInt(tokenId), priceWei],
        chainId: activeChain.id,
      })
      setStep('list-wait')
      await client.waitForTransactionReceipt({ hash })
      return hash
    },
    onSettled: () => {
      setStep('idle')
      invalidate()
    },
  })

  const buy = useMutation({
    mutationFn: async ({ tokenId, priceWei }: { tokenId: string; priceWei: bigint }) => {
      const { client, market } = requireSetup()
      setStep('buy')
      const hash = await writeContractAsync({
        address: market,
        abi: skinMarketAbi,
        functionName: 'buy',
        args: [BigInt(tokenId)],
        value: priceWei,
        chainId: activeChain.id,
      })
      setStep('buy-wait')
      await client.waitForTransactionReceipt({ hash })
      return hash
    },
    onSettled: () => {
      setStep('idle')
      invalidate()
    },
  })

  const cancel = useMutation({
    mutationFn: async ({ tokenId }: { tokenId: string }) => {
      const { client, market } = requireSetup()
      setStep('cancel')
      const hash = await writeContractAsync({
        address: market,
        abi: skinMarketAbi,
        functionName: 'cancel',
        args: [BigInt(tokenId)],
        chainId: activeChain.id,
      })
      setStep('cancel-wait')
      await client.waitForTransactionReceipt({ hash })
      return hash
    },
    onSettled: () => {
      setStep('idle')
      invalidate()
    },
  })

  return { step, list, buy, cancel }
}
