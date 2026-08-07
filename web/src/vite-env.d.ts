/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN?: string
  readonly VITE_RPC_URL?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_MOCK_API?: string
  readonly VITE_PRIVY_APP_ID?: string
  readonly VITE_MULTICALL3_ADDRESS?: string
  readonly VITE_ADDR_GAME_ASSET_REGISTRY?: string
  readonly VITE_ADDR_WEAPON_SKIN?: string
  readonly VITE_ADDR_REWARD_DISTRIBUTOR?: string
  readonly VITE_ADDR_SKIN_MARKET?: string
  readonly VITE_ADDR_MATCH_ATTESTATION?: string
  readonly VITE_ADDR_TOURNAMENT_ESCROW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
