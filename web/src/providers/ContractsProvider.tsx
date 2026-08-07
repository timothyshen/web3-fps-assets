import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { BootScreen } from '../components/BootScreen'
import { activeChain } from '../config/chain'
import { resolveContracts, type ResolvedContracts } from '../config/contracts'

const ContractsContext = createContext<ResolvedContracts | null>(null)

/**
 * Resolves contract addresses once at boot: VITE_ADDR_* env vars, optionally
 * overridden by public/deployments.json. Blocks rendering until resolved so
 * queries never run against half-merged config.
 */
export function ContractsProvider({ children }: { children: ReactNode }) {
  const [resolved, setResolved] = useState<ResolvedContracts | null>(null)

  useEffect(() => {
    let alive = true
    resolveContracts(activeChain.id).then((result) => {
      if (alive) setResolved(result)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!resolved) return <BootScreen label="Loading configuration" />
  return <ContractsContext.Provider value={resolved}>{children}</ContractsContext.Provider>
}

export function useContracts(): ResolvedContracts {
  const ctx = useContext(ContractsContext)
  if (!ctx) throw new Error('useContracts must be used inside ContractsProvider')
  return ctx
}
