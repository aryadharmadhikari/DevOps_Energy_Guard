import type { Alert, AlertStatus, History, Meter, Range, Reading } from './contract'

// Dev: http://localhost:8000/api/v1. Docker/AWS: /api/v1 behind nginx (contract section 2).
export const API_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      // Only bodies need a type; adding it to GETs makes every request a CORS preflight in dev.
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the server')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, body?.error?.code ?? 'unknown', body?.error?.message ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  meters: () => request<Meter[]>('/meters'),
  latest: (meterId: string) => request<Reading>(`/readings/latest?meter_id=${encodeURIComponent(meterId)}`),
  history: (meterId: string, range: Range) =>
    request<History>(`/readings/history?meter_id=${encodeURIComponent(meterId)}&range=${range}`),
  alerts: (params: { meterId?: string; status?: AlertStatus; limit?: number }) => {
    const q = new URLSearchParams()
    if (params.meterId) q.set('meter_id', params.meterId)
    if (params.status) q.set('status', params.status)
    q.set('limit', String(params.limit ?? 50))
    return request<Alert[]>(`/alerts?${q}`)
  },
  updateAlert: (alertId: number, status: 'acknowledged' | 'false_alarm', note?: string) =>
    request<Alert>(`/alerts/${alertId}`, { method: 'PATCH', body: JSON.stringify({ status, note }) }),
  streamUrl: (meterId: string) => `${API_URL}/stream?meter_id=${encodeURIComponent(meterId)}`,
}
