/**
 * Typed contract-address configuration.
 *
 * Precedence: public/deployments.json (runtime, optional) OVERRIDES
 * VITE_ADDR_* env vars (build time). Either way the addresses are swappable
 * without code changes. Naming follows api/openapi.yaml ChainConfig.contracts.
 */
import { getAddress, isAddress, type Address } from 'viem'
import { env } from './env'

export const CONTRACT_NAMES = [
  'gameAssetRegistry',
  'weaponSkin',
  'rewardDistributor',
  'skinMarket',
  'matchAttestation',
  'tournamentEscrow',
] as const

export type ContractName = (typeof CONTRACT_NAMES)[number]

export type ContractAddresses = Partial<Record<ContractName, Address>>

export type AddressSource = 'env' | 'deployments.json'

export type DeploymentsStatus =
  | 'not-found' // no public/deployments.json — env vars only (normal)
  | 'applied' // file loaded and merged over env vars
  | 'chain-mismatch' // file declares a different chainId — ignored
  | 'invalid' // file exists but is not valid JSON — ignored

export interface ResolvedContracts {
  addresses: ContractAddresses
  sources: Partial<Record<ContractName, AddressSource>>
  deploymentsStatus: DeploymentsStatus
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Returns a checksummed address, or undefined for empty/zero/invalid values. */
export function normalizeAddress(value: unknown): Address | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (!v || !isAddress(v)) return undefined
  const checksummed = getAddress(v)
  return checksummed === ZERO_ADDRESS ? undefined : checksummed
}

function fromEnv(): Pick<ResolvedContracts, 'addresses' | 'sources'> {
  const addresses: ContractAddresses = {}
  const sources: ResolvedContracts['sources'] = {}
  for (const name of CONTRACT_NAMES) {
    const parsed = normalizeAddress(env.rawAddresses[name])
    if (parsed) {
      addresses[name] = parsed
      sources[name] = 'env'
    }
  }
  return { addresses, sources }
}

interface DeploymentsFile {
  chainId?: unknown
  contracts?: Record<string, unknown>
}

/**
 * Loads /deployments.json (if present) and merges it over the env addresses.
 * A file with a chainId that differs from the active chain is ignored, so a
 * stale testnet file cannot poison a local anvil run (or vice versa).
 */
export async function resolveContracts(expectedChainId: number): Promise<ResolvedContracts> {
  const base = fromEnv()

  let file: DeploymentsFile | undefined
  try {
    const res = await fetch('/deployments.json', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      return { ...base, deploymentsStatus: 'not-found' }
    }
    file = (await res.json()) as DeploymentsFile
  } catch {
    // Network error or non-JSON body (e.g. an SPA fallback page).
    return { ...base, deploymentsStatus: file === undefined ? 'not-found' : 'invalid' }
  }

  if (typeof file !== 'object' || file === null) {
    return { ...base, deploymentsStatus: 'invalid' }
  }

  if (file.chainId != null && Number(file.chainId) !== expectedChainId) {
    console.warn(
      `[contracts] deployments.json declares chainId ${String(file.chainId)}, ` +
        `active chain is ${expectedChainId} — file ignored.`,
    )
    return { ...base, deploymentsStatus: 'chain-mismatch' }
  }

  const addresses = { ...base.addresses }
  const sources = { ...base.sources }
  const contracts = file.contracts ?? {}
  for (const name of CONTRACT_NAMES) {
    const parsed = normalizeAddress(contracts[name])
    if (parsed) {
      addresses[name] = parsed
      sources[name] = 'deployments.json'
    }
  }
  return { addresses, sources, deploymentsStatus: 'applied' }
}
