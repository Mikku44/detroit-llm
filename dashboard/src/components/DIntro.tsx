import { useEffect, useState } from 'react'

export default function DIntro({ onDone, duration = 3200 }: { onDone: () => void; duration?: number }) {
  const [phase, setPhase] = useState<'glow' | 'zoom' | 'flash'>('glow')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('zoom'), 1000)
    const t2 = setTimeout(() => setPhase('flash'), 2300)
    const t3 = setTimeout(onDone, duration)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [onDone, duration])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black">
      {/* spreading glow dot */}
      <div
        className="absolute rounded-full"
        style={{
          width: 12,
          height: 12,
          background: 'var(--primary-color)',
          boxShadow: '0 0 60px 20px var(--primary-color)',
          opacity: phase === 'glow' ? 1 : 0,
          transition: 'transform 1s ease-out, opacity 0.4s ease',
          transform: phase === 'glow' ? 'scale(1)' : 'scale(60)',
        }}
      />
      {/* D logo */}
      <img
        src="/favicon.svg"
        alt="D"
        className="relative select-none"
        style={{
          opacity: phase === 'glow' ? 0 : 1,
          transform: phase === 'zoom' ? 'scale(3)' : 'scale(14)',
          filter: 'drop-shadow(0 0 40px var(--primary-color))',
          transition: 'transform 1.4s ease-in, opacity 0.35s ease',
          width: 220,
        }}
      />
      {/* white flash */}
      <div
        className="absolute inset-0 bg-white"
        style={{
          opacity: phase === 'flash' ? 1 : 0,
          transition: 'opacity 0.35s ease',
        }}
      />
    </div>
  )
}
