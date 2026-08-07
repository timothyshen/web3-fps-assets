import { activeChain, activeRpcUrl, explorerAddressUrl, hasMulticall3 } from '../config/chain'
import { CONTRACT_NAMES, type ContractName } from '../config/contracts'
import { env } from '../config/env'
import { shortAddress } from '../lib/format'
import { useContracts } from '../providers/ContractsProvider'

const LABELS: Record<ContractName, string> = {
  gameAssetRegistry: 'GameAssetRegistry',
  weaponSkin: 'WeaponSkin',
  rewardDistributor: 'RewardDistributor',
  skinMarket: 'SkinMarket',
  matchAttestation: 'MatchAttestation',
  tournamentEscrow: 'TournamentEscrow',
}

const ENV_VARS: Record<ContractName, string> = {
  gameAssetRegistry: 'VITE_ADDR_GAME_ASSET_REGISTRY',
  weaponSkin: 'VITE_ADDR_WEAPON_SKIN',
  rewardDistributor: 'VITE_ADDR_REWARD_DISTRIBUTOR',
  skinMarket: 'VITE_ADDR_SKIN_MARKET',
  matchAttestation: 'VITE_ADDR_MATCH_ATTESTATION',
  tournamentEscrow: 'VITE_ADDR_TOURNAMENT_ESCROW',
}

/** Home-page card showing the resolved runtime configuration at a glance. */
export function AddressConfigCard() {
  const { addresses, sources, deploymentsStatus } = useContracts()

  return (
    <section className="card">
      <h2>Runtime configuration</h2>
      <table className="config-table">
        <tbody>
          <tr>
            <td>Chain</td>
            <td className="mono">
              {activeChain.name} · id {activeChain.id} · {activeChain.nativeCurrency.symbol}
            </td>
          </tr>
          <tr>
            <td>RPC</td>
            <td className="mono">{activeRpcUrl}</td>
          </tr>
          <tr>
            <td>Multicall3</td>
            <td className="mono">{hasMulticall3 ? 'enabled' : 'off — per-call reads'}</td>
          </tr>
          <tr>
            <td>Asset backend</td>
            <td className="mono">
              {env.mockApi ? 'mocked in-browser (VITE_MOCK_API=1)' : env.apiBaseUrl}
            </td>
          </tr>
          <tr>
            <td>Wallets</td>
            <td className="mono">
              {env.privyAppId ? 'Privy embedded + injected' : 'injected only (no VITE_PRIVY_APP_ID)'}
            </td>
          </tr>
          {CONTRACT_NAMES.map((name) => {
            const address = addresses[name]
            const url = address ? explorerAddressUrl(address) : undefined
            return (
              <tr key={name}>
                <td>{LABELS[name]}</td>
                <td className="mono">
                  {address ? (
                    <>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" title={address}>
                          {shortAddress(address, 6)}
                        </a>
                      ) : (
                        <span title={address}>{shortAddress(address, 6)}</span>
                      )}
                      <span className="src-tag">{sources[name]}</span>
                    </>
                  ) : (
                    <span className="missing" title={`Set ${ENV_VARS[name]} or deployments.json`}>
                      not set
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="hint">
        {deploymentsStatus === 'applied' && 'public/deployments.json loaded and applied over env vars.'}
        {deploymentsStatus === 'not-found' &&
          'No public/deployments.json — using VITE_ADDR_* env vars only.'}
        {deploymentsStatus === 'chain-mismatch' &&
          'public/deployments.json ignored: it declares a different chainId.'}
        {deploymentsStatus === 'invalid' && 'public/deployments.json ignored: not valid JSON.'}
      </p>
      {env.chainKeyError && <p className="error-text">{env.chainKeyError}</p>}
    </section>
  )
}
