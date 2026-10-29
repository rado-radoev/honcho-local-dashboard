import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  TIMELINE_BIN_THRESHOLD,
  TIMELINE_LEFT,
  densityFill,
  filterBornBy,
  layoutThreadTimeline,
  topDecileIds,
} from '../lib/threadTimeline'
import { MAP_WIDTH } from '../lib/memoryGraph'
import type { Conclusion, ConclusionLevel } from '../types'

// Thread-Timeline layout (Phase B): lanes = observed peer, x =
// created_at, arcs = derivation (source_ids) always pointing back in
// time, and the >500 density rule (day × lane cells, arcs only for
// the selected dot + top-decile times_derived).

function makeConclusion(overrides: Partial<Conclusion> & { id: string }): Conclusion {
  return {
    content: `content ${overrides.id}`,
    observer_id: 'hermes',
    observed_id: 'alice',
    session_id: null,
    level: 'explicit' as ConclusionLevel,
    source_ids: [],
    source_message_ids: [],
    times_derived: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const PEERS = ['bob', 'alice', 'claude'] // deliberately unsorted

describe('lane mapping', () => {
  it('sorts lanes by peer id and puts each dot in its OBSERVED peer lane', () => {
    const layout = layoutThreadTimeline(
      [
        makeConclusion({ id: 'a1', observed_id: 'alice' }),
        makeConclusion({ id: 'b1', observed_id: 'bob', created_at: '2026-01-03T00:00:00.000Z' }),
        makeConclusion({ id: 'c1', observed_id: 'claude', created_at: '2026-01-05T00:00:00.000Z' }),
      ],
      PEERS,
    )
    expect(layout.lanes.map((lane) => lane.peerId)).toEqual(['alice', 'bob', 'claude'])
    const byId = new Map(layout.dots.map((dot) => [dot.conclusion.id, dot]))
    expect(byId.get('a1')?.laneIndex).toBe(0)
    expect(byId.get('b1')?.laneIndex).toBe(1)
    expect(byId.get('c1')?.laneIndex).toBe(2)
    // Dot y sits inside its lane band.
    for (const dot of layout.dots) {
      const lane = layout.lanes[dot.laneIndex]
      expect(Math.abs(dot.y - lane.y)).toBeLessThanOrEqual(lane.height / 2)
    }
  })

  it('uses the observed peer, not the observer, as the lane', () => {
    const layout = layoutThreadTimeline(
      [makeConclusion({ id: 'x', observer_id: 'claude', observed_id: 'bob' })],
      PEERS,
    )
    expect(layout.dots[0].peerId).toBe('bob')
  })

  it('tolerates conclusions about peers with no lane', () => {
    const layout = layoutThreadTimeline(
      [makeConclusion({ id: 'ok' }), makeConclusion({ id: 'ghost', observed_id: 'nobody' })],
      PEERS,
    )
    expect(layout.dots.map((dot) => dot.conclusion.id)).toEqual(['ok'])
    expect(layout.total).toBe(1)
  })
})

describe('time scaling', () => {
  it('places the oldest at the left plot edge and the newest at the right', () => {
    const layout = layoutThreadTimeline(
      [
        makeConclusion({ id: 'old', created_at: '2026-01-01T00:00:00.000Z' }),
        makeConclusion({ id: 'new', created_at: '2026-01-11T00:00:00.000Z' }),
      ],
      PEERS,
    )
    const byId = new Map(layout.dots.map((dot) => [dot.conclusion.id, dot]))
    expect(byId.get('old')?.x).toBeCloseTo(TIMELINE_LEFT)
    expect(byId.get('new')?.x).toBeCloseTo(layout.plotRight)
    expect(byId.get('new')?.x).toBeLessThanOrEqual(MAP_WIDTH)
  })

  it('handles an empty set with no domain and no ticks', () => {
    const layout = layoutThreadTimeline([], PEERS)
    expect(layout.dots).toEqual([])
    expect(layout.cells).toEqual([])
    expect(layout.arcs).toEqual([])
    expect(layout.domainStartMs).toBeNull()
    expect(layout.domainEndMs).toBeNull()
    expect(layout.ticks).toEqual([])
    expect(layout.lanes).toHaveLength(3)
  })

  it('handles a single timestamp by centring the dot (expanded domain)', () => {
    const at = '2026-03-01T12:00:00.000Z'
    const layout = layoutThreadTimeline(
      [makeConclusion({ id: 'one', created_at: at }), makeConclusion({ id: 'two', created_at: at, observed_id: 'bob' })],
      PEERS,
    )
    expect(layout.domainEndMs! - layout.domainStartMs!).toBe(DAY_MS)
    for (const dot of layout.dots) {
      expect(dot.x).toBeCloseTo((layout.plotLeft + layout.plotRight) / 2)
      expect(Number.isFinite(dot.x)).toBe(true)
    }
  })

  it('sizes dots by sqrt(times_derived) on the shared scale', () => {
    const layout = layoutThreadTimeline(
      [
        makeConclusion({ id: 'once', times_derived: 1 }),
        makeConclusion({ id: 'six', times_derived: 6, created_at: '2026-01-02T00:00:00.000Z' }),
      ],
      PEERS,
    )
    const byId = new Map(layout.dots.map((dot) => [dot.conclusion.id, dot]))
    expect(byId.get('once')?.r).toBeCloseTo(3)
    expect(byId.get('six')?.r).toBeCloseTo(7)
  })
})

describe('derivation arcs', () => {
  it('connects a conclusion to its in-set sources, pointing backward in time', () => {
    const layout = layoutThreadTimeline(
      [
        makeConclusion({ id: 'src', created_at: '2026-01-01T00:00:00.000Z' }),
        makeConclusion({ id: 'mid', created_at: '2026-01-02T00:00:00.000Z', source_ids: ['src'] }),
        makeConclusion({ id: 'top', created_at: '2026-01-03T00:00:00.000Z', source_ids: ['mid'] }),
      ],
      PEERS,
    )
    expect(layout.arcs).toHaveLength(2)
    const dotById = new Map(layout.dots.map((dot) => [dot.conclusion.id, dot]))
    for (const arc of layout.arcs) {
      // Every arc target is strictly older than its source conclusion.
      expect(dotById.get(arc.toId)!.atMs).toBeLessThan(dotById.get(arc.fromId)!.atMs)
      expect(arc.forwardAnomaly).toBe(false)
      // And geometrically the arc lands left of where it starts.
      expect(arc.toX).toBeLessThan(arc.fromX)
    }
  })

  it('tolerates sources missing from the set and self-references', () => {
    const layout = layoutThreadTimeline(
      [
        makeConclusion({
          id: 'a',
          created_at: '2026-01-02T00:00:00.000Z',
          source_ids: ['evicted-by-cap', 'a'],
        }),
      ],
      PEERS,
    )
    expect(layout.arcs).toEqual([])
  })

  it('flags a source dated AFTER its conclusion instead of re-dating it', () => {
    const layout = layoutThreadTimeline(
      [
        makeConclusion({ id: 'weird-src', created_at: '2026-01-05T00:00:00.000Z' }),
        makeConclusion({ id: 'weird', created_at: '2026-01-02T00:00:00.000Z', source_ids: ['weird-src'] }),
      ],
      PEERS,
    )
    expect(layout.arcs).toHaveLength(1)
    expect(layout.arcs[0].fromId).toBe('weird')
    expect(layout.arcs[0].toId).toBe('weird-src')
    expect(layout.arcs[0].forwardAnomaly).toBe(true)
  })

  it('emphasizes only the selected conclusion arcs', () => {
    const items = [
      makeConclusion({ id: 's1', created_at: '2026-01-01T00:00:00.000Z' }),
      makeConclusion({ id: 's2', created_at: '2026-01-01T12:00:00.000Z' }),
      makeConclusion({ id: 'd1', created_at: '2026-01-02T00:00:00.000Z', source_ids: ['s1'] }),
      makeConclusion({ id: 'd2', created_at: '2026-01-03T00:00:00.000Z', source_ids: ['s2'] }),
    ]
    const layout = layoutThreadTimeline(items, PEERS, 'd1')
    const emphasized = layout.arcs.filter((arc) => arc.emphasized)
    expect(emphasized.map((arc) => arc.fromId)).toEqual(['d1'])
  })
})

describe('density binning', () => {
  // Synthetic large set: `count` conclusions spread one per hour
  // across lanes, each deriving from the previous same-lane one.
  function synthetic(count: number): Conclusion[] {
    const items: Conclusion[] = []
    const lastByPeer = new Map<string, string>()
    for (let index = 0; index < count; index += 1) {
      const peer = PEERS[index % PEERS.length]
      const id = `syn-${String(index).padStart(4, '0')}`
      const previous = lastByPeer.get(peer)
      items.push(
        makeConclusion({
          id,
          observed_id: peer,
          created_at: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
          source_ids: previous ? [previous] : [],
          times_derived: 1 + (index % 6),
        }),
      )
      lastByPeer.set(peer, id)
    }
    return items
  }

  it('renders individual dots at 499 and at exactly the 500 threshold', () => {
    for (const count of [TIMELINE_BIN_THRESHOLD - 1, TIMELINE_BIN_THRESHOLD]) {
      const layout = layoutThreadTimeline(synthetic(count), PEERS)
      expect(layout.binned).toBe(false)
      expect(layout.dots).toHaveLength(count)
      expect(layout.cells).toEqual([])
    }
  })

  it('bins into day × lane cells at 501 visible', () => {
    const layout = layoutThreadTimeline(synthetic(501), PEERS)
    expect(layout.binned).toBe(true)
    expect(layout.dots).toEqual([])
    expect(layout.cells.length).toBeGreaterThan(0)
    const cellTotal = layout.cells.reduce((sum, cell) => sum + cell.count, 0)
    expect(cellTotal).toBe(501)
    // Every cell belongs to exactly one lane and one UTC day.
    for (const cell of layout.cells) {
      expect(cell.dayStartMs % DAY_MS).toBe(0)
      expect(cell.laneIndex).toBeGreaterThanOrEqual(0)
      expect(cell.laneIndex).toBeLessThan(3)
    }
  })

  it('in binned mode keeps arcs only for the selected dot + top decile', () => {
    const items = synthetic(501)
    const decile = topDecileIds(items)
    const layout = layoutThreadTimeline(items, PEERS, 'syn-0003')
    expect(layout.arcs.length).toBeGreaterThan(0)
    for (const arc of layout.arcs) {
      const allowed = arc.fromId === 'syn-0003' || decile.has(arc.fromId)
      expect(allowed).toBe(true)
    }
    // The selected dot is still pinned for rendering above its cell.
    expect(layout.selectedDot?.conclusion.id).toBe('syn-0003')
  })

  it('topDecileIds takes the highest times_derived, ties by id', () => {
    const items = synthetic(100)
    const decile = topDecileIds(items)
    expect(decile.size).toBe(10)
    for (const id of decile) {
      const item = items.find((entry) => entry.id === id)!
      expect(item.times_derived).toBe(6)
    }
  })

  it('densityFill follows the heatmap palette steps', () => {
    expect(densityFill(0, 10)).toBe('#161B29')
    expect(densityFill(3, 10)).toBe('#2C4A7C')
    expect(densityFill(5, 10)).toBe('#6EA8FF')
    expect(densityFill(9, 10)).toBe('#B79CFF')
  })
})

describe('birth replay filter', () => {
  it('keeps exactly the conclusions born at or before the playhead', () => {
    const items = [
      makeConclusion({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
      makeConclusion({ id: 'b', created_at: '2026-01-02T00:00:00.000Z' }),
      makeConclusion({ id: 'c', created_at: '2026-01-03T00:00:00.000Z' }),
    ]
    const playhead = new Date('2026-01-02T00:00:00.000Z').getTime()
    expect(filterBornBy(items, playhead).map((item) => item.id)).toEqual(['a', 'b'])
    expect(filterBornBy(items, playhead - 1).map((item) => item.id)).toEqual(['a'])
  })
})
