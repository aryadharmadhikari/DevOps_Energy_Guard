// India has one time zone and no daylight saving, so IST is always UTC + 5:30.
export const IST_OFFSET_MS = 5.5 * 3600_000
export const HOUR_MS = 3600_000
export const DAY_MS = 24 * HOUR_MS

/** Start of today in IST, as a UTC timestamp in ms. */
export function istMidnight(nowMs = Date.now()): number {
  return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS
}

/** Start of the IST clock hour containing this time. */
export function istHourStart(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / HOUR_MS) * HOUR_MS - IST_OFFSET_MS
}

/** Milliseconds since IST midnight for a given time. */
export function istTimeOfDay(ms: number): number {
  return (((ms + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS
}

/** Monday 00:00 IST of the week containing this time. */
export function istWeekStart(nowMs = Date.now()): number {
  const weekday = new Date(nowMs + IST_OFFSET_MS).getUTCDay() // 0 = Sunday
  return istMidnight(nowMs) - ((weekday + 6) % 7) * DAY_MS
}

/** The 1st of this IST month at 00:00 IST, and how many days the month has. */
export function istMonth(nowMs = Date.now()): { start: number; days: number } {
  const ist = new Date(nowMs + IST_OFFSET_MS)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth()
  return { start: Date.UTC(y, m, 1) - IST_OFFSET_MS, days: new Date(Date.UTC(y, m + 1, 0)).getUTCDate() }
}
