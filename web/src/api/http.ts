import { env } from '../config/env'

/**
 * Error shape follows api/openapi.yaml `Error` ({ code, message }): the
 * backend returns a machine-readable code plus a human message.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(
      'network_unreachable',
      `Asset backend unreachable at ${env.apiBaseUrl}. Start the backend or set VITE_MOCK_API=1 to demo without one.`,
    )
  }

  if (!res.ok) {
    let code = `http_${res.status}`
    let message = res.statusText || `Request failed with status ${res.status}`
    try {
      const body = (await res.json()) as { code?: string; message?: string }
      if (body.code) code = body.code
      if (body.message) message = body.message
    } catch {
      // non-JSON error body — keep the status-derived code/message
    }
    throw new ApiError(code, message, res.status)
  }

  return (await res.json()) as T
}
