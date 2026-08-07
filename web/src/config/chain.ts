/**
 * The SINGLE source of chain truth for the whole app.
 *
 * docs/integration.md: "链配置自己定义一次、前后端共用，别在多处硬编码 chainId".
 * No other module may hardcode a chainId, RPC URL, currency symbol or
 * explorer URL — import from here instead.
 */
import { defineChain, http, isAddress, getAddress, type Chain } from 'viem'
import { env } from './env'

const MONAD_TESTNET_RPC = 'https://testnet-rpc.monad.xyz'
const ANVIL_RPC = 'http://127.0.0.1:8545'

/** Canonical Multicall3, deployed on Monad testnet (per Monad docs). */
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

export const monadTestnet: Chain = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET_RPC] } },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
})

export const anvil: Chain = defineChain({
  id: 31337,
  name: 'Anvil (local)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
  // No multicall3 by default: a plain anvil node does not have it. Reads fall
  // back to individual eth_call. Set VITE_MULTICALL3_ADDRESS on a fork.
  testnet: true,
})

function customize(chain: Chain): Chain {
  let c = chain
  if (env.rpcUrl) {
    c = { ...c, rpcUrls: { ...c.rpcUrls, default: { http: [env.rpcUrl] } } }
  }
  if (env.multicall3Address && isAddress(env.multicall3Address)) {
    c = {
      ...c,
      contracts: { ...c.contracts, multicall3: { address: getAddress(env.multicall3Address) } },
    }
  }
  return c
}

/** The one chain this build of the app talks to. */
export const activeChain: Chain = customize(env.chainKey === 'anvil' ? anvil : monadTestnet)

export const activeRpcUrl: string = activeChain.rpcUrls.default.http[0] ?? ''

/** viem transport for the active chain. */
export const transport = http(activeRpcUrl)

export const nativeSymbol: string = activeChain.nativeCurrency.symbol

export const hasMulticall3: boolean = Boolean(activeChain.contracts?.multicall3)

const explorerBase = activeChain.blockExplorers?.default?.url

export function explorerAddressUrl(address: string): string | undefined {
  return explorerBase ? `${explorerBase}/address/${address}` : undefined
}

export function explorerTxUrl(hash: string): string | undefined {
  return explorerBase ? `${explorerBase}/tx/${hash}` : undefined
}

export function explorerTokenUrl(contract: string, tokenId: string): string | undefined {
  return explorerBase ? `${explorerBase}/nft/${contract}/${tokenId}` : undefined
}
