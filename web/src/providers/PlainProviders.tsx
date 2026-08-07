import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { queryClient } from './queryClient'
import { wagmiConfig } from './wagmiConfig'

/** Injected-wallet-only provider stack (no Privy App ID configured). */
export function PlainProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
