/**
 * Every VITE_ environment variable is read exactly once, here.
 * Nothing else in the app touches import.meta.env.
 */

export type ChainKey = 'monadTestnet' | 'anvil'

const rawChain = (import.meta.env.VITE_CHAIN ?? 'monadTestnet').trim()
const chainKeyKnown = rawChain === 'monadTestnet' || rawChain === 'anvil'

export const env = {
  /** Which chain the app targets. See src/config/chain.ts for the definitions. */
  chainKey: (chainKeyKnown ? rawChain : 'monadTestnet') as ChainKey,
  /** Set when VITE_CHAIN contained an unknown value (surfaced on the Home page). */
  chainKeyError: chainKeyKnown
    ? undefined
    : `Unknown VITE_CHAIN "${rawChain}" — falling back to monadTestnet`,

  /** Optional RPC override for the selected chain. */
  rpcUrl: import.meta.env.VITE_RPC_URL?.trim() || undefined,

  /** Base URL of the asset backend (web-facing bind endpoints). */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:8787').replace(
    /\/+$/,
    '',
  ),

  /** 1/true = fake the bind API in the browser; no backend required. */
  mockApi: import.meta.env.VITE_MOCK_API === '1' || import.meta.env.VITE_MOCK_API === 'true',

  /** When set, Privy embedded wallets are offered. When unset, injected only. */
  privyAppId: import.meta.env.VITE_PRIVY_APP_ID?.trim() || undefined,

  /** Optional Multicall3 address override (e.g. for an anvil fork). */
  multicall3Address: import.meta.env.VITE_MULTICALL3_ADDRESS?.trim() || undefined,

  /**
   * Optional TournamentEscrow deploy block (decimal). Bounds the eth_getLogs
   * scan for winners / cancel reason on tournament detail pages; without it
   * the scan uses fromBlock 'earliest', which some public RPCs reject.
   */
  escrowDeployBlock: (() => {
    const raw = import.meta.env.VITE_ESCROW_DEPLOY_BLOCK?.trim()
    return raw && /^[0-9]+$/.test(raw) ? raw : undefined
  })(),

  /** Raw (unvalidated) contract addresses; validated in src/config/contracts.ts. */
  rawAddresses: {
    gameAssetRegistry: import.meta.env.VITE_ADDR_GAME_ASSET_REGISTRY,
    weaponSkin: import.meta.env.VITE_ADDR_WEAPON_SKIN,
    rewardDistributor: import.meta.env.VITE_ADDR_REWARD_DISTRIBUTOR,
    skinMarket: import.meta.env.VITE_ADDR_SKIN_MARKET,
    matchAttestation: import.meta.env.VITE_ADDR_MATCH_ATTESTATION,
    tournamentEscrow: import.meta.env.VITE_ADDR_TOURNAMENT_ESCROW,
  } as Record<string, string | undefined>,
} as const
