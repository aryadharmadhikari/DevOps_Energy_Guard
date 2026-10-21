import { hourLabel } from './format'

/**
 * How the live load compares with this home's usual load at this hour (the average for the
 * same IST hour over the earlier days of the 7-day history). Null when there is nothing to
 * compare with yet, so the page says nothing rather than guess.
 */
export function vsUsual(watts: number, usualKw: number | null | undefined, now: number) {
  if (usualKw == null || usualKw <= 0.01) return null
  const ratio = watts / (usualKw * 1000)
  const at = hourLabel(now)
  if (ratio >= 1.5) return { ratio, text: `${ratio.toFixed(1)}× what this home usually draws around ${at}.` }
  if (ratio >= 1.15) return { ratio, text: `${Math.round((ratio - 1) * 100)}% more than usual for ${at}.` }
  if (ratio <= 0.85) return { ratio, text: `${Math.round((1 - ratio) * 100)}% less than usual for ${at}.` }
  return { ratio, text: `About usual for ${at}.` }
}
