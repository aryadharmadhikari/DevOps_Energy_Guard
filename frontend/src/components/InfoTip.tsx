import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const WIDTH = 272
const GUTTER = 16

/**
 * A small "i" next to a label. Extra detail lives here instead of on the page: it opens on
 * hover, keyboard focus or a tap, and closes on Escape or a click elsewhere. The note is
 * placed under the icon and kept inside the screen.
 */
export function InfoTip({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    const left = Math.min(Math.max(GUTTER, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - GUTTER)
    setPos({ top: r.bottom + 8, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => {
      setOpen(false)
      setPinned(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => !button.current?.contains(e.target as Node) && close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          // A click (or tap) keeps the note open until the next click; hover alone does not.
          setPinned(!pinned)
          setOpen(!pinned)
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        className="relative inline-flex size-3.5 shrink-0 items-center justify-center rounded-full align-middle text-muted ring-1 ring-faint transition-colors ring-inset before:absolute before:-inset-1.5 hover:text-ink hover:ring-ink aria-expanded:text-ink aria-expanded:ring-ink"
      >
        <svg viewBox="0 0 16 16" className="size-2.5" aria-hidden="true">
          <circle cx="8" cy="4.2" r="1.4" fill="currentColor" />
          <path d="M8 7.6v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && pos && (
        <span
          id={id}
          role="tooltip"
          className="fixed z-50 block bg-ink px-3.5 py-2.5 text-left text-small font-normal tracking-normal text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)] motion-safe:animate-pop"
          style={{ top: pos.top, left: pos.left, width: WIDTH }}
        >
          {children}
        </span>
      )}
    </>
  )
}
