import { ApiError } from '../lib/api'

// "Can't reach" only when the request never got an answer; otherwise say the server failed.
export function ErrorNotice({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const unreachable = !(error instanceof ApiError) || error.status === 0 || error.status >= 502
  return (
    <p role="alert" className="border-l-2 border-alert py-1 pl-4">
      <span className="font-medium">{unreachable ? 'Can’t reach the server.' : 'The server couldn’t load this.'}</span>{' '}
      <span className="text-muted">{unreachable ? 'Retrying on its own.' : `${error.message}.`}</span>{' '}
      <button type="button" onClick={onRetry} className="font-medium underline decoration-edge underline-offset-4 hover:decoration-ink">
        Try now
      </button>
    </p>
  )
}
