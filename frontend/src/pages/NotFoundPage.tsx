import { Link } from 'react-router'
import { usePageTitle } from '../lib/usePageTitle'

export function NotFoundPage() {
  usePageTitle('Page not found')

  return (
    <div className="max-w-md py-12">
      <h1 className="text-title font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-muted">The link may be old or mistyped.</p>
      <Link to="/" className="mt-6 inline-block font-medium underline decoration-edge underline-offset-4 hover:decoration-ink">
        Back to now
      </Link>
    </div>
  )
}
