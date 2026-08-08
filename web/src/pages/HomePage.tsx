import { Link } from 'react-router-dom'
import { activeChain, explorerAddressUrl } from '../config/chain'
import { CONTRACT_NAMES, type ContractName } from '../config/contracts'
import { useContracts } from '../providers/ContractsProvider'

const MONAD_FAUCET_URL = 'https://faucet.monad.xyz'

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'True ownership',
    body: 'Skins are ERC-721 tokens in your wallet. The contract can mint and price, but it cannot transfer or burn what you own — no admin key stands between you and your inventory.',
  },
  {
    title: 'Capped, verifiable supply',
    body: 'Every skin line carries a supply cap enforced on-chain. Rarity is something you can audit on the explorer, not a promise in a patch note.',
  },
  {
    title: 'Gasless wallet binding',
    body: 'Link your game account from inside the client with one SIWE signature — no transaction, no gas. The game reads the chain; it never holds your keys.',
  },
  {
    title: 'Escrowed tournaments',
    body: 'Entry fees lock into a prize escrow the organizer cannot touch. Match results are attested on-chain, then payouts settle automatically by placement.',
  },
]

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Bind',
    body: 'One signature links a wallet to your player account. No gas, no seed phrases stored by the game.',
  },
  {
    title: 'Earn & collect',
    body: `Reward skins mint straight to your wallet on ${activeChain.name} — supply-capped, royalty-carrying, tradeable.`,
  },
  {
    title: 'Trade & compete',
    body: 'List on the open market, or put MON where your aim is: tournaments with escrowed, auto-settled prize pools.',
  },
]

const CONTRACT_LABELS: Record<ContractName, string> = {
  gameAssetRegistry: 'GameAssetRegistry',
  weaponSkin: 'WeaponSkin',
  rewardDistributor: 'RewardDistributor',
  skinMarket: 'SkinMarket',
  matchAttestation: 'MatchAttestation',
  tournamentEscrow: 'TournamentEscrow',
}

export function HomePage() {
  const { addresses } = useContracts()
  const explorer = activeChain.blockExplorers?.default
  const deployed = CONTRACT_NAMES.filter((name) => addresses[name])

  return (
    <div className="page mkt">
      <section className="mkt-hero">
        <p className="mkt-eyebrow">
          {activeChain.name}
          {activeChain.testnet ? ' · demo build' : ''}
        </p>
        <h1 className="mkt-title">
          ASH LEDGER<span className="accent mkt-caret">_</span>
        </h1>
        <p className="mkt-lede">
          The armory layer for competitive FPS. Every skin you earn is minted to your wallet,
          supply-capped and royalty-carrying — settled on {activeChain.name}, readable by the
          game, held by no one but you.
        </p>
        <div className="mkt-cta-row">
          <Link to="/closet" className="btn btn-primary mkt-btn-lg">
            Open your closet
          </Link>
          <Link to="/market" className="btn mkt-btn-lg">
            Browse the market
          </Link>
        </div>
      </section>

      <section className="mkt-stats">
        <div>
          <span className="mkt-stat-k">Chain</span>
          <span className="mkt-stat-v mono">
            {activeChain.name} · {activeChain.id}
          </span>
        </div>
        <div>
          <span className="mkt-stat-k">Token standard</span>
          <span className="mkt-stat-v mono">ERC-721</span>
        </div>
        <div>
          <span className="mkt-stat-k">Royalties</span>
          <span className="mkt-stat-v mono">EIP-2981 on-chain</span>
        </div>
        <div>
          <span className="mkt-stat-k">Prize pools</span>
          <span className="mkt-stat-v mono">Non-custodial escrow</span>
        </div>
      </section>

      <section className="mkt-grid">
        {FEATURES.map((f) => (
          <article key={f.title} className="card mkt-feature">
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </section>

      <section className="mkt-steps">
        {STEPS.map((s, i) => (
          <div key={s.title} className="card mkt-step">
            <span className="step-no">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="card mkt-onchain">
        <h2>Deployed &amp; inspectable</h2>
        <p className="muted">
          Every claim above is a contract call away. The full deployment lives on{' '}
          {activeChain.name} — read the source, the caps and the escrow balances yourself.
        </p>
        <div className="mkt-contracts">
          {deployed.map((name) => {
            const addr = addresses[name]
            const url = addr ? explorerAddressUrl(addr) : undefined
            return url ? (
              <a key={name} href={url} target="_blank" rel="noreferrer" className="tag mkt-contract">
                {CONTRACT_LABELS[name]}
              </a>
            ) : (
              <span key={name} className="tag mkt-contract">
                {CONTRACT_LABELS[name]}
              </span>
            )
          })}
        </div>
        <div className="mkt-cta-row">
          {explorer && (
            <a className="btn btn-small" href={explorer.url} target="_blank" rel="noreferrer">
              {explorer.name}
            </a>
          )}
          {activeChain.id === 10143 && (
            <a className="btn btn-small" href={MONAD_FAUCET_URL} target="_blank" rel="noreferrer">
              Get testnet MON
            </a>
          )}
          <Link className="btn btn-small" to="/tournaments">
            Upcoming tournaments
          </Link>
        </div>
      </section>

      <section className="mkt-band">
        <div>
          <p className="mkt-band-title">The range is open.</p>
          <p className="muted">
            Connect a wallet and claim your first loadout
            {activeChain.testnet ? ' — testnet assets carry no monetary value' : ''}.
          </p>
        </div>
        <div className="mkt-cta-row">
          <Link to="/closet" className="btn btn-primary mkt-btn-lg">
            Enter the closet
          </Link>
        </div>
      </section>
    </div>
  )
}
