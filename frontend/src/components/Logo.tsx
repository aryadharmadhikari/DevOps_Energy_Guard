// The same mark as the browser tab icon (public/favicon.svg): a meter trace on a dark tile.
export function LogoMark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-ink" />
      <path d="M8 20.5h4.2l2.6-9 3.4 12 2.4-7.5H24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">EnergyGuard</span>
    </span>
  )
}
