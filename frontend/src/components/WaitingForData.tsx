import { usePageTitle } from '../lib/usePageTitle'

// Shown on a fresh database: the backend answers, but no meter has sent a reading yet.
export function WaitingForData() {
  usePageTitle('Waiting for data')

  return (
    <div className="max-w-md py-20">
      <p className="flex items-center gap-2 text-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-edge motion-safe:animate-breathe" />
        Waiting
      </p>
      <h1 className="mt-3 text-title font-semibold tracking-tight">No readings yet</h1>
      <p className="mt-2 text-muted">The server is up, but no meter has sent data. This page fills in by itself when one does.</p>
    </div>
  )
}
