import { useAccount, useSwitchChain } from 'wagmi'
import { activeChain } from '../config/chain'
import { errorText } from '../lib/errors'

/** Shown when the connected wallet sits on a different chain than the app targets. */
export function NetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()

  if (!isConnected || chainId === activeChain.id) return null

  return (
    <div className="banner-warn">
      <span>
        Wallet is on chain {chainId ?? '?'} — this app targets {activeChain.name} (
        {activeChain.id}).
      </span>
      <button
        className="btn btn-small"
        disabled={isPending}
        onClick={() => switchChain({ chainId: activeChain.id })}
      >
        {isPending ? 'Switching…' : `Switch to ${activeChain.name}`}
      </button>
      {error && <span className="error-text">{errorText(error)}</span>}
    </div>
  )
}
