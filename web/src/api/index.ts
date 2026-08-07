import { env } from '../config/env'
import { httpBindApi } from './bindApi'
import { mockBindApi } from './mockBindApi'
import type { BindApi } from './types'

/** The bind API the app talks to — mock in VITE_MOCK_API=1, HTTP otherwise. */
export const bindApi: BindApi = env.mockApi ? mockBindApi : httpBindApi

export { ApiError } from './http'
export type { BindChallenge, BindCompleteRequest, BindCompleteResult, BindState } from './types'
