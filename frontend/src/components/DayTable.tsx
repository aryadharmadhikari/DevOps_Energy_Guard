import { useState } from 'react'
import type { Day } from '../lib/energy'
import { fullDay, kwh, power, rupees } from '../lib/format'

/** Every day with readings, newest first: units, estimated cost, highest load, alerts. */
export function DayTable({ days, rate, selected, onSelect }: { days: Day[]; rate?: number; selected: number | null; onSelect: (start: number | null) => void }) {
  const [showAll, setShowAll] = useState(false)
  const rows = days.filter((d) => d.hasData && !d.isFuture).reverse()
  const visible = showAll ? rows : rows.slice(0, 10)

  return (
    <div className="motion-safe:animate-appear">
      <table className="w-full text-left">
        <thead className="text-small text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="w-[40%] pb-2.5 font-normal">Day</th>
            <th scope="col" className="pb-2.5 text-right font-normal">Units</th>
            <th scope="col" className="pb-2.5 text-right font-normal">Cost</th>
            <th scope="col" className="hidden pb-2.5 text-right font-normal sm:table-cell">Highest load</th>
            <th scope="col" className="pb-2.5 text-right font-normal">Alerts</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((d) => (
            <tr
              key={d.start}
              onClick={() => onSelect(selected === d.start ? null : d.start)}
              className={`cursor-pointer border-b border-line transition-colors hover:bg-wash ${selected === d.start ? 'bg-wash' : ''}`}
            >
              <th scope="row" className="py-3 pr-4 font-medium">
                {d.isToday ? 'Today' : fullDay(d.start)}
                {d.isToday && <span className="font-normal text-muted"> so far</span>}
              </th>
              <td className="py-3 text-right tabular-nums">{kwh(d.kwh)}</td>
              <td className="py-3 pl-4 text-right tabular-nums">{rate !== undefined ? rupees(d.kwh * rate) : ''}</td>
              <td className="hidden py-3 pl-4 text-right text-muted tabular-nums sm:table-cell">{d.peakW !== null ? power(d.peakW) : '–'}</td>
              <td className={`w-16 py-3 pl-4 text-right tabular-nums ${d.alerts ? 'font-medium text-alert' : 'text-faint'}`}>{d.alerts || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > visible.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-4 font-medium underline decoration-edge underline-offset-4 hover:decoration-ink"
        >
          Show all {rows.length} days
        </button>
      )}
    </div>
  )
}
