// Types copied from CONTRACT.md v1.0, section 3 and 4.
// If the contract changes, this file changes first.

export type ApplianceKey = 'ac' | 'fridge' | 'geyser' | 'washing_machine' | 'lighting' | 'fan' | 'tv' | 'other'

export type AnomalyType =
  | 'none'
  | 'baseload_leakage'
  | 'high_load_spike'
  | 'voltage_fluctuation'
  | 'statistical_outlier'

export type Severity = 'low' | 'medium' | 'high'
export type AlertStatus = 'open' | 'acknowledged' | 'false_alarm'
export type Range = '24h' | '7d' | '30d'

export type Reading = {
  reading_id: number
  meter_id: string
  timestamp: string
  total_power_w: number
  voltage_v: number | null
  appliances_w: Record<ApplianceKey, number> // in the contract; not shown in the UI
  sim_label?: string
}

export type AnomalyResult = {
  is_anomaly: boolean
  anomaly_type: AnomalyType
  score: number
  severity: Severity | null
  model_version: string
}

export type Alert = {
  alert_id: number
  meter_id: string
  reading_id: number
  timestamp: string
  last_seen_at: string
  occurrence_count: number
  anomaly_type: Exclude<AnomalyType, 'none'>
  severity: Severity
  score: number
  total_power_w: number
  peak_power_w: number
  message: string
  status: AlertStatus
  note: string | null
  created_at: string
  updated_at: string
}

// Buckets with no readings have every value null, including appliances_kwh and alert_count.
export type HistoryBucket = {
  bucket_start: string
  avg_power_w: number | null
  max_power_w: number | null
  energy_kwh: number | null
  appliances_kwh: Record<ApplianceKey, number> | null
  alert_count: number | null
}

export type History = { meter_id: string; range: Range; buckets: HistoryBucket[] }

export type Meter = { meter_id: string; name: string; last_seen: string | null }

export type ApiErrorBody = { error: { code: string; message: string } }
