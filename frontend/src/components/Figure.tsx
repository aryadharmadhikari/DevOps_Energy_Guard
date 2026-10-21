import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'
import { Skeleton } from './Skeleton'

// A key number: what it is, the number, one line of context. No box around it.
export function Figure({ label, value, note, info }: { label: string; value?: ReactNode; note?: ReactNode; info?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="inline-flex items-center gap-1.5 text-soft">
        {label}
        {info && <InfoTip label={`About ${label.toLowerCase()}`}>{info}</InfoTip>}
      </p>
      {value === undefined ? (
        <Skeleton className="mt-2.5 h-10 w-32" />
      ) : (
        <p className="mt-2 text-[2rem] leading-none font-semibold tracking-[-0.035em] whitespace-nowrap motion-safe:animate-appear sm:text-figure">
          {value}
        </p>
      )}
      <p className="mt-2 min-h-[1.4rem] text-muted">{note}</p>
    </div>
  )
}
