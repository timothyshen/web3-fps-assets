import type { ReactNode } from 'react'

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success'
  title?: string
  children: ReactNode
}) {
  return (
    <div className={`notice notice-${tone}`}>
      {title && <div className="notice-title">{title}</div>}
      <div className="notice-body">{children}</div>
    </div>
  )
}

/** Standard panel for "contract addresses missing" states. */
export function ConfigMissing({ needed }: { needed: string[] }) {
  return (
    <Notice tone="warn" title="Contract addresses not configured">
      <p>This page needs deployed contract addresses for: {needed.join(', ')}.</p>
      <p>
        Set the corresponding <span className="mono">VITE_ADDR_*</span> variables in{' '}
        <span className="mono">web/.env</span>, or drop a{' '}
        <span className="mono">public/deployments.json</span> (see{' '}
        <span className="mono">public/deployments.example.json</span>). Deploy with{' '}
        <span className="mono">forge script script/Deploy.s.sol</span> — see web/README.md.
      </p>
    </Notice>
  )
}
