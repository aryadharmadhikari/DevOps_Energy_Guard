import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'

// A page section: a short heading (with an optional "i" for the fine print) and an optional
// one-line aside on the right. Space does the grouping.
export function Section({ title, info, aside, children }: { title: string; info?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="inline-flex items-center gap-2 text-lead font-semibold tracking-tight">
          {title}
          {info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}
        </h2>
        {aside && <p className="text-muted tabular-nums">{aside}</p>}
      </div>
      {children}
    </section>
  )
}
