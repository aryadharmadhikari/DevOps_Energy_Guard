import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DayTable } from '../components/DayTable'
import { Delta } from '../components/Delta'
import { ErrorNotice } from '../components/ErrorNotice'
import { Figure } from '../components/Figure'
import { PartsOfDay } from '../components/PartsOfDay'
import { PeriodColumns, type PeriodColumn } from '../components/PeriodColumns'
import { Section } from '../components/Section'
import { Skeleton } from '../components/Skeleton'
import {
  dayHours,
  lastWeekSoFar,
  monthDays,
  monthOutlook,
  todayHours,
  todayVsYesterday,
  total,
  weekDays,
  weekHours,
  type Day,
  type Slot,
} from '../lib/energy'
import { clock, fullDay, hourLabel, hourRange, kwh, monthName, percentChange, power, rupees, units } from '../lib/format'
import { useMeter } from '../lib/meters'
import { useHistory } from '../lib/queries'
import { TARIFF } from '../lib/tariff'
import { DAY_MS, HOUR_MS, istHourStart, istMidnight } from '../lib/time'
import { useNow } from '../lib/useNow'
import { usePageTitle } from '../lib/usePageTitle'

type Period = 'today' | 'week' | 'month'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
]

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' })
const DAY_OF_MONTH = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' })

const COST_INFO = `Units × ${TARIFF.name} rates from ${TARIFF.validFrom}, at this month's average rate per unit. Duty, tax on sale and the fuel adjustment charge are not included.`

// The period names are the page heading: the one you're on in ink, the others a click away.
function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div role="tablist" aria-label="Period" className="flex flex-wrap gap-x-6 gap-y-1 sm:gap-x-8">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          role="tab"
          aria-selected={p.value === value}
          onClick={() => onChange(p.value)}
          className={`text-[1.3rem] leading-8 font-semibold tracking-tight transition-colors sm:text-title ${p.value === value ? 'text-ink' : 'text-faint hover:text-muted'}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

/** Small numbers in a row: label above, value below. */
function Stats({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-small text-muted">{i.label}</dt>
          <dd className="mt-1 text-lead font-semibold tabular-nums">{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function hourColumns(hours: Slot[], now: number): PeriodColumn[] {
  const currentHour = istHourStart(now)
  return hours.map((s, i) => {
    const current = s.start === currentHour
    return {
      key: s.start,
      label: current ? 'Now' : i % 3 === 0 && Math.abs(s.start - currentHour) > HOUR_MS ? hourLabel(s.start) : '',
      title: hourRange(s.start),
      value: s.start > now || !s.hasData ? null : s.kwh,
      alerts: s.alerts,
      current,
    }
  })
}

/** One picked hour of today, in a line: the numbers behind its column. */
function HourDetail({ slot, rate, now, onClear }: { slot: Slot; rate?: number; now: number; onClear: () => void }) {
  const length = Math.min(HOUR_MS, Math.max(1, now - slot.start))
  const items = [
    `${kwh(slot.kwh)} kWh`,
    rate !== undefined && rupees(slot.kwh * rate),
    `average ${power((slot.kwh / (length / HOUR_MS)) * 1000)}`,
    slot.peakW !== null && `highest ${power(slot.peakW)}${slot.peakAt !== null ? ` at ${clock(slot.peakAt)}` : ''}`,
    `${slot.alerts || 'no'} ${slot.alerts === 1 ? 'alert' : 'alerts'}`,
  ].filter(Boolean)
  return (
    <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t-2 border-ink pt-3 motion-safe:animate-appear">
      <p>
        <span className="font-semibold">{hourRange(slot.start)}</span>
        <span className="text-soft tabular-nums"> · {items.join(' · ')}</span>
      </p>
      <button type="button" onClick={onClear} className="font-medium text-muted hover:text-ink">
        Clear
      </button>
    </div>
  )
}

/**
 * A picked day, opened up: its numbers and its own hour-by-hour chart. Arrows step to the
 * day before or after. Days older than the 7-day hourly history only have their daily total.
 */
function DayDetail({
  day,
  hours,
  days,
  rate,
  now,
  wholeLabel,
  onSelect,
}: {
  day: Day
  hours: Slot[] | null
  days: Day[]
  rate?: number
  now: number
  wholeLabel: string
  onSelect: (start: number | null) => void
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [day.start])

  const withData = days.filter((d) => d.hasData && !d.isFuture)
  const at = withData.findIndex((d) => d.start === day.start)
  const prev = withData[at - 1]
  const next = withData[at + 1]
  const hourly = hours ? total(hours) : null
  const peak = hourly?.peakW != null ? hourly : day
  const arrow = 'flex size-8 items-center justify-center rounded-full ring-1 ring-edge transition-colors ring-inset hover:bg-wash disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <section ref={ref} aria-label={`${fullDay(day.start)}, hour by hour`} className="scroll-mt-6 border-t-2 border-ink pt-5 motion-safe:animate-appear">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button type="button" className={arrow} disabled={!prev} onClick={() => prev && onSelect(prev.start)} aria-label="Day before">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h2 className="min-w-36 text-center text-lead font-semibold tracking-tight">
            {day.isToday ? 'Today' : fullDay(day.start)}
          </h2>
          <button type="button" className={arrow} disabled={!next} onClick={() => next && onSelect(next.start)} aria-label="Day after">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <button type="button" onClick={() => onSelect(null)} className="font-medium text-muted hover:text-ink">
          Back to {wholeLabel}
        </button>
      </div>

      <Stats
        items={[
          { label: day.isToday ? 'Used so far' : 'Used', value: `${kwh(day.kwh)} kWh` },
          { label: 'Cost', value: rate !== undefined ? rupees(day.kwh * rate) : '–' },
          {
            label: 'Highest load',
            value: peak.peakW !== null ? `${power(peak.peakW)}${hours && peak.peakAt !== null ? `, ${hourLabel(peak.peakAt)}` : ''}` : '–',
          },
          { label: 'Alerts', value: <span className={day.alerts ? 'text-alert' : ''}>{day.alerts}</span> },
        ]}
      />

      <div className="mt-8">
        {hours ? (
          <PeriodColumns
            key={day.start}
            columns={hourColumns(hours, now)}
            selected={null}
            onSelect={() => {}}
            format={(v) => (rate !== undefined ? `${kwh(v)} kWh · ${rupees(v * rate)}` : `${kwh(v)} kWh`)}
            label={`Energy used on ${fullDay(day.start)}, per hour`}
            height={220}
          />
        ) : (
          <p className="bg-wash px-4 py-3 text-soft">Hour-by-hour readings are kept for the last 7 days. This day only has its daily total.</p>
        )}
      </div>
    </section>
  )
}

export function UsagePage() {
  usePageTitle('Usage')
  const qc = useQueryClient()
  const { meterId } = useMeter()
  const now = useNow(30_000)
  const [period, setPeriodState] = useState<Period>('today')
  const [selected, setSelected] = useState<number | null>(null)
  const setPeriod = (p: Period) => {
    setPeriodState(p)
    setSelected(null)
  }

  const h24 = useHistory(meterId, '24h')
  const h7 = useHistory(meterId, '7d')
  const h30 = useHistory(meterId, '30d')
  const failed = [h24, h7, h30].find((q) => q.isError && !q.data)

  const b24 = h24.data?.buckets
  const b7 = h7.data?.buckets
  const b30 = h30.data?.buckets
  const month = b30 && b24 ? monthOutlook(b30, b24, now) : null
  const rate = month?.rate

  const hours = b24 ? todayHours(b24, now) : null
  const week = b7 && b24 ? weekDays(b7, b24, now) : null
  const monthList = b30 && b24 ? monthDays(b30, b24, now) : null
  const days = period === 'week' ? week : period === 'month' ? monthList : null
  const slots: Slot[] | null = period === 'today' ? hours : days
  const past = slots?.filter((s) => s.start <= now) ?? []
  const sum = slots ? total(past) : null
  const fullDays = period === 'today' ? [] : past.filter((s) => s.hasData && s.start < istMidnight(now))
  const usualDay = fullDays.length ? total(fullDays).kwh / fullDays.length : null
  const hourly = period === 'today'

  const pickedHour = hourly && selected !== null ? hours?.find((s) => s.start === selected) : undefined
  const pickedDay = !hourly && selected !== null ? days?.find((d) => d.start === selected) : undefined
  const pickedDayHours = pickedDay && b7 && b24 ? dayHours(b7, b24, pickedDay.start, now) : null

  // This period against the one before, on equal terms (same hours or same weekdays so far).
  let compare = null
  if (period === 'today' && b24 && b7) {
    const c = todayVsYesterday(b24, b7, now)
    if (c) compare = <Delta change={percentChange(c.today, c.yesterday)} suffix="yesterday by now" />
  } else if (period === 'week' && b30 && fullDays.length) {
    const last = lastWeekSoFar(b30, now)
    if (last) compare = <Delta change={percentChange(total(fullDays).kwh, last)} suffix="last week" />
  } else if (period === 'month' && month) {
    compare = `${units(month.projectedKwh)} units by month end`
  }

  const columns: PeriodColumn[] | null = hourly
    ? hours && hourColumns(hours, now)
    : days &&
      days.map((d, i) => ({
        key: d.start,
        label: d.isToday
          ? 'Today'
          : period === 'week'
            ? WEEKDAY.format(d.start)
            : i % 7 === 0 && Math.abs(d.start - istMidnight(now)) > 2 * DAY_MS
              ? DAY_OF_MONTH.format(d.start)
              : '',
        title: fullDay(d.start),
        value: d.isFuture || !d.hasData ? null : d.kwh,
        alerts: d.alerts,
        current: d.isToday,
      }))

  const money = (v: number) => (rate !== undefined ? `${kwh(v)} kWh · ${rupees(v * rate)}` : `${kwh(v)} kWh`)
  const periodName = period === 'today' ? 'today' : period === 'week' ? 'this week' : `in ${monthName(now).split(' ')[0]}`
  const wholeLabel = period === 'week' ? 'the whole week' : 'the whole month'

  // Time of day follows what's in view: today, the picked day, or the week so far.
  const partsHours = pickedDay ? pickedDayHours : hourly ? hours?.filter((s) => s.start <= now) : period === 'week' && b7 && b24 ? weekHours(b7, b24, now) : null
  const partsAside = pickedDay ? (pickedDay.isToday ? 'Today so far' : fullDay(pickedDay.start)) : hourly ? 'Today so far' : 'Since Monday'

  return (
    <div className="space-y-16">
      <div>
        <h1 className="sr-only">Usage</h1>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      {failed && <ErrorNotice error={failed.error} onRetry={() => qc.invalidateQueries()} />}

      <section className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-3">
        <Figure label="Used" value={sum ? `${kwh(sum.kwh)} kWh` : undefined} note={compare} />
        <Figure
          label="Cost"
          value={sum && rate !== undefined ? rupees(sum.kwh * rate) : undefined}
          note={period === 'month' ? `plus the ${rupees(TARIFF.fixedPerMonth)} fixed charge` : null}
          info={COST_INFO}
        />
        {hourly ? (
          <Figure
            label="Highest load"
            value={sum ? (sum.peakW !== null ? power(sum.peakW) : '–') : undefined}
            note={sum?.peakAt != null && `around ${clock(sum.peakAt)}`}
          />
        ) : (
          <Figure
            label="Usual day"
            value={sum ? (usualDay !== null ? `${kwh(usualDay)} kWh` : '–') : undefined}
            note={fullDays.length ? `average of ${fullDays.length} full ${fullDays.length === 1 ? 'day' : 'days'}` : 'No full day yet'}
            info="The average of the finished days in this period. Today is left out until it ends."
          />
        )}
      </section>

      <Section title={hourly ? 'Hour by hour' : 'Day by day'} aside={hourly ? 'Click an hour for its numbers' : 'Click a day to open it'}>
        {columns ? (
          <>
            <PeriodColumns
              key={period}
              columns={columns}
              selected={selected}
              onSelect={setSelected}
              usual={hourly ? null : usualDay}
              format={money}
              hint={hourly ? 'Click for its numbers' : 'Click for hour by hour'}
              label={`Energy used ${periodName}, ${hourly ? 'per hour' : 'per day'}`}
            />
            {pickedHour && <HourDetail slot={pickedHour} rate={rate} now={now} onClear={() => setSelected(null)} />}
          </>
        ) : (
          <Skeleton className="h-[260px]" />
        )}
      </Section>

      {pickedDay && days && (
        <DayDetail day={pickedDay} hours={pickedDayHours} days={days} rate={rate} now={now} wholeLabel={wholeLabel} onSelect={setSelected} />
      )}

      {partsHours !== undefined && (period !== 'month' || pickedDay) && (
        <Section title="Time of day" aside={partsAside}>
          {partsHours ? <PartsOfDay hours={partsHours} rate={rate} /> : pickedDay ? <p className="text-muted">No hour-by-hour readings for this day.</p> : <Skeleton className="h-60" />}
        </Section>
      )}

      {days && (
        <Section title="Every day" aside="Newest first">
          <DayTable days={days} rate={rate} selected={selected} onSelect={setSelected} />
        </Section>
      )}
    </div>
  )
}
