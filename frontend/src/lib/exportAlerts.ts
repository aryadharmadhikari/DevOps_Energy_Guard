import { ALERT_TITLE, lastedText, noteText } from './alertText'
import type { Alert } from './contract'

const TZ = 'Asia/Kolkata'
const stamp = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const when = (ms: number) => stamp.format(ms).replace(/\b(am|pm)\b/, (m) => m.toUpperCase())

const STATUS = { open: 'Open', acknowledged: 'Acknowledged', false_alarm: 'False alarm' } as const
const SEVERITY = { high: 'High', medium: 'Medium', low: 'Low' } as const

function rows(alerts: Alert[]) {
  return alerts.map((a) => [
    when(Date.parse(a.timestamp)),
    ALERT_TITLE[a.anomaly_type],
    SEVERITY[a.severity],
    lastedText(a),
    a.anomaly_type === 'voltage_fluctuation' ? '' : (a.peak_power_w / 1000).toFixed(2),
    STATUS[a.status],
    noteText(a.note) ?? '',
  ])
}

const HEADER = ['Started (IST)', 'What happened', 'Severity', 'Lasted', 'Peak (kW)', 'Status', 'Note']

function fileName(meterName: string, ext: string) {
  const day = new Date().toISOString().slice(0, 10)
  return `energyguard-alerts-${meterName.toLowerCase().replace(/\s+/g, '-')}-${day}.${ext}`
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function exportCsv(alerts: Alert[], meterName: string) {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [HEADER, ...rows(alerts)].map((r) => r.map(escape).join(','))
  // The BOM makes Excel open the file as UTF-8.
  download(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), fileName(meterName, 'csv'))
}

export async function exportPdf(alerts: Alert[], meterName: string, filterLabel: string) {
  // Loaded only when needed, so the dashboard itself stays small.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(`EnergyGuard alerts - ${meterName}`, 40, 48)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(`${filterLabel}, ${alerts.length} alert${alerts.length === 1 ? '' : 's'}. Exported ${when(Date.now())} IST.`, 40, 66)
  autoTable(doc, {
    startY: 84,
    head: [HEADER],
    body: rows(alerts),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: 30 },
    headStyles: { fillColor: [245, 246, 248], textColor: 60, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    margin: { left: 40, right: 40 },
  })
  doc.save(fileName(meterName, 'pdf'))
}
