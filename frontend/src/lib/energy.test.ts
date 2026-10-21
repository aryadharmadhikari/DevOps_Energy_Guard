import { describe, expect, it } from 'vitest'
import type { HistoryBucket } from './contract'
import { aggregate, dayHours, monthDays, partsOfDay, todayHours, total, usualHours, weekDays } from './energy'
import { DAY_MS, HOUR_MS, istMidnight } from './time'

// Wed 21 Oct 2026, 12:00 IST
const NOW = Date.parse('2026-10-21T06:30:00Z')
const isoZ = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

function bucket(start: number, kwh: number | null, alerts = 0): HistoryBucket {
  if (kwh === null) {
    // Exactly what the real backend sends for a bucket with no readings.
    return { bucket_start: isoZ(start), avg_power_w: null, max_power_w: null, energy_kwh: null, appliances_kwh: null, alert_count: null }
  }
  return {
    bucket_start: isoZ(start),
    avg_power_w: 1000,
    max_power_w: 1500,
    energy_kwh: kwh,
    appliances_kwh: { ac: kwh * 0.75, fridge: kwh * 0.25, geyser: 0, washing_machine: 0, lighting: 0, fan: 0, tv: 0, other: 0 },
    alert_count: alerts,
  }
}

/** Buckets like the backend's: UTC-aligned, the last one containing now. */
function series(sizeMs: number, count: number, kwh: (i: number) => number | null, alerts: (i: number) => number = () => 0) {
  const last = Math.floor(NOW / sizeMs) * sizeMs
  return Array.from({ length: count }, (_, i) => bucket(last - (count - 1 - i) * sizeMs, kwh(i), alerts(i)))
}

describe('aggregate: UTC buckets into IST slots', () => {
  it('splits an hourly bucket that starts at :30 IST across two IST hours', () => {
    const start = Date.parse('2026-10-20T04:00:00Z') // 9:30 IST
    const slots = aggregate([bucket(start, 1)], HOUR_MS, 'hour', NOW)
    expect([...slots.values()].map((s) => s.kwh)).toEqual([0.5, 0.5])
  })

  it('splits a daily bucket 18.5 / 5.5 hours across two IST days', () => {
    const start = Date.parse('2026-10-19T00:00:00Z') // 5:30 IST on the 19th
    const days = [...aggregate([bucket(start, 24)], DAY_MS, 'day', NOW).values()]
    expect(days.map((d) => +d.kwh.toFixed(2))).toEqual([18.5, 5.5])
  })

  it('treats empty buckets as no data, not zero energy', () => {
    const slots = aggregate([bucket(Date.parse('2026-10-20T04:00:00Z'), null)], HOUR_MS, 'hour', NOW)
    expect(slots.size).toBe(0)
  })

  it('adds up energy and alert counts', () => {
    const t = total([...aggregate(series(HOUR_MS, 4, () => 2, () => 1), HOUR_MS, 'hour', NOW).values()])
    expect(t.kwh).toBeCloseTo(8)
    expect(t.alerts).toBe(4)
  })
})

describe('periods', () => {
  it('today has 24 IST hours: data up to and including the current one', () => {
    const hours = todayHours(series(5 * 60_000, 288, () => 0.1), NOW)
    expect(hours).toHaveLength(24)
    expect(hours[0].start).toBe(istMidnight(NOW))
    // 12:00 IST: hours 0-11, plus the 12 PM hour whose first bucket just started.
    expect(hours.filter((h) => h.hasData)).toHaveLength(13)
  })

  it('a usual day only uses earlier days', () => {
    const usual = usualHours(series(HOUR_MS, 168, () => 2), NOW)
    expect(usual).toHaveLength(24)
    expect(usual.every((v) => v !== null && Math.abs(v - 2) < 1e-9)).toBe(true)
  })

  it('the week runs Monday to Sunday and today matches the 5-minute data', () => {
    const h24 = series(5 * 60_000, 288, () => 0.1)
    const week = weekDays(series(HOUR_MS, 168, () => 2), h24, NOW)
    expect(week.map((d) => d.isToday)).toEqual([false, false, true, false, false, false, false])
    expect(week[2].kwh).toBeCloseTo(total(todayHours(h24, NOW)).kwh)
    expect(week.slice(3).every((d) => d.isFuture)).toBe(true)
  })

  it('the month has every calendar day', () => {
    const month = monthDays(series(DAY_MS, 30, () => 40), series(5 * 60_000, 288, () => 0.1), NOW)
    expect(month).toHaveLength(31)
    expect(month[20].isToday).toBe(true)
  })
})

describe('parts of the day', () => {
  it('puts each IST hour in its quarter of the day', () => {
    const parts = partsOfDay(todayHours(series(5 * 60_000, 288, () => 0.1), NOW))
    // 12:00 IST: night and morning are complete (6 h × 1.2 kWh), the afternoon has just begun.
    expect(parts[0].kwh).toBeCloseTo(7.2)
    expect(parts[1].kwh).toBeCloseTo(7.2)
    expect(parts[3].hasData).toBe(false)
  })
})

describe('one day, hour by hour', () => {
  it('gives the 24 hours of an earlier day from the hourly history', () => {
    const yesterday = istMidnight(NOW) - DAY_MS
    const hours = dayHours(series(HOUR_MS, 168, () => 2), series(5 * 60_000, 288, () => 0.1), yesterday, NOW)
    expect(hours).toHaveLength(24)
    expect(hours!.every((h) => h.hasData && Math.abs(h.kwh - 2) < 1e-9)).toBe(true)
  })

  it('has nothing for a day older than the hourly history', () => {
    expect(dayHours(series(HOUR_MS, 168, () => 2), [], istMidnight(NOW) - 10 * DAY_MS, NOW)).toBeNull()
  })
})
