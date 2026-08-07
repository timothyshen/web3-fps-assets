import { NavLink, Outlet } from 'react-router-dom'
import { useAccount, useBalance, useDisconnect } from 'wagmi'
import { activeChain } from '../config/chain'
import { env } from '../config/env'
import { formatNative, shortAddress } from '../lib/format'
import { useWalletUi } from '../providers/WalletUiContext'
import { NetworkBanner } from './NetworkBanner'

function AccountChip() {
  const ui = useWalletUi()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  })

  if (!isConnected || !address) return null

  const handleDisconnect = () => {
    disconnect()
    if (ui.mode === 'privy') void ui.logout()
  }

  return (
    <div className="account-chip">
      {balance && (
        <span className="balance mono" title={`${balance.value.toString()} wei`}>
          {formatNative(balance.value, balance.symbol)}
        </span>
      )}
      <span className="addr mono" title={address}>
        {shortAddress(address)}
      </span>
      <button className="btn btn-small" onClick={handleDisconnect}>
        Exit
      </button>
    </div>
  )
}

export function Layout() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            ASH LEDGER
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>
              Console
            </NavLink>
            <NavLink to="/closet">Closet</NavLink>
            <NavLink to="/market">Market</NavLink>
            <NavLink to="/tournaments">Tournaments</NavLink>
          </nav>
          <div className="header-right">
            {env.mockApi && (
              <span className="tag tag-mock" title="Bind API is faked in-browser (VITE_MOCK_API=1)">
                MOCK API
              </span>
            )}
            <span className="tag tag-net" title={`chainId ${activeChain.id}`}>
              {activeChain.name}
              {activeChain.testnet ? ' · TESTNET' : ''}
            </span>
            <AccountChip />
          </div>
        </div>
      </header>
      <NetworkBanner />
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>
          ash ledger · skin-NFT layer demo · {activeChain.name} (chainId {activeChain.id})
        </span>
        {activeChain.testnet && <span>testnet build — assets carry no monetary value</span>}
      </footer>
    </div>
  )
}
