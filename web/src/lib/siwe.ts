import { getAddress, type Address } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { activeChain } from '../config/chain'

/**
 * Builds the EIP-4361 (SIWE) message the player signs to bind their wallet
 * to their game account.
 *
 * viem's `createSiweMessage` is used instead of the `siwe` npm package: it is
 * spec-exact, already a dependency, and avoids `siwe`'s ethers peer
 * dependency. The backend can verify with viem's `verifySiweMessage` or the
 * `siwe` package — the wire format is identical.
 *
 * Field mapping (must stay aligned with the backend verifier):
 * - domain / uri ......... the bind page origin (backend pins the expected one)
 * - chainId .............. the active chain from src/config/chain.ts
 * - nonce ................ issued by the backend per bind session
 *                          (EIP-4361: >= 8 alphanumeric characters)
 * - requestId ............ the bind sessionId (also echoed in the statement)
 * - expirationTime ....... the session expiry issued by the backend
 */
export interface BindMessageInput {
  address: Address
  nonce: string
  sessionId: string
  /** ISO 8601 timestamp from the bind challenge. */
  expiresAt: string
}

export function buildBindMessage({ address, nonce, sessionId, expiresAt }: BindMessageInput): string {
  return createSiweMessage({
    domain: window.location.host,
    uri: window.location.origin,
    address: getAddress(address),
    chainId: activeChain.id,
    version: '1',
    nonce,
    statement:
      `Link this wallet to your game account (bind session ${sessionId}). ` +
      'Signing is free and authorizes no transaction or spending.',
    issuedAt: new Date(),
    expirationTime: new Date(expiresAt),
    requestId: sessionId,
  })
}
