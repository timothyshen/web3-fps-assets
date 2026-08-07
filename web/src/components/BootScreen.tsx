export function BootScreen({ label }: { label: string }) {
  return (
    <div className="boot-screen">
      <div className="boot-brand">ASH LEDGER</div>
      <div className="boot-label">
        <span className="spinner" aria-hidden="true" /> {label}…
      </div>
    </div>
  )
}
