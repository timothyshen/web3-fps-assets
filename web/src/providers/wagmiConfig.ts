import { createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { activeChain, transport } from '../config/chain'

/**
 * Plain wagmi config (used when Privy is NOT enabled).
 *
 * `injected()` covers browser-extension wallets; wagmi v2 additionally
 * discovers EIP-6963 providers (MetaMask, Rabby, ...) automatically, so
 * multiple installed wallets each show up as their own connector.
 */
export const wagmiConfig = createConfig({
  chains: [activeChain],
  transports: { [activeChain.id]: transport },
  connectors: [injected()],
})
