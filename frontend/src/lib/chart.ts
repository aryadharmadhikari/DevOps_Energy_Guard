/** Round axis steps (0.5, 1, 2…) so gridlines land on numbers people read easily. */
export function niceTicks(max: number, target = 4): number[] {
  const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((s) => max / s <= target) ?? 1000
  const top = Math.max(step, Math.ceil(max / step) * step)
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(2))
}
