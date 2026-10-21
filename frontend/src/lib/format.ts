// Every number on screen goes through here, so units and style stay consistent.
// Indian conventions: lakh grouping (₹1,09,000), 12-hour IST times.

const TZ = 'Asia/Kolkata'

const kwFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const kwhFormats = [2, 1, 0].map((digits) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }))
const rupeeFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const timeFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
const hourFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', hour12: true })
const dayFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' })
const monthFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, month: 'long', year: 'numeric' })

export const kw = (watts: number) => kwFormat.format(watts / 1000)
/** Fewer decimals as numbers grow: "2.14", "46.5", "933". */
export const kwh = (value: number) => kwhFormats[value < 10 ? 0 : value < 100 ? 1 : 2].format(value)
export const rupees = (value: number) => (value > 0 && value < 1 ? 'under ₹1' : rupeeFormat.format(value))
/** "780 W" below a kilowatt, "1.09 kW" above. */
export const power = (watts: number) => (watts < 1000 ? `${Math.round(watts)} W` : `${kw(watts)} kW`)
/** A price per unit as on a tariff card: "₹11", "₹5.50". */
export const rupeeRate = (r: number) => `₹${Number.isInteger(r) ? r : r.toFixed(2)}`
/** Whole units with lakh grouping, as on an electricity bill: "1,413". */
export const units = (value: number) => kwhFormats[2].format(value)
/** "October 2026" */
export const monthName = (ms: number) => monthFormat.format(ms)
/** "2 PM to 3 PM" */
export const hourRange = (ms: number) => `${hourFormat.format(ms).toUpperCase()} to ${hourFormat.format(ms + 3600_000).toUpperCase()}`

/** "7:42 pm" → "7:42 PM" */
export const clock = (ms: number) => timeFormat.format(ms).toUpperCase()
/** "3 pm" → "3 PM" */
export const hourLabel = (ms: number) => hourFormat.format(ms).toUpperCase()
/** "1 Oct" */
export const shortDay = (ms: number) => dayFormat.format(ms)

/** "45 sec", "6 min", "2 hr 10 min" */
export function duration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec} sec`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/** "just now", "4 min ago", "3 hr ago", "2 days ago" */
export function ago(ms: number, now = Date.now()): string {
  const sec = Math.round((now - ms) / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

const weekdayFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric' })
const fullDayFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })

/** "Mon 13" */
export const weekdayDay = (ms: number) => weekdayFormat.format(ms)
/** "Mon, 13 Oct" */
export const fullDay = (ms: number) => fullDayFormat.format(ms)

/** "Today, 8:01 PM" / "Yesterday, 2:15 AM" / "15 Oct, 1:02 AM" */
export function dayAndTime(ms: number, now = Date.now()): string {
  const offset = 5.5 * 3600_000
  const day = 24 * 3600_000
  const dayIndex = (t: number) => Math.floor((t + offset) / day)
  const diff = dayIndex(now) - dayIndex(ms)
  const prefix = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : shortDay(ms)
  return `${prefix}, ${clock(ms)}`
}

/** Percentage change as a whole number, or null when there's nothing to compare. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 100)
}
