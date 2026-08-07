import { request } from './http'
import type { BindApi, BindChallenge, BindCompleteRequest, BindCompleteResult } from './types'

/**
 * Real HTTP implementation of the ASSUMED web-facing bind endpoints
 * (see web/README.md "Assumed backend contract" — to align with the backend).
 */
export const httpBindApi: BindApi = {
  getBindChallenge(sessionId: string): Promise<BindChallenge> {
    return request<BindChallenge>(`/v1/wallet/bind/${encodeURIComponent(sessionId)}/challenge`)
  },

  completeBind(sessionId: string, body: BindCompleteRequest): Promise<BindCompleteResult> {
    return request<BindCompleteResult>(
      `/v1/wallet/bind/${encodeURIComponent(sessionId)}/complete`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  },
}
