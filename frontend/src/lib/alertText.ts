import type { Alert } from './contract'
import { clock, duration, kw } from './format'

// Users never see code names like "high_load_spike".
export const ALERT_TITLE: Record<Alert['anomaly_type'], string> = {
  high_load_spike: 'Unusually high load',
  baseload_leakage: 'High usage at night',
  voltage_fluctuation: 'Voltage out of safe range',
  statistical_outlier: 'Unusual usage pattern',
}

export const STATUS_TEXT: Record<Alert['status'], string> = { open: 'Open', acknowledged: 'Acknowledged', false_alarm: 'False alarm' }

export const SEVERITY_LABEL: Record<Alert['severity'], string> = { high: 'High', medium: 'Medium', low: 'Low' }

/** An alert counts as ongoing if the last abnormal reading was within 2 minutes. */
export const isOngoing = (a: Alert, now = Date.now()) => now - Date.parse(a.last_seen_at) < 2 * 60_000

/**
 * How long a finished alert lasted: "20 sec", "2 hr 10 min".
 * A single abnormal reading has no length (backfill alerts are often one reading), so say that instead of "0 sec".
 */
export const lastedText = (a: Alert) =>
  a.occurrence_count === 1 ? 'One reading' : duration(Date.parse(a.last_seen_at) - Date.parse(a.timestamp))

/** The one-sentence status at the top of the Overview, written from the newest open alert. */
export function statusSentence(open: Alert[], now = Date.now()): string {
  if (open.length === 0) return 'Everything looks normal. No problems detected.'
  const a = open[0]
  const start = clock(Date.parse(a.timestamp))
  const ongoing = isOngoing(a, now)
  let lead: string
  switch (a.anomaly_type) {
    case 'high_load_spike':
      lead = ongoing ? `Usage jumped at ${start} and is still high.` : `Usage jumped at ${start}.`
      break
    case 'baseload_leakage':
      lead = ongoing ? `Usage has stayed high since ${start}, when it should be low.` : `Usage stayed high overnight from ${start}.`
      break
    case 'voltage_fluctuation':
      lead = ongoing ? `Voltage has been out of the safe range since ${start}.` : `Voltage went out of the safe range at ${start}.`
      break
    default:
      lead = `Usage looked unusual at ${start}.`
  }
  const others = open.length - 1
  if (others === 0) return lead
  return `${lead} ${others === 1 ? 'One more alert needs' : `${others} more alerts need`} a look.`
}

/** "Started 8:01 PM, still going, peak 3.17 kW" */
export function alertDetail(a: Alert, now = Date.now()): string {
  const started = Date.parse(a.timestamp)
  const lasted = isOngoing(a, now) ? 'still going' : a.occurrence_count === 1 ? 'one reading' : `lasted ${lastedText(a)}`
  const peak = a.anomaly_type === 'voltage_fluctuation' ? '' : `, peak ${kw(a.peak_power_w)} kW`
  return `Started ${clock(started)}, ${lasted}${peak}`
}

/** The line under the status headline: what's happening now, without repeating the start time. */
export function bannerDetail(a: Alert, now = Date.now()): string {
  const sev = a.severity === 'high' ? 'High severity' : a.severity === 'medium' ? 'Medium severity' : 'Low severity'
  const peak = a.anomaly_type === 'voltage_fluctuation' ? '' : `, peak so far ${kw(a.peak_power_w)} kW`
  const time = isOngoing(a, now)
    ? `Going on for ${duration(now - Date.parse(a.timestamp))}`
    : a.occurrence_count === 1
      ? 'One abnormal reading'
      : `Lasted ${lastedText(a)}`
  return `${sev}. ${time}${peak}.`
}

/** A one-line explanation of each alert type, in plain words. */
export const ALERT_EXPLAIN: Record<Alert['anomaly_type'], string> = {
  high_load_spike: 'Power went well above this home’s normal range.',
  baseload_leakage: 'Something kept drawing power when the home is usually quiet.',
  voltage_fluctuation: 'Supply voltage left the safe range (207 to 253 V).',
  statistical_outlier: 'Usage followed a pattern unlike this home’s usual days.',
}

/** Notes written by the system are shown in words people understand. */
export const noteText = (note: string | null) => (note === 'backfill' ? 'From past records' : note)
