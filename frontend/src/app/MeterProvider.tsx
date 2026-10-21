import { useState, type ReactNode } from 'react'
import { MeterContext, type MeterStatus } from '../lib/meters'
import { useMeters } from '../lib/queries'

const STORAGE_KEY = 'energyguard.meter'

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'M1'
  } catch {
    return 'M1' // storage can be blocked in private mode
  }
}

// Remembers which meter the user is looking at, across tabs and reloads.
export function MeterProvider({ children }: { children: ReactNode }) {
  const [meterId, setMeter] = useState(readSaved)
  const { data: meters } = useMeters()

  const setMeterId = (id: string) => {
    setMeter(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Not critical: the choice just won't survive a reload.
    }
  }

  // If the saved meter no longer exists, use the first one instead.
  const current = meters?.length && !meters.some((m) => m.meter_id === meterId) ? meters[0].meter_id : meterId
  const status: MeterStatus = !meters ? 'loading' : meters.length === 0 ? 'empty' : 'ready'

  return <MeterContext.Provider value={{ meterId: current, setMeterId, status }}>{children}</MeterContext.Provider>
}
