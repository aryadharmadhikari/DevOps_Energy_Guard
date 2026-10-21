import { describe, expect, it } from 'vitest'
import { duration, kw, kwh, percentChange } from './format'
import { istHourStart, istMidnight, istMonth, istTimeOfDay, istWeekStart } from './time'

const iso = (ms: number) => new Date(ms).toISOString()

describe('IST helpers (timestamps are UTC, screen is IST)', () => {
  it('finds IST midnight for a UTC time late in the IST day', () => {
    // 2026-10-19 23:30 IST
    expect(iso(istMidnight(Date.parse('2026-10-19T18:00:00Z')))).toBe('2026-10-18T18:30:00.000Z')
  })

  it('moves to the next IST day at 18:30 UTC', () => {
    expect(iso(istMidnight(Date.parse('2026-10-19T18:30:00Z')))).toBe('2026-10-19T18:30:00.000Z')
  })

  it('starts IST hours at :30 UTC', () => {
    expect(iso(istHourStart(Date.parse('2026-10-19T08:10:00Z')))).toBe('2026-10-19T07:30:00.000Z')
  })

  it('gives time of day in IST', () => {
    expect(istTimeOfDay(Date.parse('2026-10-19T00:00:00Z'))).toBe(5.5 * 3600_000)
  })

  it('starts the week on Monday, IST', () => {
    // Wed 21 Oct 2026, 10:00 IST -> Mon 19 Oct 00:00 IST
    expect(iso(istWeekStart(Date.parse('2026-10-21T04:30:00Z')))).toBe('2026-10-18T18:30:00.000Z')
  })

  it('uses the IST calendar for the month', () => {
    // 31 Oct 20:00 UTC is already 1 Nov in India; November has 30 days.
    const m = istMonth(Date.parse('2026-10-31T20:00:00Z'))
    expect(iso(m.start)).toBe('2026-10-31T18:30:00.000Z')
    expect(m.days).toBe(30)
  })
})

describe('format', () => {
  it('shows watts as kW', () => expect(kw(1840.5)).toBe('1.84'))
  it('uses fewer kWh decimals as numbers grow', () => expect([kwh(2.137), kwh(46.54), kwh(933.4)]).toEqual(['2.14', '46.5', '933']))
  it('writes durations in words', () => expect(duration(130 * 60_000)).toBe('2 hr 10 min'))
  it('has no percentage without a previous value', () => expect(percentChange(5, 0)).toBeNull())
})
