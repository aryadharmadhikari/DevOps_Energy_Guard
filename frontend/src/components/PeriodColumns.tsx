import { useState } from 'react'
import { niceTicks } from '../lib/chart'
import { color } from '../lib/tokens'
import { useWidth } from '../lib/useWidth'

export type PeriodColumn = {
  key: number
  /** Axis label; empty to leave the column unlabelled. */
  label: string
  /** Tooltip heading, e.g. "Tue, 14 Oct". */
  title: string
  /** kWh, or null for no readings (a gap, or time still to come). */
  value: number | null
  alerts: number
  current: boolean
}

const M = { top: 24, right: 0, bottom: 30, left: 40 }

function column(x: number, y: number, w: number, h: number) {
  const r = Math.min(3, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/**
 * Energy per hour or per day, one colour. With a hint, a click picks an hour or day
 * (the others turn grey) and a second click lets go. A thin line marks
 * a usual day when there is one, and a red dot marks a column where an alert started.
 */
export function PeriodColumns({
  columns,
  selected,
  onSelect,
  usual,
  format,
  label,
  hint,
  height = 260,
}: {
  columns: PeriodColumn[]
  selected: number | null
  onSelect: (key: number | null) => void
  usual?: number | null
  format: (kwh: number) => string
  label: string
  /** What a click does, shown in the tooltip. Without it the columns are not clickable. */
  hint?: string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const max = Math.max(0.1, usual ?? 0, ...columns.map((c) => c.value ?? 0))
  const ticks = niceTicks(max * 1.05)
  const top = ticks[ticks.length - 1]
  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = height - M.top - M.bottom
  const band = columns.length ? plotW / columns.length : 0
  const barW = Math.max(3, Math.min(22, band * 0.56))
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const cx = (i: number) => M.left + band * i + band / 2

  const tipIndex = hover ?? (selected !== null ? columns.findIndex((c) => c.key === selected) : -1)
  const tip = tipIndex >= 0 ? columns[tipIndex] : null
  const tipLeft = tip ? cx(tipIndex) > width - 200 : false

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label={label} className="block overflow-visible motion-safe:animate-appear">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? color.edge : color.line} shapeRendering="crispEdges" />
              <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill={color.muted} className="tabular-nums">
                {t === top ? `${t} kWh` : t}
              </text>
            </g>
          ))}

          {columns.map((c, i) => {
            const picked = selected === null || selected === c.key
            const fill = c.value === null ? color.ghost : picked ? color.ink : color.ghost
            return (
              <g key={c.key}>
                {c.value !== null && c.value > 0 && (
                  <path
                    d={column(cx(i) - barW / 2, y(c.value), barW, y(0) - y(c.value))}
                    fill={fill}
                    style={{ transition: 'fill 150ms' }}
                  />
                )}
                {c.alerts > 0 && c.value !== null && (
                  <circle cx={cx(i)} cy={y(c.value) - 9} r={3.5} fill={color.alert} stroke={color.page} strokeWidth={2} />
                )}
                {c.label && (
                  <text
                    x={cx(i)}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize={12}
                    fill={c.current ? color.ink : c.value === null ? color.faint : color.muted}
                    fontWeight={c.current ? 500 : 400}
                  >
                    {c.label}
                  </text>
                )}
              </g>
            )
          })}

          {usual != null && usual > 0 && (
            <g pointerEvents="none">
              <line x1={M.left} x2={width} y1={y(usual)} y2={y(usual)} stroke={color.muted} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={width} y={y(usual) - 6} textAnchor="end" fontSize={12} fill={color.muted}>
                Usual day
              </text>
            </g>
          )}

          {columns.map((c, i) => (
            <rect
              key={c.key}
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={plotH + M.bottom}
              fill="transparent"
              tabIndex={c.value === null ? -1 : 0}
              role={hint ? 'button' : undefined}
              aria-pressed={hint ? selected === c.key : undefined}
              aria-label={`${c.title}: ${c.value === null ? 'no readings' : format(c.value)}${c.alerts ? `, ${c.alerts} alerts` : ''}`}
              className={`outline-none ${c.value !== null && hint ? 'cursor-pointer' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => hint && c.value !== null && onSelect(selected === c.key ? null : c.key)}
              onKeyDown={(e) => {
                if (hint && (e.key === 'Enter' || e.key === ' ') && c.value !== null) {
                  e.preventDefault()
                  onSelect(selected === c.key ? null : c.key)
                }
              }}
            />
          ))}
        </svg>
      )}

      {tip && (
        <div
          className="pointer-events-none absolute z-10 w-48 bg-page px-3 py-2 text-small shadow-[0_2px_16px_rgb(0_0_0/0.1)] ring-1 ring-line"
          style={{ top: 0, ...(tipLeft ? { right: width - cx(tipIndex) + barW / 2 + 10 } : { left: cx(tipIndex) + barW / 2 + 10 }) }}
        >
          <p className="font-medium">
            {tip.title}
            {tip.current && <span className="font-normal text-muted"> so far</span>}
          </p>
          <p className="mt-0.5 tabular-nums text-muted">{tip.value === null ? 'No readings' : format(tip.value)}</p>
          {tip.alerts > 0 && (
            <p className="mt-0.5 text-alert">
              {tip.alerts} {tip.alerts === 1 ? 'alert' : 'alerts'}
            </p>
          )}
          {tip.value !== null && hover !== null && hint && <p className="mt-1 text-muted">{selected === tip.key ? 'Click again to close' : hint}</p>}
        </div>
      )}
    </div>
  )
}
