import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { Alert } from './contract'
import { keys, upsertAlert } from './queries'

// Shape copied from CONTRACT.md section 4.3.
const base: Alert = {
  alert_id: 42,
  meter_id: 'M1',
  reading_id: 10234,
  timestamp: '2026-10-19T14:00:05Z',
  last_seen_at: '2026-10-19T14:06:40Z',
  occurrence_count: 80,
  anomaly_type: 'high_load_spike',
  severity: 'high',
  score: 0.91,
  total_power_w: 1840.5,
  peak_power_w: 2410.0,
  message: 'High load spike on M1: 1840.5 W',
  status: 'open',
  note: null,
  created_at: '2026-10-19T14:00:06Z',
  updated_at: '2026-10-19T14:06:41Z',
}

function client(lists: [readonly unknown[], Alert[]][]) {
  const qc = new QueryClient()
  for (const [key, list] of lists) qc.setQueryData(key, list)
  return qc
}

describe('upsertAlert (stream "alert" events)', () => {
  it('replaces an alert with the same alert_id after a merge', () => {
    const qc = client([[keys.alerts('M1', 'open'), [base]]])
    upsertAlert(qc, { ...base, occurrence_count: 81, last_seen_at: '2026-10-19T14:06:45Z' })
    const list = qc.getQueryData<Alert[]>(keys.alerts('M1', 'open'))!
    expect(list).toHaveLength(1)
    expect(list[0].occurrence_count).toBe(81)
  })

  it('puts a new alert first, newest last_seen_at first', () => {
    const qc = client([[keys.alerts('M1'), [base]]])
    upsertAlert(qc, { ...base, alert_id: 43, last_seen_at: '2026-10-19T15:00:00Z' })
    expect(qc.getQueryData<Alert[]>(keys.alerts('M1'))!.map((a) => a.alert_id)).toEqual([43, 42])
  })

  it('drops an acknowledged alert from the open list but keeps it in the full list', () => {
    const qc = client([
      [keys.alerts('M1', 'open'), [base]],
      [keys.alerts('M1'), [base]],
    ])
    upsertAlert(qc, { ...base, status: 'acknowledged' })
    expect(qc.getQueryData<Alert[]>(keys.alerts('M1', 'open'))).toEqual([])
    expect(qc.getQueryData<Alert[]>(keys.alerts('M1'))![0].status).toBe('acknowledged')
  })

  it('leaves other meters alone', () => {
    const qc = client([[keys.alerts('M2', 'open'), []]])
    upsertAlert(qc, base)
    expect(qc.getQueryData<Alert[]>(keys.alerts('M2', 'open'))).toEqual([])
  })
})
