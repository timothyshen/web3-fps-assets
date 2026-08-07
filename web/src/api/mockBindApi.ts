import { recoverMessageAddress } from 'viem'
import { generateSiweNonce, parseSiweMessage } from 'viem/siwe'
import { ApiError } from './http'
import type { BindApi, BindChallenge, BindCompleteRequest, BindCompleteResult, BindState } from './types'

/**
 * In-browser fake of the bind backend (VITE_MOCK_API=1) so the whole flow is
 * demoable today, before the asset backend exists.
 *
 * It is deliberately NOT a rubber stamp: completeBind parses the EIP-4361
 * message, checks nonce / requestId / expiry, and recovers the signer from
 * the real signature — the same checks the backend will run. Sessions are
 * persisted in localStorage so a refresh keeps their state.
 */

const SESSION_TTL_MS = 15 * 60 * 1000

interface MockSession {
  nonce: string
  expiresAt: string
  state: BindState
  wallet?: string
}

const keyOf = (sessionId: string) => `ashledger:mock-bind:${sessionId}`

function loadSession(sessionId: string): MockSession | null {
  try {
    const raw = localStorage.getItem(keyOf(sessionId))
    return raw ? (JSON.parse(raw) as MockSession) : null
  } catch {
    return null
  }
}

function saveSession(sessionId: string, session: MockSession): void {
  localStorage.setItem(keyOf(sessionId), JSON.stringify(session))
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const mockBindApi: BindApi = {
  async getBindChallenge(sessionId: string): Promise<BindChallenge> {
    await delay(400)
    if (!sessionId || sessionId.length < 3) {
      throw new ApiError('session_not_found', 'Unknown bind session.', 404)
    }
    let session = loadSession(sessionId)
    if (!session) {
      session = {
        nonce: generateSiweNonce(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        state: 'pending',
      }
      saveSession(sessionId, session)
    }
    if (session.state === 'pending' && Date.parse(session.expiresAt) < Date.now()) {
      session.state = 'expired'
      saveSession(sessionId, session)
    }
    return { sessionId, ...session }
  },

  async completeBind(
    sessionId: string,
    { message, signature }: BindCompleteRequest,
  ): Promise<BindCompleteResult> {
    await delay(650)
    const session = loadSession(sessionId)
    if (!session) {
      throw new ApiError('session_not_found', 'Unknown bind session.', 404)
    }
    if (session.state === 'bound') {
      throw new ApiError('already_bound', `Session already bound to ${session.wallet ?? '?'}.`, 409)
    }
    if (Date.parse(session.expiresAt) < Date.now()) {
      session.state = 'expired'
      saveSession(sessionId, session)
      throw new ApiError('session_expired', 'Bind session expired. Restart binding from the game.', 410)
    }

    const parsed = parseSiweMessage(message)
    if (!parsed.address || parsed.nonce !== session.nonce || parsed.requestId !== sessionId) {
      throw new ApiError('invalid_message', 'SIWE message does not match this bind session.', 400)
    }

    let recovered: string
    try {
      recovered = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      })
    } catch {
      throw new ApiError('invalid_signature', 'Signature could not be verified.', 400)
    }
    if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
      throw new ApiError('invalid_signature', 'Signature does not match the message address.', 400)
    }

    session.state = 'bound'
    session.wallet = parsed.address
    saveSession(sessionId, session)
    return { state: 'bound', wallet: parsed.address }
  },
}
