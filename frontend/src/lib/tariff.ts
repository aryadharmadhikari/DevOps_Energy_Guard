// Tariff engine (contract section 1: part of the dashboard).
// A monthly bill is slab-based: the first 100 units are cheapest, each slab above costs more.

/**
 * MSEDCL LT I(B) residential, single phase, FY 2026-27 (from 1 April 2026).
 * Source: MERC Order in Case No. 75 of 2025, Annexure II, "Summary of LT Tariff for
 * FY 2026-27", page 53. Every unit pays its slab's "total variable charge": the energy charge plus
 * the wheeling charge. The order prints the energy charge rounded (15.03 + 1.60 shows as 16.64),
 * so the printed totals are used and the energy line is the total minus wheeling.
 *
 * Not included, because they are not in the tariff order or change every month:
 * electricity duty, tax on sale of electricity, and the fuel adjustment charge (FAC).
 */
export const TARIFF = {
  name: 'MSEDCL residential',
  source: 'MERC order, Case 75 of 2025',
  validFrom: 'April 2026',
  fixedPerMonth: 130,
  wheelingPerUnit: 1.6,
  slabs: [
    { upToUnits: 100, perUnit: 5.56 },
    { upToUnits: 300, perUnit: 12.4 },
    { upToUnits: 500, perUnit: 16.64 },
    { upToUnits: Infinity, perUnit: 19.13 },
  ],
}

/** What one unit in a slab costs: energy charge plus wheeling charge. */
export const slabRate = (slab: (typeof TARIFF.slabs)[number]) => slab.perUnit

/** The slab a month's units fall in. */
export const slabFor = (units: number) => TARIFF.slabs.find((s) => units <= s.upToUnits) ?? TARIFF.slabs[TARIFF.slabs.length - 1]

/** A month's tariff charges, line by line, as they appear on the bill. */
export function billFor(units: number) {
  let variable = 0
  let from = 0
  for (const slab of TARIFF.slabs) {
    if (units <= from) break
    variable += (Math.min(units, slab.upToUnits) - from) * slab.perUnit
    from = slab.upToUnits
  }
  const wheeling = Math.max(0, units) * TARIFF.wheelingPerUnit
  const energy = variable - wheeling
  return { fixed: TARIFF.fixedPerMonth, energy, wheeling, total: TARIFF.fixedPerMonth + energy + wheeling }
}

/** The bill for one month's units (1 unit = 1 kWh): fixed charge plus each slab's share. */
export const monthlyBill = (units: number) => billFor(units).total

/**
 * What a unit costs on average this month, without the fixed charge. Used to put a ₹ figure
 * next to an hour or a day, so the parts add up to the month's per-unit charges.
 */
export function rupeesPerUnit(monthUnits: number): number {
  if (monthUnits <= 0) return slabRate(TARIFF.slabs[0])
  return (monthlyBill(monthUnits) - TARIFF.fixedPerMonth) / monthUnits
}

/** Units this month so far, scaled up to the whole month at the same daily pace. */
export function projectedUnits(unitsSoFar: number, daysElapsed: number, daysInMonth: number): number {
  return daysElapsed > 0 ? (unitsSoFar / daysElapsed) * daysInMonth : 0
}
