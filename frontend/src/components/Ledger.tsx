import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'
import { Skeleton } from './Skeleton'

export type LedgerRow = { label: ReactNode; value: ReactNode | undefined; note?: ReactNode; info?: ReactNode; strong?: boolean }

// Label on the left, value on the right, a hairline between rows: how a bill reads.
export function Ledger({ rows }: { rows: LedgerRow[] }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-6 py-3">
          <dt className={r.strong ? 'font-semibold text-ink' : 'text-soft'}>
            <span className="inline-flex items-center gap-1.5">
              {r.label}
              {r.info && <InfoTip label={`About ${typeof r.label === 'string' ? r.label.toLowerCase() : 'this'}`}>{r.info}</InfoTip>}
            </span>
            {r.note && <span className="mt-0.5 block text-small text-muted">{r.note}</span>}
          </dt>
          <dd className={`text-right font-medium tabular-nums ${r.strong ? 'font-semibold' : ''}`}>
            {r.value === undefined ? <Skeleton className="h-5 w-16" /> : r.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
