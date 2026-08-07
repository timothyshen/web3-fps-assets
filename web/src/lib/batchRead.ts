import type { ContractFunctionParameters, PublicClient } from 'viem'

/**
 * Batched contract reads.
 *
 * Uses Multicall3 (one eth_call) when the active chain defines it — Monad
 * testnet has the canonical deployment configured in src/config/chain.ts.
 * Falls back to parallel individual eth_call requests otherwise (plain
 * anvil), so the same code runs on both targets.
 *
 * allowFailure is false on purpose: every call the app batches is expected
 * to succeed (mapping reads never revert; skinData/getSkin only revert on
 * misconfigured addresses, which should surface loudly, not silently).
 */
export async function batchRead<T>(
  client: PublicClient,
  calls: readonly ContractFunctionParameters[],
): Promise<T[]> {
  if (calls.length === 0) return []
  if (client.chain?.contracts?.multicall3) {
    const results = await client.multicall({
      contracts: [...calls],
      allowFailure: false,
    })
    return results as T[]
  }
  const results = await Promise.all(calls.map((call) => client.readContract(call)))
  return results as T[]
}
