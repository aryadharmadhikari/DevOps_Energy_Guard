import { Link, NavLink, Outlet } from 'react-router'
import { CountBadge } from '../components/CountBadge'
import { ConnectionNotice } from '../components/LiveStatus'
import { Logo } from '../components/Logo'
import { MeterSelect } from '../components/MeterSelect'
import { Toaster } from '../components/Toaster'
import { WaitingForData } from '../components/WaitingForData'
import { useMeter } from '../lib/meters'
import { useAlerts } from '../lib/queries'
import { TARIFF } from '../lib/tariff'
import { useLiveStream } from '../lib/useLiveStream'

const TABS = [
  { to: '/', label: 'Now', end: true },
  { to: '/usage', label: 'Usage', end: false },
  { to: '/alerts', label: 'Alerts', end: false },
]

/** The page links. The current page is ink with a bar that sits on the header's bottom line. */
function Nav({ openCount, className }: { openCount: number; className: string }) {
  return (
    <nav aria-label="Main" className={`items-stretch justify-center gap-8 ${className}`}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            [
              'relative flex items-center gap-2 font-medium transition-colors',
              'after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:transition-colors',
              isActive ? 'text-ink after:bg-ink' : 'text-muted after:bg-transparent hover:text-ink',
            ].join(' ')
          }
        >
          {tab.label}
          {tab.to === '/alerts' && <CountBadge count={openCount} label="open" />}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { meterId, status } = useMeter()
  const streamStatus = useLiveStream(meterId, status === 'ready')
  const openCount = useAlerts(meterId, 'open', status === 'ready').data?.length ?? 0

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <header className="border-b border-line">
        {/* Name on the left, pages in the true centre, home on the right; all on the page grid. */}
        <div className="mx-auto grid h-16 max-w-page grid-cols-[1fr_auto] items-center gap-6 px-5 sm:grid-cols-[1fr_auto_1fr] sm:px-8">
          <Link to="/" aria-label="EnergyGuard, now" className="justify-self-start">
            <Logo />
          </Link>
          <Nav openCount={openCount} className="hidden h-full sm:flex" />
          <div className="justify-self-end">
            <MeterSelect />
          </div>
        </div>
        {/* Phones: the pages get their own row under the name. */}
        <Nav openCount={openCount} className="flex h-11 border-t border-line sm:hidden" />
      </header>

      <ConnectionNotice status={streamStatus} />

      <main id="main" className="mx-auto w-full max-w-page flex-1 px-5 pt-10 pb-24 sm:px-8 sm:pt-12">
        {status === 'empty' ? <WaitingForData /> : <Outlet context={streamStatus} />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-page space-y-1 px-5 py-6 text-small text-muted sm:px-8">
          <p>
            Times are in IST. Units come from the meter readings. Rupee amounts are estimates from {TARIFF.name} rates from{' '}
            {TARIFF.validFrom} ({TARIFF.source}), without electricity duty, tax on sale or the fuel adjustment charge.
          </p>
        </div>
      </footer>

      <Toaster />
    </div>
  )
}
