import { useNavigate } from 'react-router-dom'
import { AddressConfigCard } from '../components/AddressConfigCard'
import { ConnectPanel } from '../components/ConnectPanel'
import { activeChain } from '../config/chain'
import { env } from '../config/env'

const MONAD_FAUCET_URL = 'https://faucet.monad.xyz'

export function HomePage() {
  const navigate = useNavigate()
  const explorer = activeChain.blockExplorers?.default

  return (
    <div className="page">
      <section className="hero">
        <h1>
          ASH LEDGER<span className="accent">_</span>
        </h1>
        <p className="hero-line">
          Skin vault for the FPS. Ownership settles on {activeChain.name}; the game reads the
          chain, never holds your keys.
        </p>
        <p className="hero-sub">
          Skins are ERC-721 with on-chain supply caps and EIP-2981 royalties. No admin backdoors:
          the contract cannot transfer or burn what you own.
        </p>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Wallet</h2>
          <ConnectPanel />
          <p className="hint">
            Both wallet kinds are supported: browser-extension wallets out of the box, plus
            embedded wallets (email / social) when a Privy App ID is configured.
          </p>
        </section>

        <section className="card">
          <h2>Wallet binding</h2>
          <p>
            Binding starts inside the game: Unity calls{' '}
            <span className="mono">POST /v1/wallet/bind</span> and opens{' '}
            <span className="mono">{window.location.origin}/bind/&lt;sessionId&gt;</span> in the
            system browser. On that page you sign a SIWE (EIP-4361) message — no transaction, no
            gas — and the backend links the wallet to your player account.
          </p>
          {env.mockApi ? (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/bind/demo-${Date.now().toString(36)}`)}
            >
              Open a sample bind session
            </button>
          ) : (
            <p className="hint">
              Mock API is off — bind sessions must be created by the asset backend at{' '}
              <span className="mono">{env.apiBaseUrl}</span>.
            </p>
          )}
        </section>
      </div>

      <AddressConfigCard />

      <section className="card">
        <h2>Links</h2>
        <ul className="link-list">
          {explorer && (
            <li>
              <a href={explorer.url} target="_blank" rel="noreferrer">
                {explorer.name}
              </a>
              <span className="muted"> — inspect contracts, tokens and transactions</span>
            </li>
          )}
          {activeChain.id === 10143 && (
            <li>
              <a href={MONAD_FAUCET_URL} target="_blank" rel="noreferrer">
                Monad testnet faucet
              </a>
              <span className="muted"> — MON for listing and buying on the market</span>
            </li>
          )}
          <li>
            <span className="muted">
              Contracts, backend contract and docs live in the web3-fps-assets repository
              (docs/, api/openapi.yaml, contracts/).
            </span>
          </li>
        </ul>
      </section>
    </div>
  )
}
