import type { HistoryBucket } from './contract'
import { monthlyBill, projectedUnits, rupeesPerUnit } from './tariff'
import { DAY_MS, HOUR_MS, istHourStart, istMidnight, istMonth, istWeekStart } from './time'

// History buckets are UTC-aligned (contract 4.4). People read IST hours and days, and the
// 7d / 30d buckets start at :30 and 5:30 AM IST, so energy is spread over IST slots by time.

export const BUCKET_MS = { '24h': 5 * 60_000, '7d': HOUR_MS, '30d': DAY_MS } as const

/** One IST hour or day. */
export type Slot = {
  start: number
  kwh: number
  peakW: number | null
  peakAt: number | null
  alerts: number
  hasData: boolean
}

export const emptySlot = (start: number): Slot => ({
  start,
  kwh: 0,
  peakW: null,
  peakAt: null,
  alerts: 0,
  hasData: false,
})

/**
 * Sum buckets into IST hours or days. Each bucket's energy is shared between the slots it
 * overlaps, in proportion to time. The current bucket only covers time up to now (the backend
 * counts elapsed time only). Alert counts and peaks can't be split, so they go to the slot
 * where the bucket starts.
 */
export function aggregate(buckets: HistoryBucket[], sizeMs: number, unit: 'hour' | 'day', now = Date.now()) {
  const unitMs = unit === 'hour' ? HOUR_MS : DAY_MS
  const startOf = unit === 'hour' ? istHourStart : istMidnight
  const slots = new Map<number, Slot>()
  const slotAt = (start: number) => {
    let slot = slots.get(start)
    if (!slot) slots.set(start, (slot = emptySlot(start)))
    return slot
  }

  for (const b of buckets) {
    if (b.energy_kwh === null) continue
    const from = Date.parse(b.bucket_start)
    const to = Math.max(from + 1, Math.min(from + sizeMs, now))
    for (let s = startOf(from); s < to; s += unitMs) {
      const share = (Math.min(to, s + unitMs) - Math.max(from, s)) / (to - from)
      if (share <= 0) continue
      const slot = slotAt(s)
      slot.hasData = true
      slot.kwh += b.energy_kwh * share
    }
    const first = slotAt(startOf(from))
    first.alerts += b.alert_count ?? 0
    if (b.max_power_w !== null && (first.peakW === null || b.max_power_w > first.peakW)) {
      first.peakW = b.max_power_w
      first.peakAt = from
    }
  }
  return slots
}

/** Add slots together (a period's total). */
export function total(slots: Slot[]): Slot {
  const sum = emptySlot(slots[0]?.start ?? 0)
  for (const s of slots) {
    if (!s.hasData) continue
    sum.hasData = true
    sum.kwh += s.kwh
    sum.alerts += s.alerts
    if (s.peakW !== null && (sum.peakW === null || s.peakW > sum.peakW)) {
      sum.peakW = s.peakW
      sum.peakAt = s.peakAt
    }
  }
  return sum
}

/** Today's 24 IST hours, from the 5-minute buckets. */
export function todayHours(h24: HistoryBucket[], now = Date.now()): Slot[] {
  const slots = aggregate(h24, BUCKET_MS['24h'], 'hour', now)
  const midnight = istMidnight(now)
  return Array.from({ length: 24 }, (_, i) => slots.get(midnight + i * HOUR_MS) ?? emptySlot(midnight + i * HOUR_MS))
}

/** A usual day: average kWh for each IST hour over the earlier days of the 7-day history. */
export function usualHours(h7: HistoryBucket[], now = Date.now()): (number | null)[] {
  const midnight = istMidnight(now)
  const firstFull = h7.length ? istHourStart(Date.parse(h7[0].bucket_start)) + HOUR_MS : midnight
  const sums = Array.from({ length: 24 }, () => ({ kwh: 0, days: 0 }))
  for (const slot of aggregate(h7, BUCKET_MS['7d'], 'hour', now).values()) {
    if (!slot.hasData || slot.start < firstFull || slot.start >= midnight) continue
    const hour = Math.round((slot.start - istMidnight(slot.start)) / HOUR_MS)
    sums[hour].kwh += slot.kwh
    sums[hour].days += 1
  }
  return sums.map((s) => (s.days ? s.kwh / s.days : null))
}

/** Today up to the start of this hour, and yesterday up to the same time: a fair comparison. */
export function todayVsYesterday(h24: HistoryBucket[], h7: HistoryBucket[], now = Date.now()) {
  const cutoff = istHourStart(now)
  const midnight = istMidnight(now)
  if (cutoff === midnight) return null
  const today = todayHours(h24, now).filter((s) => s.start < cutoff)
  const yesterday = [...aggregate(h7, BUCKET_MS['7d'], 'hour', now).values()].filter(
    (s) => s.start >= midnight - DAY_MS && s.start < cutoff - DAY_MS,
  )
  return { today: total(today).kwh, yesterday: total(yesterday).kwh }
}

export type Day = Slot & { isToday: boolean; isFuture: boolean }

function days(from: number, count: number, slots: Map<number, Slot>, today: Slot, now: number): Day[] {
  const midnight = istMidnight(now)
  return Array.from({ length: count }, (_, i) => {
    const start = from + i * DAY_MS
    // Today always comes from the 5-minute buckets, so it matches the Overview to the decimal.
    const slot = start === midnight ? { ...today, start } : (slots.get(start) ?? emptySlot(start))
    return { ...slot, isToday: start === midnight, isFuture: start > midnight }
  })
}

/** Monday to Sunday of this week. */
export function weekDays(h7: HistoryBucket[], h24: HistoryBucket[], now = Date.now()): Day[] {
  const slots = aggregate(h7, BUCKET_MS['7d'], 'day', now)
  return days(istWeekStart(now), 7, slots, total(todayHours(h24, now)), now)
}

/** Every day of this calendar month (IST). */
export function monthDays(h30: HistoryBucket[], h24: HistoryBucket[], now = Date.now()): Day[] {
  const { start, days: count } = istMonth(now)
  const slots = aggregate(h30, BUCKET_MS['30d'], 'day', now)
  return days(start, count, slots, total(todayHours(h24, now)), now)
}

/** The same weekdays of last week, up to the same time, from the 30-day history. */
export function lastWeekSoFar(h30: HistoryBucket[], now = Date.now()): number | null {
  const weekStart = istWeekStart(now)
  const slots = [...aggregate(h30, BUCKET_MS['30d'], 'day', now).values()].filter(
    (s) => s.start >= weekStart - 7 * DAY_MS && s.start < istMidnight(now) - 7 * DAY_MS,
  )
  return slots.some((s) => s.hasData) ? total(slots).kwh : null
}

/**
 * This month in units and rupees: used so far, the whole month at the same pace, and what
 * one unit costs at that level (so every ₹ figure on screen adds up to the same bill).
 */
export function monthOutlook(h30: HistoryBucket[], h24: HistoryBucket[], now = Date.now()) {
  const { start, days: daysInMonth } = istMonth(now)
  const sofar = total(monthDays(h30, h24, now).filter((d) => !d.isFuture)).kwh
  const projected = projectedUnits(sofar, (now - start) / DAY_MS, daysInMonth)
  return { kwh: sofar, projectedKwh: projected, projectedBill: monthlyBill(projected), rate: rupeesPerUnit(projected) }
}

/** Every IST hour since Monday 00:00, from the hourly history, with today from the 5-minute data. */
export function weekHours(h7: HistoryBucket[], h24: HistoryBucket[], now = Date.now()): Slot[] {
  const midnight = istMidnight(now)
  const earlier = [...aggregate(h7, BUCKET_MS['7d'], 'hour', now).values()].filter((s) => s.start >= istWeekStart(now) && s.start < midnight)
  return [...earlier, ...todayHours(h24, now).filter((s) => s.start <= now)].sort((a, b) => a.start - b.start)
}

export const PARTS_OF_DAY = [
  { label: 'Night', hours: '12 AM to 6 AM', from: 0 },
  { label: 'Morning', hours: '6 AM to 12 PM', from: 6 },
  { label: 'Afternoon', hours: '12 PM to 6 PM', from: 12 },
  { label: 'Evening', hours: '6 PM to 12 AM', from: 18 },
] as const

/** Energy by part of the day (IST), from hourly slots: when in the day the units go. */
export function partsOfDay(hours: Slot[]) {
  const parts = PARTS_OF_DAY.map((p) => ({ ...p, kwh: 0, hasData: false }))
  for (const s of hours) {
    if (!s.hasData) continue
    const hour = Math.floor((s.start - istMidnight(s.start)) / HOUR_MS)
    const part = parts[Math.floor(hour / 6)]
    part.kwh += s.kwh
    part.hasData = true
  }
  return parts
}

/**
 * One IST day's 24 hours. Today comes from the 5-minute data; earlier days from the hourly
 * history, which reaches back 7 days. Null for a day older than that, where only the daily
 * total is kept.
 */
export function dayHours(h7: HistoryBucket[], h24: HistoryBucket[], dayStart: number, now = Date.now()): Slot[] | null {
  if (dayStart === istMidnight(now)) return todayHours(h24, now)
  const firstHour = h7.length ? Date.parse(h7[0].bucket_start) : Infinity
  if (dayStart + HOUR_MS < firstHour) return null
  const slots = aggregate(h7, BUCKET_MS['7d'], 'hour', now)
  return Array.from({ length: 24 }, (_, i) => slots.get(dayStart + i * HOUR_MS) ?? emptySlot(dayStart + i * HOUR_MS))
}
