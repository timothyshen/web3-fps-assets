import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAccount, useSignMessage } from 'wagmi'
import { ApiError, bindApi, type BindChallenge } from '../api'
import { ConnectPanel } from '../components/ConnectPanel'
import { Countdown } from '../components/Countdown'
import { Notice } from '../components/Notice'
import { activeChain } from '../config/chain'
import { env } from '../config/env'
import { errorText } from '../lib/errors'
import { shortAddress } from '../lib/format'
import { buildBindMessage } from '../lib/siwe'

/**
 * The page a Unity player lands on from the system browser
 * (bindUrl = {origin}/bind/{sessionId}, per api/openapi.yaml WalletBindSession).
 *
 * Flow: fetch bind challenge (nonce, expiry) -> connect wallet -> sign the
 * EIP-4361 message (personal_sign, free) -> POST {message, signature} back.
 * The game client polls GET /v1/wallet/bind/{sessionId} and picks up the result.
 */
export function BindPage() {
  const { sessionId = '' } = useParams()
  const queryClient = useQueryClient()
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [locallyExpired, setLocallyExpired] = useState(false)

  const challengeQuery = useQuery({
    queryKey: ['bind', sessionId],
    enabled: sessionId.length > 0,
    queryFn: () => bindApi.getBindChallenge(sessionId),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status && error.status < 500) return false
      return failureCount < 2
    },
  })

  const challenge = challengeQuery.data

  // Built once per (address, nonce): the preview and the signed bytes must be
  // the exact same string.
  const message = useMemo(() => {
    if (!challenge || challenge.state !== 'pending' || !address) return null
    return buildBindMessage({
      address,
      nonce: challenge.nonce,
      sessionId,
      expiresAt: challenge.expiresAt,
    })
  }, [challenge, address, sessionId])

  const complete = useMutation({
    mutationFn: async () => {
      if (!message) throw new Error('Bind message not ready.')
      const signature = await signMessageAsync({ message })
      return bindApi.completeBind(sessionId, { message, signature })
    },
    onSuccess: (result) => {
      queryClient.setQueryData<BindChallenge>(['bind', sessionId], (old) =>
        old ? { ...old, state: 'bound', wallet: result.wallet } : old,
      )
    },
  })

  // ---- terminal / error branches ------------------------------------------

  if (!sessionId) {
    return (
      <div className="page page-narrow">
        <Notice tone="error" title="No bind session">
          This page must be opened from the game with a session id: /bind/&lt;sessionId&gt;.
        </Notice>
      </div>
    )
  }

  if (challengeQuery.isPending) {
    return (
      <div className="page page-narrow">
        <div className="card center">
          <span className="spinner" /> Fetching bind session…
        </div>
      </div>
    )
  }

  if (challengeQuery.isError) {
    const error = challengeQuery.error
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <div className="page page-narrow">
        <Notice tone="error" title={notFound ? 'Unknown bind session' : 'Cannot reach the bind service'}>
          <p>{errorText(error)}</p>
          {!notFound && !env.mockApi && (
            <p className="hint">
              The asset backend is expected at <span className="mono">{env.apiBaseUrl}</span>.
              For a no-backend demo, run the app with <span className="mono">VITE_MOCK_API=1</span>.
            </p>
          )}
          <button className="btn" onClick={() => challengeQuery.refetch()}>
            Retry
          </button>
        </Notice>
      </div>
    )
  }

  if (!challenge) return null

  if (challenge.state === 'bound') {
    return (
      <div className="page page-narrow">
        <div className="card success-panel">
          <h2>Wallet bound</h2>
          <p>
            <span className="mono">{challenge.wallet ?? 'wallet'}</span> is now linked to your
            game account.
          </p>
          <p className="hint">
            You can close this tab and return to the game — it polls{' '}
            <span className="mono">GET /v1/wallet/bind/{sessionId}</span> and picks the binding up
            automatically.
          </p>
        </div>
      </div>
    )
  }

  if (challenge.state === 'expired' || locallyExpired) {
    return (
      <div className="page page-narrow">
        <Notice tone="warn" title="Bind session expired">
          Bind sessions are short-lived on purpose. Return to the game and start the binding
          again to get a fresh session.
        </Notice>
      </div>
    )
  }

  if (challenge.state === 'failed') {
    return (
      <div className="page page-narrow">
        <Notice tone="error" title="Binding failed">
          This session was marked failed by the backend. Return to the game and start again.
        </Notice>
      </div>
    )
  }

  // ---- pending: the actual flow -------------------------------------------

  const completeError = complete.error
  const alreadyBoundElsewhere =
    completeError instanceof ApiError && completeError.code === 'wallet_already_bound'

  return (
    <div className="page page-narrow">
      <h1 className="page-title">Bind wallet to game account</h1>

      <section className="card session-meta">
        <div className="kv-row">
          <span className="muted">Session</span>
          <span className="mono">{sessionId}</span>
        </div>
        <div className="kv-row">
          <span className="muted">Expires in</span>
          <Countdown until={challenge.expiresAt} onExpire={() => setLocallyExpired(true)} />
        </div>
        <div className="kv-row">
          <span className="muted">Network</span>
          <span className="mono">
            {activeChain.name} (chainId {activeChain.id})
          </span>
        </div>
      </section>

      <section className="card step">
        <h2>
          <span className="step-no">1</span> Connect the wallet to bind
        </h2>
        <ConnectPanel />
      </section>

      <section className={`card step ${!isConnected ? 'step-disabled' : ''}`}>
        <h2>
          <span className="step-no">2</span> Sign the sign-in message
        </h2>
        <p className="hint">
          A SIWE (EIP-4361) signature proves you control this address. It is free, sends no
          transaction, and authorizes no spending. The backend does not hold your keys — it only
          records the address.
        </p>
        {message && (
          <pre className="siwe-preview" aria-label="Message to be signed">
            {message}
          </pre>
        )}
        <button
          className="btn btn-primary"
          disabled={!message || complete.isPending}
          onClick={() => complete.mutate()}
        >
          {complete.isPending ? 'Waiting for signature…' : 'Sign and bind wallet'}
        </button>
        {address && (
          <p className="hint">
            Binding <span className="mono">{shortAddress(address)}</span> to the player account
            behind this session.
          </p>
        )}
        {completeError != null && (
          <p className="error-text">
            {errorText(completeError)}
            {alreadyBoundElsewhere && ' Use a different wallet, or unbind it in the game first.'}
          </p>
        )}
      </section>
    </div>
  )
}
