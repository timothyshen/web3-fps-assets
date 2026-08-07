import { createContext, useContext } from 'react'

/**
 * Abstracts "how does the user log in / out" so shared components never
 * import Privy directly (its chunk must stay lazily loaded and optional).
 */
export type WalletUi =
  | { mode: 'plain' }
  | { mode: 'privy'; ready: boolean; login: () => void; logout: () => void | Promise<void> }

const WalletUiContext = createContext<WalletUi>({ mode: 'plain' })

export const WalletUiProvider = WalletUiContext.Provider

export function useWalletUi(): WalletUi {
  return useContext(WalletUiContext)
}
