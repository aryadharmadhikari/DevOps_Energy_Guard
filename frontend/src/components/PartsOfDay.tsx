import { partsOfDay, type Slot } from '../lib/energy'
import { kwh, rupees } from '../lib/format'

/**
 * When in the day the units go: night, morning, afternoon, evening, in clock order.
 * Bars share one scale (the biggest part fills its row).
 */
export function PartsOfDay({ hours, rate }: { hours: Slot[]; rate?: number }) {
  const parts = partsOfDay(hours)
  const sum = parts.reduce((s, p) => s + p.kwh, 0)
  const max = Math.max(...parts.map((p) => p.kwh), 0.001)

  return (
    <ul className="divide-y divide-line border-y border-line motion-safe:animate-appear">
      {parts.map((p) => (
        <li key={p.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)_5.5rem_5rem]">
          <p>
            <span className="font-medium">{p.label}</span>
            <span className="block text-small text-muted">{p.hours}</span>
          </p>
          <span className="order-last col-span-2 h-2 bg-wash sm:order-none sm:col-span-1">
            <span className="block h-full bg-ink transition-[width] duration-500" style={{ width: `${(p.kwh / max) * 100}%` }} />
          </span>
          <p className="text-right tabular-nums">
            {p.hasData ? `${kwh(p.kwh)} kWh` : <span className="text-faint">–</span>}
            {p.hasData && sum > 0 && <span className="block text-small text-muted">{Math.round((p.kwh / sum) * 100)}%</span>}
          </p>
          <p className="hidden text-right font-medium tabular-nums sm:block">{p.hasData && rate !== undefined ? rupees(p.kwh * rate) : ''}</p>
        </li>
      ))}
    </ul>
  )
}
