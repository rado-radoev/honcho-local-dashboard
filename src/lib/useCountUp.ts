import { useEffect, useState } from 'react'

// 400ms count-up for stat tiles; instantly final under
// prefers-reduced-motion (and therefore in screenshot captures).
export function useCountUp(target: number, durationMs = 400): number {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return target
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? target : 0
  })
  useEffect(() => {
    let frame = 0
    const started = performance.now()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    function tick(now: number) {
      const progress = reduced ? 1 : Math.min(1, (now - started) / durationMs)
      setValue(Math.round(target * progress))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])
  return value
}
