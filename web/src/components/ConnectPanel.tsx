import { useAccount, useConnect } from 'wagmi'
import { errorText } from '../lib/errors'
import { shortAddress } from '../lib/format'
import { useWalletUi } from '../providers/WalletUiContext'

/**
 * The one place users connect from. Two modes:
 * - privy: single button opening Privy's modal (email / Google / wallet —
 *   embedded and injected wallets side by side, per docs/integration.md).
 * - plain: one button per detected injected connector (EIP-6963 discovery).
 */
export function ConnectPanel() {
  const ui = useWalletUi()
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()

  if (isConnected && address) {
    return (
      <div className="connect-panel">
        <div className="connect-done">
          <span className="dot dot-ok" /> Connected as <span className="mono">{shortAddress(address)}</span>
        </div>
      </div>
    )
  }

  if (ui.mode === 'privy') {
    return (
      <div className="connect-panel">
        <button className="btn btn-primary" disabled={!ui.ready} onClick={() => ui.login()}>
          {ui.ready ? 'Sign in — email, Google or wallet' : 'Preparing sign-in…'}
        </button>
        <p className="hint">
          Embedded wallets by Privy: no extension or seed phrase needed. Extension wallets work
          from the same dialog.
        </p>
      </div>
    )
  }

  // Plain mode: prefer EIP-6963-discovered wallets; fall back to the generic
  // injected connector when nothing was discovered.
  const discovered = connectors.filter((c) => c.id !== 'injected')
  const shown = discovered.length > 0 ? discovered : connectors

  return (
    <div className="connect-panel">
      {shown.map((connector) => (
        <button
          key={connector.uid}
          className="btn btn-primary"
          disabled={isPending}
          onClick={() => connect({ connector })}
        >
          Connect {connector.id === 'injected' ? 'browser wallet' : connector.name}
        </button>
      ))}
      {shown.length === 0 && (
        <p className="hint">
          No browser wallet detected. Install one (e.g. MetaMask), or configure
          VITE_PRIVY_APP_ID to enable email sign-in with an embedded wallet.
        </p>
      )}
      {error && <p className="error-text">{errorText(error)}</p>}
    </div>
  )
}
