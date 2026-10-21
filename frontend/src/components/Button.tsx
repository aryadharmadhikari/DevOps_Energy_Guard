import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'text' }

// One shape for every button: a 36px pill. Primary (black) for the one decision on a row,
// outline for secondary actions like downloads, text for the quiet alternative.
const LOOK = {
  primary: 'bg-ink px-4 text-white hover:bg-ink/80',
  outline: 'px-4 text-ink ring-1 ring-edge ring-inset hover:bg-wash',
  text: 'px-2 text-muted hover:text-ink',
}

export function Button({ variant = 'text', className = '', ...props }: Props) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-40 ${LOOK[variant]} ${className}`}
      {...props}
    />
  )
}
