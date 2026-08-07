import { PrivyProvider, usePrivy } from '@privy-io/react-auth'
import { createConfig, WagmiProvider } from '@privy-io/wagmi'
import { QueryClientProvider } from '@tanstack/react-query'
import { useMemo, type ReactNode } from 'react'
import { activeChain, transport } from '../config/chain'
import { queryClient } from './queryClient'
import { WalletUiProvider, type WalletUi } from './WalletUiContext'

/**
 * Privy provider stack. This module is loaded LAZILY (React.lazy in
 * Web3Provider) and only when VITE_PRIVY_APP_ID is set — without the env var
 * the chunk is never downloaded and the app runs on plain wagmi.
 *
 * Privy's wagmi bridge keeps embedded wallets and injected wallets in the
 * same wagmi state, so every other component keeps using plain wagmi hooks.
 */
const privyWagmiConfig = createConfig({
  chains: [activeChain],
  transports: { [activeChain.id]: transport },
})

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, login, logout } = usePrivy()
  const value = useMemo<WalletUi>(
    () => ({ mode: 'privy', ready, login: () => login(), logout: () => logout() }),
    [ready, login, logout],
  )
  return <WalletUiProvider value={value}>{children}</WalletUiProvider>
}

export default function PrivyProviders({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        // docs/integration.md: offer embedded AND injected wallets at once —
        // some judges have an extension wallet, some have nothing installed.
        loginMethods: ['email', 'google', 'wallet'],
        appearance: { theme: 'dark', accentColor: '#ff6a2f' },
        defaultChain: activeChain,
        supportedChains: [activeChain],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={privyWagmiConfig}>
          <PrivyWalletBridge>{children}</PrivyWalletBridge>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
