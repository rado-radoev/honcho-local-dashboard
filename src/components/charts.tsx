import type { GrowthPoint, HeatmapData } from '../lib/charts'

// Shared chart components (Overview hub + Memory Map rail). SVG only,
// every chart carries a legend/unit label per the design law. The accent
// gradient is used for chart strokes only.

import { useCountUp } from '../lib/useCountUp'

export function CountUp({ value }: { value: number }) {
  const display = useCountUp(value)
  return <span className="tabular-nums">{display.toLocaleString('en-US')}</span>
}

// Cumulative area chart with gradient stroke + soft fill, axis unit in
// the legend line ("cumulative conclusions").
export function GrowthChart({ points, height = 140 }: { points: GrowthPoint[]; height?: number }) {
  const width = 720
  if (points.length === 0) {
    return <p className="text-sm text-fog">No conclusions yet — the growth chart appears once memory forms.</p>
  }
  const max = Math.max(1, ...points.map((point) => point.value))
  const stepX = width / Math.max(1, points.length - 1)
  const coords = points.map((point, index) => {
    const x = index * stepX
    const y = height - 8 - (point.value / max) * (height - 24)
    return { x, y, value: point.value }
  })
  const line = coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Memory growth chart">
        <defs>
          <linearGradient id="growth-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6EA8FF" />
            <stop offset="100%" stopColor="#B79CFF" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="#6EA8FF" opacity={0.12} />
        <polyline points={line} fill="none" stroke="url(#growth-stroke)" strokeWidth={2} />
        {coords.map((coord, index) =>
          index % 5 === 0 || index === coords.length - 1 ? (
            <circle key={index} cx={coord.x} cy={coord.y} r={2.5} fill="#B79CFF" />
          ) : null,
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-fog">
        <span>26 weeks ago</span>
        <span>unit: cumulative conclusions (max {max})</span>
        <span>now</span>
      </figcaption>
    </figure>
  )
}

// GitHub-style activity grid: conclusions per day over 26 weeks.
export function Heatmap({ data }: { data: HeatmapData }) {
  const cell = 11
  const gap = 3
  const width = data.weeks * (cell + gap)
  const height = 7 * (cell + gap)
  function fill(count: number): string {
    if (count === 0) return '#161B29'
    const ratio = data.max === 0 ? 0 : count / data.max
    if (ratio <= 0.34) return '#2C4A7C'
    if (ratio <= 0.67) return '#6EA8FF'
    return '#B79CFF'
  }
  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-[560px]"
        role="img"
        aria-label="Memory activity heatmap, conclusions per day"
        data-testid="activity-heatmap"
      >
        {data.cells.map((week, weekIndex) =>
          week.map((count, dayIndex) => (
            <rect
              key={`${weekIndex}-${dayIndex}`}
              x={weekIndex * (cell + gap)}
              y={dayIndex * (cell + gap)}
              width={cell}
              height={cell}
              rx={2}
              fill={fill(count)}
            >
              <title>{`${count} conclusion(s)`}</title>
            </rect>
          )),
        )}
      </svg>
      <figcaption className="mt-1 flex items-center gap-2 text-[11px] text-fog">
        <span>unit: conclusions per day</span>
        <span className="ml-2">less</span>
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#161B29' }} />
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#2C4A7C' }} />
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#6EA8FF' }} />
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#B79CFF' }} />
        <span>more</span>
      </figcaption>
    </figure>
  )
}
