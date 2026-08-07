/**
 * Web-facing bind API types.
 *
 * ASSUMED CONTRACT — the asset backend does not exist yet. The two endpoints
 * below extend the Unity-facing flow in api/openapi.yaml (POST /v1/wallet/bind
 * + GET /v1/wallet/bind/{sessionId}) with what the browser page needs.
 * Documented in web/README.md ("Assumed backend contract") — to align with
 * the backend before it is built.
 */

/** Mirrors WalletBindStatus.state in api/openapi.yaml. */
export type BindState = 'pending' | 'bound' | 'expired' | 'failed'

/** GET /v1/wallet/bind/{sessionId}/challenge */
export interface BindChallenge {
  sessionId: string
  /** SIWE nonce for this session (EIP-4361: >= 8 alphanumeric chars). */
  nonce: string
  /** ISO 8601 expiry of the bind session. */
  expiresAt: string
  state: BindState
  /** Present when state is "bound". */
  wallet?: string
}

/** POST /v1/wallet/bind/{sessionId}/complete request body. */
export interface BindCompleteRequest {
  /** The exact EIP-4361 message string that was signed. */
  message: string
  /** personal_sign signature (0x-prefixed, 65 bytes hex). */
  signature: string
}

/** POST /v1/wallet/bind/{sessionId}/complete success response. */
export interface BindCompleteResult {
  state: 'bound'
  wallet: string
}

export interface BindApi {
  getBindChallenge(sessionId: string): Promise<BindChallenge>
  completeBind(sessionId: string, body: BindCompleteRequest): Promise<BindCompleteResult>
}
