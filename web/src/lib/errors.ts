import { BaseError } from 'viem'
import { ApiError } from '../api/http'

/** One human-readable line for any error the app can produce. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof BaseError) return error.shortMessage
  if (error instanceof Error) return error.message
  return String(error)
}
