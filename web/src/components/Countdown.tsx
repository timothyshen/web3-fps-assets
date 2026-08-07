import { useEffect, useRef, useState } from 'react'

/** mm:ss countdown to an ISO timestamp; fires onExpire once when it hits zero. */
export function Countdown({ until, onExpire }: { until: string; onExpire?: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const firedRef = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const msLeft = Date.parse(until) - now
  const expired = msLeft <= 0

  useEffect(() => {
    if (expired && !firedRef.current) {
      firedRef.current = true
      onExpire?.()
    }
  }, [expired, onExpire])

  if (expired) return <span className="countdown countdown-expired">expired</span>

  const totalSeconds = Math.floor(msLeft / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return (
    <span className="countdown mono">
      {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  )
}
