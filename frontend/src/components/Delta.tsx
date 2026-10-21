// "↓ 22% less than yesterday by now". Less is green, more is amber: worth a look, not an alarm
// (red is kept for alerts). The arrow and the words carry the meaning too, not only the colour.
export function Delta({ change, suffix }: { change: number | null; suffix: string }) {
  if (change === null) return null
  if (Math.abs(change) < 3) return <span className="text-soft">About the same as {suffix}</span>
  const less = change < 0
  return (
    <span className={`font-medium ${less ? 'text-good' : 'text-warn'}`}>
      <span aria-hidden="true">{less ? '↓' : '↑'} </span>
      {Math.abs(change)}% {less ? 'less' : 'more'} than {suffix}
    </span>
  )
}
