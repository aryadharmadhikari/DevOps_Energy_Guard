import { useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { ALERT_TITLE, alertDetail } from '../lib/alertText'
import { useMeters } from '../lib/queries'
import { toastStore } from '../lib/toast'

// Pop-ups for new alerts, bottom right. They leave on their own after 10 seconds.
export function Toaster() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot)
  const { data: meters } = useMeters()

  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(21rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map(({ id, alert }) => {
        const meter = meters?.find((m) => m.meter_id === alert.meter_id)?.name ?? alert.meter_id
        return (
          <div
            key={id}
            role="alert"
            className="pointer-events-auto flex gap-3 bg-ink p-4 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)] motion-safe:animate-appear"
          >
            <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-alert" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {ALERT_TITLE[alert.anomaly_type]} <span className="text-white/60">· {meter}</span>
              </p>
              <p className="mt-0.5 text-white/60">{alertDetail(alert)}</p>
              <Link
                to="/alerts"
                onClick={() => toastStore.dismiss(id)}
                className="mt-2 inline-block font-medium underline decoration-white/40 underline-offset-4 hover:decoration-white"
              >
                Review
              </Link>
            </div>
            <button
              type="button"
              onClick={() => toastStore.dismiss(id)}
              aria-label="Dismiss"
              className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center text-white/60 hover:text-white"
            >
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
