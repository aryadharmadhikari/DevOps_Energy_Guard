import { describe, expect, it } from 'vitest'
import { billFor, monthlyBill, projectedUnits, rupeesPerUnit, slabFor, TARIFF } from './tariff'

describe('tariff engine', () => {
  it('charges only the fixed amount for zero units', () => {
    expect(monthlyBill(0)).toBe(TARIFF.fixedPerMonth)
  })

  it('fills each slab before the next one, plus wheeling on every unit', () => {
    const [s1, s2] = TARIFF.slabs
    const bill = billFor(150)
    expect(bill.energy + bill.wheeling).toBeCloseTo(100 * s1.perUnit + 50 * s2.perUnit)
    expect(bill.wheeling).toBeCloseTo(150 * TARIFF.wheelingPerUnit)
    expect(bill.total).toBeCloseTo(bill.fixed + bill.energy + bill.wheeling)
  })

  it('matches the MERC FY 2026-27 order for a 250-unit month', () => {
    // 130 fixed + 100 × 5.56 + 150 × 12.40 (energy + wheeling per unit)
    expect(monthlyBill(250)).toBeCloseTo(2546)
  })

  it('finds the slab a month falls in', () => {
    expect(slabFor(80)).toBe(TARIFF.slabs[0])
    expect(slabFor(300)).toBe(TARIFF.slabs[1])
    expect(slabFor(1200)).toBe(TARIFF.slabs[3])
  })

  it('makes each unit cost more on average as usage grows', () => {
    expect(rupeesPerUnit(800)).toBeGreaterThan(rupeesPerUnit(80))
  })

  it('projects the month at the same daily pace', () => {
    expect(projectedUnits(100, 10, 30)).toBe(300)
  })
})
