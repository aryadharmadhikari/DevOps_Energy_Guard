import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ago } from '../lib/format'
import { useMeter } from '../lib/meters'
import { keys, useMeters } from '../lib/queries'
import { useNow } from '../lib/useNow'

/**
 * Which home the dashboard shows: a rounded button with the home's name, opening a short list
 * of homes with when each last sent a reading. Arrow keys move, Enter picks, Escape closes.
 */
export function MeterSelect() {
  const { meterId, setMeterId } = useMeter()
  const { data: meters } = useMeters()
  const qc = useQueryClient()
  const now = useNow(10_000)
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const current = meters?.find((m) => m.meter_id === meterId)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    list.current?.focus()
    // The list is cached for minutes; "last reading" should be fresh when someone looks.
    qc.invalidateQueries({ queryKey: keys.meters })
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, qc])

  const pick = (id: string) => {
    setMeterId(id)
    setOpen(false)
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!meters?.length}
        onClick={() => {
          setFocus(Math.max(0, meters?.findIndex((m) => m.meter_id === meterId) ?? 0))
          setOpen((o) => !o)
        }}
        className="flex h-9 items-center gap-2 rounded-full pr-3 pl-4 font-medium ring-1 ring-edge transition-colors ring-inset hover:bg-wash disabled:text-muted aria-expanded:bg-wash"
      >
        <span className="sr-only">Home: </span>
        {current?.name ?? (meters ? 'No homes yet' : 'Loading')}
        <svg viewBox="0 0 10 6" aria-hidden="true" className={`w-2.5 text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && meters && (
        <ul
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label="Homes"
          aria-activedescendant={`home-${meters[focus]?.meter_id}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') setFocus((f) => Math.min(meters.length - 1, f + 1))
            else if (e.key === 'ArrowUp') setFocus((f) => Math.max(0, f - 1))
            else if (e.key === 'Enter' || e.key === ' ') pick(meters[focus].meter_id)
            else return
            e.preventDefault()
          }}
          className="absolute top-full right-0 z-50 mt-2 w-60 bg-page p-1.5 shadow-[0_10px_40px_rgb(0_0_0/0.14)] ring-1 ring-line outline-none motion-safe:animate-pop"
        >
          {meters.map((m, i) => {
            const selected = m.meter_id === meterId
            return (
              <li
                key={m.meter_id}
                id={`home-${m.meter_id}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setFocus(i)}
                onClick={() => pick(m.meter_id)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 ${i === focus ? 'bg-wash' : ''}`}
              >
                <span>
                  <span className="block font-medium">{m.name}</span>
                  <span className="block text-small text-muted">
                    {m.last_seen ? `Last reading ${ago(Date.parse(m.last_seen), now)}` : 'No readings yet'}
                  </span>
                </span>
                {selected && (
                  <svg viewBox="0 0 16 16" className="size-4 text-ink" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
