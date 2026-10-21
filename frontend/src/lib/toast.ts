import type { Alert } from './contract'

// A tiny store for pop-up notifications about new alerts.
export type Toast = { id: number; alert: Alert }

let toasts: Toast[] = []
const listeners = new Set<() => void>()
let nextId = 1

const emit = () => listeners.forEach((l) => l())

export const toastStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => toasts,
  push(alert: Alert) {
    if (toasts.some((t) => t.alert.alert_id === alert.alert_id)) return
    const id = nextId++
    toasts = [...toasts, { id, alert }].slice(-3) // never more than 3 on screen
    emit()
    setTimeout(() => toastStore.dismiss(id), 10_000)
  },
  dismiss(id: number) {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  },
}
