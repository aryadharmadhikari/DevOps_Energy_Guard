import { rupeeRate, units } from '../lib/format'
import { slabFor, slabRate, TARIFF } from '../lib/tariff'

/**
 * The month's units on the tariff's slabs. Each slab gets the same width (they are steps,
 * not distances), so the cheap first 100 units stay visible next to the open-ended top slab.
 * Black is used so far, grey is the rest of the month at the same pace.
 */
export function SlabMeter({ soFar, projected }: { soFar: number; projected: number }) {
  const slabs = TARIFF.slabs
  const lastFrom = slabs[slabs.length - 2].upToUnits
  const lastTo = Math.max(lastFrom * 1.6, projected * 1.1)

  // Where a number of units sits along the bar, 0 to 1.
  const at = (u: number) => {
    let from = 0
    for (let i = 0; i < slabs.length; i++) {
      const to = Number.isFinite(slabs[i].upToUnits) ? slabs[i].upToUnits : lastTo
      if (u <= to || i === slabs.length - 1) return (i + Math.min(1, Math.max(0, (u - from) / (to - from)))) / slabs.length
      from = to
    }
    return 1
  }

  const current = slabFor(soFar)

  return (
    <div>
      <div className="relative h-2.5 bg-wash" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 bg-edge" style={{ width: `${at(projected) * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-700" style={{ width: `${at(soFar) * 100}%` }} />
        {slabs.slice(1).map((_, i) => (
          <span key={i} className="absolute inset-y-0 w-[2px] bg-page" style={{ left: `${((i + 1) / slabs.length) * 100}%` }} />
        ))}
      </div>
      <ol className="mt-2.5 grid text-small" style={{ gridTemplateColumns: `repeat(${slabs.length}, minmax(0, 1fr))` }}>
        {slabs.map((s, i) => {
          const from = i === 0 ? 0 : slabs[i - 1].upToUnits
          const here = s === current
          return (
            <li key={i} className={`pr-2 ${here ? 'text-ink' : 'text-muted'}`}>
              <span className={`block tabular-nums ${here ? 'font-medium' : ''}`}>{rupeeRate(slabRate(s))} a unit</span>
              <span className="block tabular-nums">
                {!Number.isFinite(s.upToUnits)
                  ? `Above ${units(from)}`
                  : from === 0
                    ? `First ${units(s.upToUnits)}`
                    : `${units(from + 1)}–${units(s.upToUnits)}`}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
