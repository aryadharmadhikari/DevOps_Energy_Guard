import { useEffect, useState } from 'react'

/** Current time that refreshes on an interval, so "still going" and charts stay current. */
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
