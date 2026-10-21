// A count that sits next to a label: a soft red pill, centred on the text it belongs to.
// Sizes follow the label: "sm" for the navbar, "lg" next to a page title.
export function CountBadge({ count, label, size = 'sm' }: { count: number; label: string; size?: 'sm' | 'lg' }) {
  if (count <= 0) return null
  const look = size === 'lg' ? 'h-6 min-w-6 px-2 text-small' : 'h-[1.125rem] min-w-[1.125rem] px-1.5 text-[0.6875rem]'
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-alert-wash font-semibold tracking-normal text-alert tabular-nums ${look}`}
    >
      {count > 99 ? '99+' : count}
      <span className="sr-only"> {label}</span>
    </span>
  )
}
