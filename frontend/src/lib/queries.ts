import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Alert, AlertStatus, Range } from './contract'

export const keys = {
  meters: ['meters'] as const,
  latest: (meterId: string) => ['latest', meterId] as const,
  history: (meterId: string, range: Range) => ['history', meterId, range] as const,
  alerts: (meterId: string | undefined, status?: AlertStatus) => ['alerts', meterId ?? 'all', status ?? 'any'] as const,
}

export function useMeters() {
  return useQuery({
    queryKey: keys.meters,
    queryFn: api.meters,
    staleTime: 5 * 60_000,
    // A fresh database has no meters until the simulator sends its first reading.
    refetchInterval: (query) => (query.state.data?.length ? false : 5000),
  })
}

const newestFirst = (a: Alert, b: Alert) =>
  Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at) || b.alert_id - a.alert_id

/**
 * Put a new or changed alert (from the stream) into every cached alert list,
 * replacing the one with the same alert_id (contract section 5). Lists keep the
 * backend's order, and a list filtered by status drops alerts that left it.
 */
export function upsertAlert(qc: QueryClient, alert: Alert) {
  for (const [key, list] of qc.getQueriesData<Alert[]>({ queryKey: ['alerts'] })) {
    if (!list) continue
    const [, meter, status] = key
    if (meter !== 'all' && meter !== alert.meter_id) continue
    const others = list.filter((a) => a.alert_id !== alert.alert_id)
    const belongs = status === 'any' || status === alert.status
    qc.setQueryData(key, belongs ? [alert, ...others].sort(newestFirst) : others)
  }
}

/** The stream doesn't replay missed events, so after a gap everything is fetched again. */
export function refreshSnapshots(qc: QueryClient, meterId: string) {
  qc.invalidateQueries({ queryKey: keys.latest(meterId) })
  qc.invalidateQueries({ queryKey: ['history', meterId] })
  qc.invalidateQueries({ queryKey: ['alerts'] })
}

// Kept fresh by the live stream (see useLiveStream); this only loads the first value.
export function useLatest(meterId: string) {
  return useQuery({ queryKey: keys.latest(meterId), queryFn: () => api.latest(meterId), staleTime: Infinity })
}

const HISTORY_REFRESH: Record<Range, number> = { '24h': 60_000, '7d': 10 * 60_000, '30d': 30 * 60_000 }

export function useHistory(meterId: string, range: Range) {
  return useQuery({
    queryKey: keys.history(meterId, range),
    queryFn: () => api.history(meterId, range),
    refetchInterval: HISTORY_REFRESH[range],
  })
}

export function useAlerts(meterId: string | undefined, status?: AlertStatus, enabled = true) {
  return useQuery({ queryKey: keys.alerts(meterId, status), queryFn: () => api.alerts({ meterId, status }), enabled })
}

/** Every alert for a meter (any status), for charts and the Alerts page. */
export function useAllAlerts(meterId: string) {
  return useQuery({
    queryKey: keys.alerts(meterId),
    queryFn: () => api.alerts({ meterId, limit: 500 }),
    refetchInterval: 60_000,
  })
}

export function useUpdateAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ alert, status }: { alert: Alert; status: 'acknowledged' | 'false_alarm' }) =>
      api.updateAlert(alert.alert_id, status),
    // Take the alert off "open" lists straight away; the server confirms a moment later.
    onMutate: async ({ alert, status }) => {
      await qc.cancelQueries({ queryKey: ['alerts'] })
      const snapshots = qc.getQueriesData<Alert[]>({ queryKey: ['alerts'] })
      for (const [key, list] of snapshots) {
        if (!list) continue
        if (key[2] === 'open') qc.setQueryData(key, list.filter((a) => a.alert_id !== alert.alert_id))
        if (key[2] === 'any') qc.setQueryData(key, list.map((a) => (a.alert_id === alert.alert_id ? { ...a, status } : a)))
      }
      return { snapshots }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, list] of ctx?.snapshots ?? []) qc.setQueryData(key, list)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}
