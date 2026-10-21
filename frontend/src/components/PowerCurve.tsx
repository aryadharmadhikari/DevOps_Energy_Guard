import { useState, type PointerEvent } from 'react'
import { ALERT_TITLE } from '../lib/alertText'
import { niceTicks } from '../lib/chart'
import type { Alert, HistoryBucket, Reading } from '../lib/contract'
import { clock, hourLabel, kw, power } from '../lib/format'
import { HOUR_MS, istHourStart, istMidnight, istTimeOfDay } from '../lib/time'
import { color } from '../lib/tokens'
import { useWidth } from '../lib/useWidth'

type Point = { t: number; w: number; maxW: number }

const SPAN_MS = 24 * HOUR_MS
const BUCKET_MS = 5 * 60_000
// A gap longer than this between readings breaks the line instead of drawing across it.
const GAP_MS = 15 * 60_000
const M = { top: 34, right: 8, bottom: 30, left: 44 }

function points(buckets: HistoryBucket[], latest: Reading | undefined, now: number): Point[] {
  const out: Point[] = []
  for (const b of buckets) {
    if (b.avg_power_w === null) continue
    const start = Date.parse(b.bucket_start)
    out.push({ t: Math.min(start + BUCKET_MS / 2, now), w: b.avg_power_w, maxW: b.max_power_w ?? b.avg_power_w })
  }
  if (latest) {
    const t = Date.parse(latest.timestamp)
    if (!out.length || t > out[out.length - 1].t) out.push({ t, w: latest.total_power_w, maxW: latest.total_power_w })
  }
  return out
}

/** Line segments, split wherever readings stop for a while. */
function segments(pts: Point[]): Point[][] {
  const out: Point[][] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && p.t - last[last.length - 1].t <= GAP_MS) last.push(p)
    else out.push([p])
  }
  return out
}

const hourOf = (t: number) => Math.floor(istTimeOfDay(t) / HOUR_MS)

/**
 * Power over the last 24 hours, from the 5-minute history plus the latest live reading.
 * The grey step line is this home's usual load for each hour of the day (the average over the
 * earlier days of the 7-day history), so "is this normal?" can be read straight off the chart.
 * Midnight is marked, the peak is labelled, alerts sit on the line as red dots.
 * Hover, or focus and use the arrow keys, for the exact values.
 */
export function PowerCurve({
  buckets,
  latest,
  alerts,
  usualKw,
  now,
  height = 280,
}: {
  buckets: HistoryBucket[]
  latest?: Reading
  alerts: Alert[]
  /** Usual kW for each IST hour 0-23, or null where there is no earlier day to learn from. */
  usualKw: (number | null)[] | null
  now: number
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const pts = points(buckets, latest, now)
  const from = now - SPAN_MS
  const peak = pts.reduce<Point | null>((m, p) => (!m || p.w > m.w ? p : m), null)
  const usualMax = Math.max(0, ...(usualKw ?? []).map((u) => u ?? 0)) * 1000
  const ticks = niceTicks(Math.max(500, peak?.w ?? 0, usualMax) / 1000)
  const top = ticks[ticks.length - 1] * 1000

  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = height - M.top - M.bottom
  const x = (t: number) => M.left + ((t - from) / SPAN_MS) * plotW
  const y = (w: number) => M.top + plotH - (w / top) * plotH
  const base = y(0)

  const segs = segments(pts)
  const line = segs.map((s) => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join('')).join('')
  const area = segs
    .map((s) => `M${x(s[0].t).toFixed(1)},${base}${s.map((p) => `L${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join('')}L${x(s[s.length - 1].t).toFixed(1)},${base}Z`)
    .join('')

  // The usual load as a step per clock hour across the same 24 hours.
  let usualPath = ''
  if (usualKw) {
    let pen = false
    for (let t = istHourStart(from); t < now; t += HOUR_MS) {
      const u = usualKw[hourOf(t)]
      const x0 = x(Math.max(t, from))
      const x1 = x(Math.min(t + HOUR_MS, now))
      if (u === null) {
        pen = false
        continue
      }
      const yy = y(u * 1000).toFixed(1)
      usualPath += `${pen ? 'L' : 'M'}${x0.toFixed(1)},${yy}L${x1.toFixed(1)},${yy}`
      pen = true
    }
  }

  // Clock labels every 3 hours (6 on phones), kept clear of "Now".
  const midnight = istMidnight(now)
  const hourTicks: number[] = []
  for (let t = istHourStart(from) + HOUR_MS; t < now - 50 * 60_000; t += HOUR_MS) {
    const hour = hourOf(t)
    if (hour % (plotW < 520 ? 6 : 3) === 0 && hour !== 0) hourTicks.push(t)
  }

  const nearest = (t: number) => {
    let best = 0
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - t) < Math.abs(pts[best].t - t)) best = i
    return best
  }
  const recent = alerts.filter((a) => Date.parse(a.timestamp) >= from)
  const onLine = recent.map((a) => ({ alert: a, p: pts.length ? pts[nearest(Date.parse(a.timestamp))] : null }))

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (!pts.length) return
    const box = e.currentTarget.getBoundingClientRect()
    setActive(nearest(from + ((e.clientX - box.left) / box.width) * SPAN_MS))
  }

  const a = active !== null ? pts[active] : null
  const aUsual = a && usualKw ? usualKw[hourOf(a.t)] : null
  const aAlerts = a ? recent.filter((al) => Math.abs(Date.parse(al.timestamp) - a.t) <= BUCKET_MS) : []
  const tipRight = a ? x(a.t) > width - 230 : false
  const peakLeft = peak ? x(peak.t) > width - 170 : false
  const label = `Power over the last 24 hours${peak ? `, highest ${kw(peak.w)} kW at ${clock(peak.t)}` : ''}. Use left and right arrows to read it.`

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-small text-muted" aria-hidden="true">
        <span className="flex items-center gap-2">
          <span className="h-[2px] w-4 bg-ink" />
          Power
        </span>
        {usualKw && (
          <span className="flex items-center gap-2">
            <span className="h-[2px] w-4 bg-faint" />
            Usual for that hour, past 7 days
          </span>
        )}
        {recent.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-alert" />
            Alert
          </span>
        )}
      </div>
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {width > 0 && pts.length > 0 && (
          <svg width={width} height={height} className="block overflow-visible motion-safe:animate-appear">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t * 1000)} y2={y(t * 1000)} stroke={t === 0 ? color.edge : color.line} shapeRendering="crispEdges" />
                <text x={M.left - 10} y={y(t * 1000)} dy="0.32em" textAnchor="end" fontSize={12} fill={color.muted} className="tabular-nums">
                  {t === ticks[ticks.length - 1] ? `${t} kW` : t}
                </text>
              </g>
            ))}

            {midnight > from && (
              <g>
                <line x1={x(midnight)} x2={x(midnight)} y1={M.top - 22} y2={base} stroke={color.edge} shapeRendering="crispEdges" />
                <text x={x(midnight) - 8} y={M.top - 12} textAnchor="end" fontSize={12} fill={color.muted}>
                  Yesterday
                </text>
                {/* "Today" needs room right of midnight; just after midnight, "Now" below says it. */}
                {width - x(midnight) > 56 && (
                  <text x={x(midnight) + 8} y={M.top - 12} fontSize={12} fill={color.ink} fontWeight={500}>
                    Today
                  </text>
                )}
              </g>
            )}

            <path d={area} fill={color.ink} fillOpacity={0.045} />
            {usualPath && <path d={usualPath} fill="none" stroke={color.faint} strokeWidth={1.5} strokeLinejoin="round" />}
            <path d={line} fill="none" stroke={color.ink} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

            {peak && (
              <g>
                <circle cx={x(peak.t)} cy={y(peak.w)} r={3} fill={color.ink} />
                <text x={x(peak.t) + (peakLeft ? -8 : 8)} y={y(peak.w) - 8} textAnchor={peakLeft ? 'end' : 'start'} fontSize={12} fill={color.ink}>
                  Highest {kw(peak.w)} kW, {clock(peak.t)}
                </text>
              </g>
            )}

            {onLine.map(({ alert, p }) =>
              p ? <circle key={alert.alert_id} cx={x(p.t)} cy={y(p.w)} r={4.5} fill={color.alert} stroke={color.page} strokeWidth={2} /> : null,
            )}

            {hourTicks.map((t) => (
              <text key={t} x={x(t)} y={height - 8} textAnchor="middle" fontSize={12} fill={color.muted}>
                {hourLabel(t)}
              </text>
            ))}
            <text x={width - M.right} y={height - 8} textAnchor="end" fontSize={12} fill={color.ink} fontWeight={500}>
              Now
            </text>

            {a && (
              <g pointerEvents="none">
                <line x1={x(a.t)} x2={x(a.t)} y1={M.top} y2={base} stroke={color.ink} strokeOpacity={0.25} shapeRendering="crispEdges" />
                <circle cx={x(a.t)} cy={y(a.w)} r={4.5} fill={color.ink} stroke={color.page} strokeWidth={2} />
              </g>
            )}

            <rect
              x={M.left}
              y={0}
              width={plotW}
              height={height}
              fill="transparent"
              tabIndex={0}
              aria-label={label}
              className="outline-none"
              onPointerMove={onMove}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(pts.length - 1)}
              onBlur={() => setActive(null)}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
                if (!step) return
                e.preventDefault()
                setActive((i) => Math.min(pts.length - 1, Math.max(0, (i ?? pts.length - 1) + step * 3)))
              }}
            />
          </svg>
        )}

        {a && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-52 bg-page px-3 py-2 text-small shadow-[0_2px_16px_rgb(0_0_0/0.1)] ring-1 ring-line"
            style={tipRight ? { right: width - x(a.t) + 14 } : { left: x(a.t) + 14 }}
          >
            <p className="flex justify-between gap-3 font-medium tabular-nums">
              <span>{clock(a.t)}</span>
              <span>{power(a.w)}</span>
            </p>
            <dl className="mt-1 space-y-0.5 text-muted tabular-nums">
              {a.maxW > a.w + 1 && (
                <div className="flex justify-between gap-3">
                  <dt>Highest in 5 min</dt>
                  <dd>{power(a.maxW)}</dd>
                </div>
              )}
              {aUsual !== null && (
                <div className="flex justify-between gap-3">
                  <dt>Usual at {hourLabel(a.t)}</dt>
                  <dd>{power(aUsual * 1000)}</dd>
                </div>
              )}
            </dl>
            {aAlerts.map((al) => (
              <p key={al.alert_id} className="mt-1.5 font-medium text-alert">
                {ALERT_TITLE[al.anomaly_type]}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
