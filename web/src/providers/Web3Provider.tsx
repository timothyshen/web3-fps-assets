import { lazy, Suspense, type ReactNode } from 'react'
import { BootScreen } from '../components/BootScreen'
import { env } from '../config/env'
import { PlainProviders } from './PlainProviders'

// Lazy so the (large) Privy bundle is only fetched when actually enabled.
const PrivyProviders = lazy(() => import('./PrivyProviders'))

/**
 * Wallet/provider entry point.
 * - VITE_PRIVY_APP_ID set   -> Privy (email/social embedded wallets + injected)
 * - VITE_PRIVY_APP_ID unset -> plain wagmi with injected connectors only
 * The app builds and runs in both configurations.
 */
export function Web3Provider({ children }: { children: ReactNode }) {
  if (env.privyAppId) {
    return (
      <Suspense fallback={<BootScreen label="Loading wallet provider" />}>
        <PrivyProviders appId={env.privyAppId}>{children}</PrivyProviders>
      </Suspense>
    )
  }
  return <PlainProviders>{children}</PlainProviders>
}
