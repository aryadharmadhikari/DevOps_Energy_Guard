import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Alert, AnomalyResult, Reading } from './contract'
import { keys, refreshSnapshots, upsertAlert } from './queries'
import { toastStore } from './toast'

export type StreamStatus = 'waiting' | 'connecting' | 'live' | 'stale' | 'reconnecting'

const FIRST_RETRY_MS = 2000
const MAX_RETRY_MS = 30_000
// Readings come every SIM_INTERVAL_SECONDS (5 s). Six missed in a row means something is wrong.
const STALE_MS = 30_000

/**
 * Listens to GET /stream for one meter (contract section 5).
 * - "reading" events replace the latest reading.
 * - "alert" events (new, merged, acknowledged) replace that alert in every list.
 * Pass enabled=false until the meter exists; the backend answers 404 before that.
 */
export function useLiveStream(meterId: string, enabled: boolean): StreamStatus {
  const qc = useQueryClient()
  // Status is remembered per meter, so switching meters shows "Connecting…" again.
  const [state, setState] = useState<{ meterId: string; status: StreamStatus }>({ meterId, status: 'connecting' })

  useEffect(() => {
    if (!enabled) return
    let source: EventSource | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let delay = FIRST_RETRY_MS
    let connectedBefore = false
    let lastReadingAt = Date.now()
    let stale = false
    const show = (status: StreamStatus) =>
      setState((prev) => (prev.meterId === meterId && prev.status === status ? prev : { meterId, status }))

    const connect = () => {
      source = new EventSource(api.streamUrl(meterId))

      source.onopen = () => {
        show(stale ? 'stale' : 'live')
        lastReadingAt = Date.now()
        delay = FIRST_RETRY_MS
        if (connectedBefore) refreshSnapshots(qc, meterId)
        connectedBefore = true
      }

      source.onerror = () => {
        show('reconnecting')
        // The browser retries dropped connections itself, but stops for good after an
        // HTTP error (nginx sends 502 while the backend restarts). Those are retried here.
        if (source?.readyState === EventSource.CLOSED) {
          retry = setTimeout(connect, delay)
          delay = Math.min(delay * 2, MAX_RETRY_MS)
        }
      }

      source.addEventListener('reading', (e) => {
        const { reading } = JSON.parse((e as MessageEvent).data) as { reading: Reading; anomaly: AnomalyResult }
        qc.setQueryData(keys.latest(meterId), reading)
        lastReadingAt = Date.now()
        stale = false
        show('live')
      })

      source.addEventListener('alert', (e) => {
        const alert = JSON.parse((e as MessageEvent).data) as Alert
        // A brand-new problem gets a pop-up; updates to known alerts just change in place.
        if (alert.status === 'open' && alert.occurrence_count === 1) toastStore.push(alert)
        upsertAlert(qc, alert)
      })
    }

    // A dead connection can look open (a proxy keeps it up, a laptop wakes from sleep), and
    // the backend's heartbeats are comments that EventSource never shows to the page.
    // So missing readings are the signal: say so, and open a fresh connection.
    const watchdog = setInterval(() => {
      if (source?.readyState !== EventSource.OPEN || Date.now() - lastReadingAt < STALE_MS) return
      stale = true
      show('stale')
      source.close()
      connect()
    }, 5000)

    connect()
    return () => {
      clearInterval(watchdog)
      clearTimeout(retry)
      source?.close()
    }
  }, [meterId, enabled, qc])

  if (!enabled) return 'waiting'
  return state.meterId === meterId ? state.status : 'connecting'
}
