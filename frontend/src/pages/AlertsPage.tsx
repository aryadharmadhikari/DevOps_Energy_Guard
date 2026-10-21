import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertItem } from '../components/AlertItem'
import { Button } from '../components/Button'
import { CountBadge } from '../components/CountBadge'
import { ErrorNotice } from '../components/ErrorNotice'
import { Skeleton } from '../components/Skeleton'
import { ALERT_TITLE } from '../lib/alertText'
import type { Alert, Severity } from '../lib/contract'
import { exportCsv, exportPdf } from '../lib/exportAlerts'
import { fullDay } from '../lib/format'
import { useMeter } from '../lib/meters'
import { useAllAlerts, useMeters } from '../lib/queries'
import { DAY_MS, istMidnight } from '../lib/time'
import { useNow } from '../lib/useNow'
import { usePageTitle } from '../lib/usePageTitle'

type View = 'open' | 'closed'
type TypeFilter = Alert['anomaly_type'] | 'all'

const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low']
const PAGE_SIZE = 30

/** "Today", "Yesterday", or "Mon, 13 Oct". */
function dayHeading(ms: number, now: number) {
  const day = istMidnight(ms)
  if (day === istMidnight(now)) return 'Today'
  if (day === istMidnight(now) - DAY_MS) return 'Yesterday'
  return fullDay(ms)
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
      <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AlertsPage() {
  usePageTitle('Alerts')
  const qc = useQueryClient()
  const { meterId } = useMeter()
  const meterName = useMeters().data?.find((m) => m.meter_id === meterId)?.name ?? meterId
  const now = useNow()
  const alerts = useAllAlerts(meterId)

  const [view, setView] = useState<View>('open')
  const [type, setType] = useState<TypeFilter>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [exporting, setExporting] = useState(false)

  const list = alerts.data ?? []
  const openCount = list.filter((a) => a.status === 'open').length
  const types = [...new Set(list.map((a) => a.anomaly_type))]
  const shown = list
    .filter((a) => (view === 'open' ? a.status === 'open' : a.status !== 'open'))
    .filter((a) => type === 'all' || a.anomaly_type === type)
    .sort((a, b) =>
      view === 'open'
        ? SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || Date.parse(b.timestamp) - Date.parse(a.timestamp)
        : Date.parse(b.timestamp) - Date.parse(a.timestamp),
    )
  const page = shown.slice(0, visible)

  // Grouped by IST day, newest day first.
  const groups: { day: string; items: Alert[] }[] = []
  for (const a of page) {
    const day = dayHeading(Date.parse(a.timestamp), now)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(a)
    else groups.push({ day, items: [a] })
  }

  const switchView = (v: View) => {
    setView(v)
    setVisible(PAGE_SIZE)
  }
  const filterLabel = `${view === 'open' ? 'Open' : 'Closed'}${type !== 'all' ? `, ${ALERT_TITLE[type].toLowerCase()}` : ''}`

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        <div>
          <h1 className="sr-only">Alerts</h1>
          <div role="tablist" aria-label="Alerts" className="flex flex-wrap items-center gap-x-6 gap-y-1 sm:gap-x-8">
            {(['open', 'closed'] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => switchView(v)}
                className={`inline-flex items-center gap-2.5 text-[1.3rem] leading-8 font-semibold tracking-tight transition-colors sm:text-title ${view === v ? 'text-ink' : 'text-faint hover:text-muted'}`}
              >
                {v === 'open' ? 'Needs a decision' : 'History'}
                {v === 'open' && <CountBadge count={openCount} label="open" size="lg" />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {types.length > 1 && (
            <label className="relative">
              <span className="sr-only">Kind of alert</span>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as TypeFilter)
                  setVisible(PAGE_SIZE)
                }}
                className="field-sizing-content h-9 cursor-pointer appearance-none rounded-full bg-page pr-9 pl-4 font-medium ring-1 ring-edge transition-colors ring-inset hover:bg-wash"
              >
                <option value="all">Every kind</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {ALERT_TITLE[t]}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 10 6" aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 w-2.5 -translate-y-1/2 text-muted">
                <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>
          )}
          <Button variant="outline" disabled={!shown.length} onClick={() => exportCsv(shown, meterName)} title={`Download these ${shown.length} alerts as a spreadsheet`}>
            <DownloadIcon />
            CSV
          </Button>
          <Button
            variant="outline"
            disabled={!shown.length || exporting}
            title={`Download these ${shown.length} alerts as a PDF`}
            onClick={async () => {
              setExporting(true)
              try {
                await exportPdf(shown, meterName, filterLabel)
              } finally {
                setExporting(false)
              }
            }}
          >
            <DownloadIcon />
            {exporting ? 'Preparing…' : 'PDF'}
          </Button>
        </div>
      </div>

      {alerts.isError && !alerts.data && <ErrorNotice error={alerts.error} onRetry={() => qc.invalidateQueries()} />}

      {!alerts.data ? (
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="max-w-md border-t-2 border-ink pt-6">
          <p className="text-lead font-semibold">{view === 'open' ? 'Nothing to decide' : 'No closed alerts yet'}</p>
          <p className="mt-1 text-soft">
            {view === 'open'
              ? `When something unusual happens on ${meterName}, it shows up here within seconds.`
              : 'Alerts you acknowledge or mark as not a problem are kept here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map((g) => (
            <section key={g.day}>
              <h2 className="flex items-baseline justify-between border-b-2 border-ink pb-2 font-semibold">
                {g.day}
                <span className="text-small font-normal text-muted">
                  {g.items.length} {g.items.length === 1 ? 'alert' : 'alerts'}
                </span>
              </h2>
              <ul className="divide-y divide-line">
                {g.items.map((a) => (
                  <AlertItem key={a.alert_id} alert={a} now={now} />
                ))}
              </ul>
            </section>
          ))}
          {shown.length > page.length && (
            <Button variant="outline" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, shown.length - page.length)} more of {shown.length - page.length}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
