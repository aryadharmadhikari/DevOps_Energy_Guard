import { useEffect, useState } from 'react'
import type { StreamStatus } from '../lib/useLiveStream'
import { useNow } from '../lib/useNow'

/**
 * "● Live": a solid green dot that sends out a soft ring while readings arrive. When the stream
 * is down it turns red and says how old the last value is.
 */
export function LiveStamp({ status, at }: { status: StreamStatus; at?: string }) {
  const now = useNow(1000)
  const live = status === 'live'
  const seconds = at ? Math.max(0, Math.round((now - Date.parse(at)) / 1000)) : null
  const age = seconds === null ? '' : seconds < 60 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`
  const dot = live ? 'bg-live' : status === 'connecting' ? 'bg-edge' : 'bg-alert'
  return (
    <span className="inline-flex items-center gap-2 font-medium" title={at ? `Last reading ${age}` : undefined}>
      <span aria-hidden="true" className="relative flex size-2.5">
        {live && <span className="absolute inset-0 rounded-full bg-live motion-safe:animate-halo" />}
        <span className={`relative size-2.5 rounded-full ${dot}`} />
      </span>
      <span className={live ? 'text-ink' : 'text-muted'}>
        {live ? 'Live' : status === 'connecting' ? 'Connecting' : `Not live${age ? ` · last reading ${age}` : ''}`}
      </span>
    </span>
  )
}

const GRACE_MS = 3000

/**
 * One line under the header, only while live data has a problem. A short blip
 * (a reconnect that succeeds within a few seconds) shows nothing.
 */
export function ConnectionNotice({ status }: { status: StreamStatus }) {
  const problem = status === 'stale' || status === 'reconnecting'
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!problem) return
    const timer = setTimeout(() => setShown(true), GRACE_MS)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [problem])

  if (!problem || !shown) return null
  return (
    <div role="status" className="bg-alert-wash motion-safe:animate-appear">
      <p className="mx-auto max-w-page px-5 py-2 text-small text-alert sm:px-8">
        {status === 'stale' ? 'No new readings for a while. These are the last values received.' : 'Live updates paused. Reconnecting…'}
      </p>
    </div>
  )
}
