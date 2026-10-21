import { createContext, useContext } from 'react'

/**
 * loading: meter list not fetched yet.
 * empty:   the backend is up but no meter has sent a reading (fresh database).
 * ready:   meterId is a meter the backend knows.
 */
export type MeterStatus = 'loading' | 'empty' | 'ready'

export type MeterContextValue = { meterId: string; setMeterId: (id: string) => void; status: MeterStatus }

export const MeterContext = createContext<MeterContextValue | null>(null)

export function useMeter() {
  const value = useContext(MeterContext)
  if (!value) throw new Error('useMeter must be used inside <MeterProvider>')
  return value
}
