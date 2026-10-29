import type { Conclusion, ConclusionLevel } from '../types'
import { LEVEL_COLORS } from './conclusions'

// Pure deterministic layout for the Memory Map. No force simulation, no
// randomness, no Date.now: peers are sorted by id onto a circle, and
// conclusion dots spiral around their OBSERVED peer's hub with the
// golden angle, oldest innermost (conclusions sorted by created_at, id).
// Same input => same coordinates, every run (byte-stable screenshots).

export const MAP_WIDTH = 760
export const MAP_HEIGHT = 560
export const DOT_SMALL_THRESHOLD = 500
export const AGGREGATE_THRESHOLD = 5000

const GOLDEN_ANGLE = 2.399963229728653

export interface HubLayout {
  peerId: string
  x: number
  y: number
}

export interface DotLayout {
  conclusion: Conclusion
  peerId: string
  x: number
  y: number
  r: number
  color: string
}

export interface DensityCell {
  peerId: string
  x: number
  y: number
  count: number
  dominantLevel: ConclusionLevel
}

export interface ConstellationLayout {
  hubs: HubLayout[]
  dots: DotLayout[]
  cells: DensityCell[]
  aggregated: boolean
  total: number
}

export function hubPositions(peerIds: string[], width: number, height: number): HubLayout[] {
  const sorted = [...peerIds].sort((a, b) => a.localeCompare(b))
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.33
  return sorted.map((peerId, index) => {
    if (sorted.length === 1) return { peerId, x: cx, y: cy }
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sorted.length
    return {
      peerId,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    }
  })
}

function dedupe(conclusions: Conclusion[]): Conclusion[] {
  const seen = new Set<string>()
  const out: Conclusion[] = []
  for (const item of conclusions) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function dotRadius(timesDerived: number, small: boolean): number {
  if (small) return 2
  const scaled = 3 + ((Math.sqrt(Math.max(1, timesDerived)) - 1) / (Math.sqrt(6) - 1)) * 4
  return Math.min(7, Math.max(3, scaled))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function layoutConstellation(
  conclusions: Conclusion[],
  peerIds: string[],
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
): ConstellationLayout {
  const unique = dedupe(conclusions)
  const hubs = hubPositions(peerIds, width, height)
  const hubByPeer = new Map(hubs.map((hub) => [hub.peerId, hub]))
  const byPeer = new Map<string, Conclusion[]>()
  for (const item of unique) {
    if (!hubByPeer.has(item.observed_id)) continue
    const list = byPeer.get(item.observed_id) ?? []
    list.push(item)
    byPeer.set(item.observed_id, list)
  }

  if (unique.length > AGGREGATE_THRESHOLD) {
    const cells: DensityCell[] = []
    for (const hub of hubs) {
      const list = byPeer.get(hub.peerId) ?? []
      if (list.length === 0) continue
      const counts = new Map<ConclusionLevel, number>()
      for (const item of list) counts.set(item.level, (counts.get(item.level) ?? 0) + 1)
      let dominant: ConclusionLevel = 'explicit'
      let best = -1
      for (const [level, count] of counts) {
        if (count > best) {
          best = count
          dominant = level
        }
      }
      cells.push({ peerId: hub.peerId, x: hub.x, y: hub.y, count: list.length, dominantLevel: dominant })
    }
    return { hubs, dots: [], cells, aggregated: true, total: unique.length }
  }

  const small = unique.length > DOT_SMALL_THRESHOLD
  const dots: DotLayout[] = []
  for (const hub of hubs) {
    const list = [...(byPeer.get(hub.peerId) ?? [])].sort((a, b) => {
      const byDate = a.created_at.localeCompare(b.created_at)
      if (byDate !== 0) return byDate
      return a.id.localeCompare(b.id)
    })
    list.forEach((conclusion, index) => {
      const distance = 22 + 8.5 * Math.sqrt(index)
      const angle = index * GOLDEN_ANGLE
      const x = clamp(hub.x + distance * Math.cos(angle), 8, width - 8)
      const y = clamp(hub.y + distance * Math.sin(angle), 8, height - 8)
      dots.push({
        conclusion,
        peerId: hub.peerId,
        x,
        y,
        r: dotRadius(conclusion.times_derived, small),
        color: LEVEL_COLORS[conclusion.level],
      })
    })
  }
  return { hubs, dots, cells: [], aggregated: false, total: unique.length }
}

export interface NetworkEdge {
  observer: string
  observed: string
  count: number
  dominantLevel: ConclusionLevel
  byLevel: Record<string, number>
}

export function aggregateEdges(conclusions: Conclusion[]): NetworkEdge[] {
  const map = new Map<string, NetworkEdge>()
  for (const item of dedupe(conclusions)) {
    const key = `${item.observer_id}→${item.observed_id}`
    let edge = map.get(key)
    if (!edge) {
      edge = {
        observer: item.observer_id,
        observed: item.observed_id,
        count: 0,
        dominantLevel: item.level,
        byLevel: {},
      }
      map.set(key, edge)
    }
    edge.count += 1
    edge.byLevel[item.level] = (edge.byLevel[item.level] ?? 0) + 1
  }
  const edges = [...map.values()]
  for (const edge of edges) {
    let best = -1
    for (const [level, count] of Object.entries(edge.byLevel)) {
      if (count > best) {
        best = count
        edge.dominantLevel = level as ConclusionLevel
      }
    }
  }
  edges.sort((a, b) => {
    const byObserver = a.observer.localeCompare(b.observer)
    if (byObserver !== 0) return byObserver
    return a.observed.localeCompare(b.observed)
  })
  return edges
}

export interface NetworkLayout {
  hubs: HubLayout[]
  edges: Array<{
    edge: NetworkEdge
    x1: number
    y1: number
    x2: number
    y2: number
    width: number
    color: string
  }>
}

export function layoutNetwork(
  conclusions: Conclusion[],
  peerIds: string[],
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
): NetworkLayout {
  const hubs = hubPositions(peerIds, width, height)
  const hubByPeer = new Map(hubs.map((hub) => [hub.peerId, hub]))
  const rawEdges = aggregateEdges(conclusions)
  const maxCount = Math.max(1, ...rawEdges.map((edge) => edge.count))
  const pairKeys = new Set(rawEdges.map((edge) => `${edge.observer}→${edge.observed}`))
  const edges = rawEdges
    .filter((edge) => hubByPeer.has(edge.observer) && hubByPeer.has(edge.observed))
    .map((edge) => {
      const from = hubByPeer.get(edge.observer)!
      const to = hubByPeer.get(edge.observed)!
      // Bidirectional pairs share one straight line; offset each
      // direction perpendicular by 7px so both stay visible/clickable.
      let offsetX = 0
      let offsetY = 0
      const hasReverse = pairKeys.has(`${edge.observed}→${edge.observer}`)
      if (hasReverse && edge.observer !== edge.observed) {
        const dx = to.x - from.x
        const dy = to.y - from.y
        const length = Math.max(1, Math.hypot(dx, dy))
        const side = edge.observer < edge.observed ? 1 : -1
        offsetX = (-dy / length) * 7 * side
        offsetY = (dx / length) * 7 * side
      }
      return {
        edge,
        x1: from.x + offsetX,
        y1: from.y + offsetY,
        x2: to.x + offsetX,
        y2: to.y + offsetY,
        width: 1 + 5 * (edge.count / maxCount),
        color: LEVEL_COLORS[edge.dominantLevel],
      }
    })
  return { hubs, edges }
}
