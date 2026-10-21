import { useQueryClient } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router'
import { Delta } from '../components/Delta'
import { ErrorNotice } from '../components/ErrorNotice'
import { Figure } from '../components/Figure'
import { InfoTip } from '../components/InfoTip'
import { Ledger } from '../components/Ledger'
import { LiveStamp } from '../components/LiveStatus'
import { PowerCurve } from '../components/PowerCurve'
import { Section } from '../components/Section'
import { Skeleton } from '../components/Skeleton'
import { SlabMeter } from '../components/SlabMeter'
import { statusSentence } from '../lib/alertText'
import type { Alert } from '../lib/contract'
import { monthOutlook, todayHours, todayVsYesterday, total, usualHours } from '../lib/energy'
import { clock, hourLabel, kw, kwh, monthName, percentChange, power, rupeeRate, rupees, shortDay, units } from '../lib/format'
import { vsUsual } from '../lib/insight'
import { useMeter } from '../lib/meters'
import { useAlerts, useAllAlerts, useHistory, useLatest } from '../lib/queries'
import { billFor, slabFor, slabRate, TARIFF } from '../lib/tariff'
import { HOUR_MS, istMidnight, istMonth, istTimeOfDay } from '../lib/time'
import type { StreamStatus } from '../lib/useLiveStream'
import { useNow } from '../lib/useNow'
import { usePageTitle } from '../lib/usePageTitle'

function Status({ open, now }: { open: Alert[] | undefined; now: number }) {
  if (!open) return <Skeleton className="h-6 w-72" />
  if (open.length === 0) {
    return (
      <p className="flex items-center gap-2.5 text-soft">
        <svg viewBox="0 0 16 16" className="size-4 text-good" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        No open alerts
      </p>
    )
  }
  return (
    <p className="flex max-w-lg items-baseline gap-2.5 motion-safe:animate-appear">
      <span aria-hidden="true" className="size-2 shrink-0 -translate-y-px rounded-full bg-alert" />
      <span>
        {statusSentence(open, now)}{' '}
        <Link to="/alerts" className="font-medium whitespace-nowrap underline decoration-edge underline-offset-4 hover:decoration-ink">
          Review {open.length === 1 ? 'it' : `all ${open.length}`}
        </Link>
      </span>
    </p>
  )
}

const COST_INFO = `Units × ${TARIFF.name} rates from ${TARIFF.validFrom}, at this month's average rate per unit. Duty, tax on sale and the fuel adjustment charge are not included.`

export function OverviewPage() {
  usePageTitle()
  const qc = useQueryClient()
  const { meterId } = useMeter()
  const stream = useOutletContext<StreamStatus>()
  const now = useNow(15_000)

  const latest = useLatest(meterId)
  const h24 = useHistory(meterId, '24h')
  const h7 = useHistory(meterId, '7d')
  const h30 = useHistory(meterId, '30d')
  const open = useAlerts(meterId, 'open')
  const alerts = useAllAlerts(meterId)
  const failed = [latest, h24, h7, h30, open].find((q) => q.isError && !q.data)

  const b24 = h24.data?.buckets
  const usual = h7.data ? usualHours(h7.data.buckets, now) : null
  const usualNow = usual?.[Math.floor(istTimeOfDay(now) / HOUR_MS)]
  const compare = latest.data ? vsUsual(latest.data.total_power_w, usualNow, now) : null
  const today = b24 ? total(todayHours(b24, now)) : null
  const vsYesterday = b24 && h7.data ? todayVsYesterday(b24, h7.data.buckets, now) : null
  const month = h30.data && b24 ? monthOutlook(h30.data.buckets, b24, now) : null
  const last24 = b24 ? b24.reduce((s, b) => s + (b.energy_kwh ?? 0), 0) : null
  const alertsToday = alerts.data?.filter((a) => Date.parse(a.timestamp) >= istMidnight(now)).length

  const monthWord = monthName(now).split(' ')[0]
  const { start: monthStart, days } = istMonth(now)
  const monthEnd = monthStart + (days - 1) * 86_400_000
  const expected = month ? billFor(month.projectedKwh) : null
  const slab = month ? slabFor(month.kwh) : null

  return (
    <div className="space-y-20">
      {failed && <ErrorNotice error={failed.error} onRetry={() => qc.invalidateQueries()} />}

      {/* What is happening this second, whether that is normal, and today so far. */}
      <section className="grid gap-x-24 gap-y-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div>
          <h1 className="sr-only">Right now</h1>
          <LiveStamp status={stream} at={latest.data?.timestamp} />
          {latest.data ? (
            <p className="mt-5 text-hero font-semibold tracking-[-0.03em]">
              {kw(latest.data.total_power_w)}
              <span className="ml-3 text-title font-medium tracking-tight text-muted">kW</span>
            </p>
          ) : (
            <Skeleton className="mt-5 h-20 w-64" />
          )}
          <p className="mt-6 flex min-h-8 max-w-lg items-center gap-2.5 text-title tracking-tight">
            {compare?.text}
            {compare && usualNow != null && (
              <InfoTip label="How usual is worked out">
                This home usually draws {power(usualNow * 1000)} around {hourLabel(now)}: the average for this hour over the
                past 7 days of readings.
              </InfoTip>
            )}
          </p>
          <div className="mt-10">
            <Status open={open.data} now={now} />
          </div>
        </div>

        <div>
          <h2 className="mb-2 font-semibold">Today so far</h2>
          <Ledger
            rows={[
              {
                label: 'Used',
                value: today ? `${kwh(today.kwh)} kWh` : undefined,
                note: vsYesterday && <Delta change={percentChange(vsYesterday.today, vsYesterday.yesterday)} suffix="yesterday by now" />,
              },
              { label: 'Cost', value: today && month ? rupees(today.kwh * month.rate) : undefined, info: COST_INFO },
              {
                label: 'Highest load',
                value: today ? (today.peakW !== null ? power(today.peakW) : '–') : undefined,
                note: today?.peakAt != null && `around ${clock(today.peakAt)}`,
              },
              {
                label: 'Supply voltage',
                value: latest.data ? (latest.data.voltage_v !== null ? `${Math.round(latest.data.voltage_v)} V` : '–') : undefined,
                info: 'From the latest reading. Homes in India are supplied at 230 V; an alert opens when a reading leaves the safe range.',
              },
              {
                label: 'Alerts',
                value:
                  alertsToday === undefined ? undefined : (
                    <Link to="/alerts" className={alertsToday ? 'text-alert underline decoration-alert/30 underline-offset-4' : ''}>
                      {alertsToday}
                    </Link>
                  ),
              },
            ]}
          />
        </div>
      </section>

      <Section
        title="Last 24 hours"
        info="Average power for every 5 minutes, from the meter's readings. The grey line is this home's usual load for each hour, from the past 7 days."
        aside={last24 !== null && month && `${kwh(last24)} kWh · ${rupees(last24 * month.rate)}`}
      >
        {b24 ? (
          <PowerCurve buckets={b24} latest={latest.data} alerts={alerts.data ?? []} usualKw={usual} now={now} />
        ) : (
          <Skeleton className="h-[300px]" />
        )}
      </Section>

      <Section
        title={`${monthWord} bill`}
        info={`An estimate from ${TARIFF.name} rates from ${TARIFF.validFrom} (${TARIFF.source}). Electricity duty, tax on sale and the fuel adjustment charge come on top and change each month, so they are not included.`}
      >
        <div className="grid gap-x-24 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div>
            <div className="grid grid-cols-2 gap-x-10 gap-y-8">
              <Figure
                label="So far"
                value={month ? rupees(month.kwh * month.rate) : undefined}
                note={month && `${units(month.kwh)} units`}
                info={`Units used since 1 ${monthWord}, at this month's average rate per unit. The ${rupees(TARIFF.fixedPerMonth)} fixed charge is counted once, in the expected bill.`}
              />
              <Figure
                label={`By ${shortDay(monthEnd)}`}
                value={expected ? rupees(expected.total) : undefined}
                note={month && `${units(month.projectedKwh)} units at this pace`}
                info={`If the rest of ${monthWord} uses as much per day as the days so far did on average.`}
              />
            </div>
            <div className="mt-10">
              {month && slab ? (
                <>
                  <p className="mb-4 max-w-xl text-soft">
                    Each extra unit this month costs <span className="font-semibold text-ink">{rupeeRate(slabRate(slab))}</span>
                    {slab === TARIFF.slabs[0] ? ', the cheapest slab.' : `. The first ${TARIFF.slabs[0].upToUnits} cost ${rupeeRate(slabRate(TARIFF.slabs[0]))}.`}
                  </p>
                  <SlabMeter soFar={month.kwh} projected={month.projectedKwh} />
                </>
              ) : (
                <Skeleton className="h-16" />
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Expected bill, line by line</h3>
            <Ledger
              rows={[
                { label: 'Fixed charge', value: expected ? rupees(expected.fixed) : undefined, note: 'every month, single phase' },
                { label: 'Energy charge', value: expected ? rupees(expected.energy) : undefined, note: 'by slab' },
                {
                  label: 'Wheeling charge',
                  value: expected ? rupees(expected.wheeling) : undefined,
                  note: `${rupeeRate(TARIFF.wheelingPerUnit)} on every unit`,
                },
                {
                  label: 'Total',
                  value: expected ? rupees(expected.total) : undefined,
                  strong: true,
                  info: 'Before electricity duty, tax on sale and the fuel adjustment charge.',
                },
              ]}
            />
          </div>
        </div>
      </Section>
    </div>
  )
}
