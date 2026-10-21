import { ALERT_TITLE, isOngoing, lastedText, noteText, STATUS_TEXT } from '../lib/alertText'
import type { Alert } from '../lib/contract'
import { clock, power } from '../lib/format'
import { useUpdateAlert } from '../lib/queries'
import { Button } from './Button'

const SEVERITY_LOOK = { high: 'text-alert', medium: 'text-warn', low: 'text-muted' } as const

/**
 * One alert as one row: when, what happened, how long, how bad, and the decision. Open alerts get "Acknowledge" and "Not a problem"; closed ones
 * say how they were closed.
 */
export function AlertItem({ alert, now }: { alert: Alert; now: number }) {
  const update = useUpdateAlert()
  const ongoing = alert.status === 'open' && isOngoing(alert, now)
  const peak = alert.anomaly_type === 'voltage_fluctuation' ? null : power(alert.peak_power_w)
  const detail = [ongoing ? 'Still going' : lastedText(alert), peak && `peak ${peak}`].filter(Boolean).join(' · ')

  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-center">
      <p className="font-medium tabular-nums text-soft">{clock(Date.parse(alert.timestamp))}</p>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
          {alert.status === 'open' && (
            <span aria-hidden="true" className="relative flex size-2">
              {ongoing && <span className="absolute inset-0 rounded-full bg-alert motion-safe:animate-halo" />}
              <span className="relative size-2 rounded-full bg-alert" />
            </span>
          )}
          {ALERT_TITLE[alert.anomaly_type]}
        </p>
        <p className="mt-0.5 text-soft">
          {detail}
          <span className={`font-medium whitespace-nowrap ${SEVERITY_LOOK[alert.severity]}`}> · {alert.severity} severity</span>
        </p>
      </div>
      <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:justify-end">
        {alert.status === 'open' ? (
          <>
            <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate({ alert, status: 'acknowledged' })}>
              Acknowledge
            </Button>
            <Button
              disabled={update.isPending}
              title="Not a real problem. This feedback helps the model learn."
              onClick={() => update.mutate({ alert, status: 'false_alarm' })}
            >
              Not a problem
            </Button>
          </>
        ) : (
          <p className="text-soft sm:text-right">
            {STATUS_TEXT[alert.status]}
            {noteText(alert.note) && <span className="text-muted"> · {noteText(alert.note)}</span>}
          </p>
        )}
      </div>
    </li>
  )
}
