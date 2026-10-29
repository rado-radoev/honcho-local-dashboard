import type { Conclusion } from '../types'

// Pure, deterministic chart data builders for the Overview hub. All time
// windows anchor on the newest conclusion in the data (never Date.now),
// so demo renders are byte-stable.

export interface GrowthPoint {
  label: string
  value: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

function newestMs(conclusions: Conclusion[]): number {
  let max = 0
  for (const item of conclusions) {
    const at = new Date(item.created_at).getTime()
    if (at > max) max = at
  }
  return max
}

// Cumulative conclusions at the end of each of the last `weeks` weeks.
export function buildGrowthSeries(conclusions: Conclusion[], weeks = 26): GrowthPoint[] {
  if (conclusions.length === 0) return []
  const end = newestMs(conclusions)
  const start = end - weeks * WEEK_MS
  const sorted = [...conclusions]
    .map((item) => new Date(item.created_at).getTime())
    .sort((a, b) => a - b)
  const points: GrowthPoint[] = []
  for (let week = 0; week < weeks; week += 1) {
    const boundary = start + (week + 1) * WEEK_MS
    let count = 0
    for (const at of sorted) {
      // <= so the final week includes the newest conclusion itself.
      if (at <= boundary) count += 1
    }
    points.push({ label: `W${week + 1}`, value: count })
  }
  return points
}

export interface HeatmapData {
  // cells[week][weekday] = conclusions that day; weekday 0 = Monday.
  cells: number[][]
  max: number
  weeks: number
}

export function buildHeatmap(conclusions: Conclusion[], weeks = 26): HeatmapData {
  const cells: number[][] = []
  for (let week = 0; week < weeks; week += 1) cells.push([0, 0, 0, 0, 0, 0, 0])
  if (conclusions.length === 0) return { cells, max: 0, weeks }
  const end = newestMs(conclusions)
  const endDate = new Date(end)
  // Anchor the grid so the last column contains the newest day; columns
  // start on Mondays (UTC).
  const endUtcDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  const endWeekday = (endDate.getUTCDay() + 6) % 7
  const gridStart = endUtcDay - endWeekday * DAY_MS - (weeks - 1) * WEEK_MS
  let max = 0
  for (const item of conclusions) {
    const at = new Date(item.created_at).getTime()
    const dayIndex = Math.floor((at - gridStart) / DAY_MS)
    if (dayIndex < 0 || dayIndex >= weeks * 7) continue
    const week = Math.floor(dayIndex / 7)
    const weekday = dayIndex % 7
    cells[week][weekday] += 1
    if (cells[week][weekday] > max) max = cells[week][weekday]
  }
  return { cells, max, weeks }
}
