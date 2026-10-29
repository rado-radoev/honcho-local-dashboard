import type { Conclusion, ConclusionLevel } from '../types'
import { CONCLUSION_LEVELS, LEVEL_COLORS } from './conclusions'
import { MAP_HEIGHT, MAP_WIDTH, radiusForTimesDerived } from './memoryGraph'

// Pure deterministic layout for the Memory Map's Thread-Timeline mode
// (Phase B). Position itself carries the information: x = created_at,
// lane = OBSERVED peer, dot color = level, dot size = √(times derived)
// (the shared radiusForTimesDerived scale), and derivation arcs connect
// a conclusion to the in-set conclusions it was derived from
// (source_ids). No randomness, no Date.now — the time domain anchors on
// the data itself, so the same input renders byte-identically.

export const DAY_MS = 24 * 60 * 60 * 1000

// Past this many VISIBLE conclusions the timeline bins into
// day × lane density cells instead of individual dots (the same
// density playbook as the Overview activity heatmap). At exactly the
// threshold the dots still render; one more and binning takes over.
export const TIMELINE_BIN_THRESHOLD = 500

// Plot geometry inside the shared MAP_WIDTH × MAP_HEIGHT viewBox: a
// left gutter for lane labels, a top strip for the time axis.
export const TIMELINE_LEFT = 96
export const TIMELINE_RIGHT = 20
export const TIMELINE_TOP = 30
export const TIMELINE_BOTTOM = 18

// Density-cell fills, mirroring the Overview heatmap palette steps
// (lib/charts buildHeatmap + components/charts Heatmap fill).
export function densityFill(count: number, maxCount: number): string {
  if (count === 0) return '#161B29'
  const ratio = maxCount === 0 ? 0 : count / maxCount
  if (ratio <= 0.34) return '#2C4A7C'
  if (ratio <= 0.67) return '#6EA8FF'
  return '#B79CFF'
}

export interface TimelineLane {
  peerId: string
  index: number
  y: number
  height: number
}

export interface TimelineDot {
  conclusion: Conclusion
  peerId: string
  laneIndex: number
  x: number
  y: number
  r: number
  color: string
  atMs: number
}

export interface TimelineCell {
  peerId: string
  laneIndex: number
  dayStartMs: number
  count: number
  dominantLevel: ConclusionLevel
  x: number
  y: number
  width: number
  height: number
}

export interface TimelineArc {
  fromId: string
  toId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  path: string
  emphasized: boolean
  // True when the source's created_at is LATER than the conclusion's.
  // Derivation should always point backward in time; when live/fixture
  // data violates that, the arc is still drawn conclusion → source
  // (endpoints ordered by time for the bow geometry) and flagged here
  // so the renderer can dash it instead of silently re-dating anything.
  forwardAnomaly: boolean
}

export interface TimelineTick {
  atMs: number
  x: number
}

export interface TimelineLayout {
  lanes: TimelineLane[]
  dots: TimelineDot[]
  cells: TimelineCell[]
  arcs: TimelineArc[]
  binned: boolean
  // The selected conclusion's dot even in binned mode (where `dots`
  // is empty), so the renderer can pin it above its density cell.
  selectedDot: TimelineDot | null
  total: number
  domainStartMs: number | null
  domainEndMs: number | null
  ticks: TimelineTick[]
  maxCellCount: number
  plotLeft: number
  plotRight: number
  plotTop: number
  plotBottom: number
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

function parseMs(iso: string): number {
  return new Date(iso).getTime()
}

// Small deterministic vertical jitter inside a lane, derived from the
// conclusion id, so same-moment bursts in one lane don't stack into a
// single overplotted blob. The lane itself still encodes the peer —
// the jitter never crosses lane bounds.
function laneJitter(id: string, laneHeight: number): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  const unit = (hash % 1000) / 999 // [0, 1]
  const spread = Math.max(0, Math.min(10, laneHeight * 0.28))
  return (unit * 2 - 1) * spread
}

function utcDayStartMs(atMs: number): number {
  const date = new Date(atMs)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

// The top decile of conclusions by times_derived (ties broken by id,
// so the set is stable across renders). In binned mode only these —
// plus the selected conclusion — keep their derivation arcs.
export function topDecileIds(conclusions: Conclusion[]): ReadonlySet<string> {
  const sorted = [...conclusions].sort((a, b) => {
    if (b.times_derived !== a.times_derived) return b.times_derived - a.times_derived
    return a.id.localeCompare(b.id)
  })
  const take = Math.max(1, Math.ceil(sorted.length / 10))
  return new Set(sorted.slice(0, take).map((item) => item.id))
}

// Birth replay: the conclusions born at or before the playhead. The
// page's time scrubber supplies the playhead; this is the pure filter
// the timeline's visible set is defined by.
export function filterBornBy(conclusions: Conclusion[], playheadMs: number): Conclusion[] {
  return conclusions.filter((item) => {
    const at = parseMs(item.created_at)
    return !Number.isNaN(at) && at <= playheadMs
  })
}

function arcPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const midX = (fromX + toX) / 2
  const span = Math.abs(fromX - toX)
  const bow = Math.min(52, Math.max(8, span * 0.22))
  const controlY = Math.min(fromY, toY) - bow
  return `M ${fromX.toFixed(2)} ${fromY.toFixed(2)} Q ${midX.toFixed(2)} ${controlY.toFixed(2)} ${toX.toFixed(2)} ${toY.toFixed(2)}`
}

function buildArcs(
  items: Conclusion[],
  dotById: Map<string, TimelineDot>,
  binned: boolean,
  selectedId: string | null,
): TimelineArc[] {
  const decile = binned ? topDecileIds(items) : null
  const arcs: TimelineArc[] = []
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id))
  for (const item of sorted) {
    const from = dotById.get(item.id)
    if (!from) continue
    // Density rule: in binned mode arcs survive only for the selected
    // conclusion and the top-decile most-derived conclusions.
    if (decile && item.id !== selectedId && !decile.has(item.id)) continue
    for (const sourceId of item.source_ids) {
      if (sourceId === item.id) continue
      const to = dotById.get(sourceId)
      // Sources evicted by the cap (or filtered out) are tolerated:
      // the thread just ends at the edge of the visible set.
      if (!to) continue
      arcs.push({
        fromId: item.id,
        toId: sourceId,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        path: arcPath(from.x, from.y, to.x, to.y),
        emphasized: item.id === selectedId || sourceId === selectedId,
        forwardAnomaly: to.atMs > from.atMs,
      })
    }
  }
  return arcs
}

function buildCells(
  items: Conclusion[],
  lanes: TimelineLane[],
  laneIndexByPeer: Map<string, number>,
  xScale: (ms: number) => number,
): { cells: TimelineCell[]; maxCellCount: number } {
  interface CellAccum {
    peerId: string
    laneIndex: number
    dayStartMs: number
    count: number
    byLevel: Map<ConclusionLevel, number>
  }
  const byKey = new Map<string, CellAccum>()
  for (const item of items) {
    const laneIndex = laneIndexByPeer.get(item.observed_id)
    if (laneIndex === undefined) continue
    const dayStartMs = utcDayStartMs(parseMs(item.created_at))
    const key = `${laneIndex}:${dayStartMs}`
    let cell = byKey.get(key)
    if (!cell) {
      cell = { peerId: item.observed_id, laneIndex, dayStartMs, count: 0, byLevel: new Map() }
      byKey.set(key, cell)
    }
    cell.count += 1
    cell.byLevel.set(item.level, (cell.byLevel.get(item.level) ?? 0) + 1)
  }
  let maxCellCount = 0
  const cells: TimelineCell[] = []
  const sortedKeys = [...byKey.keys()].sort((a, b) => a.localeCompare(b))
  for (const key of sortedKeys) {
    const accum = byKey.get(key)!
    const lane = lanes[accum.laneIndex]
    let dominant: ConclusionLevel = 'explicit'
    let best = -1
    for (const level of CONCLUSION_LEVELS) {
      const count = accum.byLevel.get(level) ?? 0
      if (count > best) {
        best = count
        dominant = level
      }
    }
    if (accum.count > maxCellCount) maxCellCount = accum.count
    const x = xScale(accum.dayStartMs)
    const xEnd = xScale(accum.dayStartMs + DAY_MS)
    cells.push({
      peerId: accum.peerId,
      laneIndex: accum.laneIndex,
      dayStartMs: accum.dayStartMs,
      count: accum.count,
      dominantLevel: dominant,
      x,
      y: lane.y - lane.height / 2 + 3,
      width: Math.max(3, xEnd - x - 1),
      height: Math.max(4, lane.height - 6),
    })
  }
  return { cells, maxCellCount }
}

export function layoutThreadTimeline(
  conclusions: Conclusion[],
  peerIds: string[],
  selectedId: string | null = null,
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
): TimelineLayout {
  const plotLeft = TIMELINE_LEFT
  const plotRight = width - TIMELINE_RIGHT
  const plotTop = TIMELINE_TOP
  const plotBottom = height - TIMELINE_BOTTOM

  const sortedPeers = [...peerIds].sort((a, b) => a.localeCompare(b))
  const laneHeight = sortedPeers.length > 0 ? (plotBottom - plotTop) / sortedPeers.length : 0
  const lanes: TimelineLane[] = sortedPeers.map((peerId, index) => ({
    peerId,
    index,
    y: plotTop + (index + 0.5) * laneHeight,
    height: laneHeight,
  }))
  const laneIndexByPeer = new Map(lanes.map((lane) => [lane.peerId, lane.index]))

  const empty: TimelineLayout = {
    lanes,
    dots: [],
    cells: [],
    arcs: [],
    binned: false,
    selectedDot: null,
    total: 0,
    domainStartMs: null,
    domainEndMs: null,
    ticks: [],
    maxCellCount: 0,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
  }

  // Only conclusions about a known lane peer, with a parseable date,
  // can be placed; everything else is tolerated and skipped.
  const items = dedupe(conclusions).filter((item) => {
    if (!laneIndexByPeer.has(item.observed_id)) return false
    return !Number.isNaN(parseMs(item.created_at))
  })
  if (items.length === 0) return empty

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const at = parseMs(item.created_at)
    if (at < min) min = at
    if (at > max) max = at
  }
  // Single-timestamp edge: a zero-width domain would divide by zero,
  // so expand symmetrically to one day and the dot lands mid-plot.
  let domainStartMs = min
  let domainEndMs = max
  if (domainEndMs <= domainStartMs) {
    domainStartMs = min - DAY_MS / 2
    domainEndMs = max + DAY_MS / 2
  }
  const span = domainEndMs - domainStartMs
  function xScale(ms: number): number {
    return plotLeft + ((ms - domainStartMs) / span) * (plotRight - plotLeft)
  }

  const binned = items.length > TIMELINE_BIN_THRESHOLD

  const dots: TimelineDot[] = items
    .map((item) => {
      const laneIndex = laneIndexByPeer.get(item.observed_id)!
      const lane = lanes[laneIndex]
      const atMs = parseMs(item.created_at)
      return {
        conclusion: item,
        peerId: item.observed_id,
        laneIndex,
        x: xScale(atMs),
        y: lane.y + laneJitter(item.id, lane.height),
        r: radiusForTimesDerived(item.times_derived),
        color: LEVEL_COLORS[item.level],
        atMs,
      }
    })
    .sort((a, b) => {
      if (a.atMs !== b.atMs) return a.atMs - b.atMs
      return a.conclusion.id.localeCompare(b.conclusion.id)
    })
  const dotById = new Map(dots.map((dot) => [dot.conclusion.id, dot]))

  let cells: TimelineCell[] = []
  let maxCellCount = 0
  if (binned) {
    const built = buildCells(items, lanes, laneIndexByPeer, xScale)
    cells = built.cells
    maxCellCount = built.maxCellCount
  }

  const arcs = buildArcs(items, dotById, binned, selectedId)

  const ticks: TimelineTick[] = []
  for (let index = 0; index <= 4; index += 1) {
    const atMs = domainStartMs + (span * index) / 4
    ticks.push({ atMs, x: xScale(atMs) })
  }

  return {
    lanes,
    // In binned mode individual dots are replaced by density cells;
    // their positions still live in the arc geometry above.
    dots: binned ? [] : dots,
    cells,
    arcs,
    binned,
    selectedDot: selectedId ? (dotById.get(selectedId) ?? null) : null,
    total: items.length,
    domainStartMs,
    domainEndMs,
    ticks,
    maxCellCount,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
  }
}
