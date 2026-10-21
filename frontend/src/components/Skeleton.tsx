// A still placeholder in the shape of what's coming, so nothing jumps when data arrives.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-sm bg-wash ${className}`} />
}
