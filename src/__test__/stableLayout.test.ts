import { describe, expect, it } from 'vitest'
import {
  EMPTY_STABLE_LAYOUT,
  advanceStableLayout,
  spiralSlot,
  type StableLayoutState,
} from '../lib/stableLayout'
import { layoutConstellation } from '../lib/memoryGraph'
import type { Conclusion } from '../types'

// Append-stable placement: a conclusion keeps its first-assigned
// (angle, radius) across dataset changes; only new conclusions get
// fresh slots; removals never shift the survivors.

function makeConclusion(
  id: string,
  observed: string,
  createdAt: string,
  observer = 'hermes',
): Conclusion {
  return {
    id,
    content: `conclusion ${id}`,
    observer_id: observer,
    observed_id: observed,
    session_id: 's1',
    level: 'explicit',
    source_ids: [],
    source_message_ids: [],
    times_derived: 1,
    created_at: createdAt,
  }
}

function datasetA(): Conclusion[] {
  return [
    makeConclusion('a1', 'alice', '2026-01-01T00:00:00Z'),
    makeConclusion('a2', 'alice', '2026-01-02T00:00:00Z'),
    makeConclusion('a3', 'alice', '2026-01-03T00:00:00Z'),
    makeConclusion('b1', 'bob', '2026-01-01T12:00:00Z'),
    makeConclusion('b2', 'bob', '2026-01-02T12:00:00Z'),
  ]
}

function slotOf(state: StableLayoutState, id: string) {
  const slot = state.slots.get(id)
  if (!slot) throw new Error(`no slot for ${id}`)
  return { angle: slot.angle, radius: slot.radius }
}

describe('advanceStableLayout', () => {
  it('appending one conclusion leaves every existing slot unchanged', () => {
    const before = advanceStableLayout(EMPTY_STABLE_LAYOUT, datasetA())
    const added = makeConclusion('a4', 'alice', '2026-01-04T00:00:00Z')
    const after = advanceStableLayout(before, [...datasetA(), added])
    for (const item of datasetA()) {
      expect(slotOf(after, item.id)).toEqual(slotOf(before, item.id))
    }
    const fresh = after.slots.get('a4')
    expect(fresh?.peerId).toBe('alice')
    expect(fresh?.index).toBe(3)
    const expected = spiralSlot('alice', 3)
    expect(slotOf(after, 'a4')).toEqual({ angle: expected.angle, radius: expected.radius })
  })

  it('a removed conclusion vanishes without shifting the others', () => {
    const before = advanceStableLayout(EMPTY_STABLE_LAYOUT, datasetA())
    const remaining = datasetA().filter((item) => item.id !== 'a2')
    const after = advanceStableLayout(before, remaining)
    expect(after.slots.has('a2')).toBe(false)
    expect(after.slots.size).toBe(4)
    for (const item of remaining) {
      expect(slotOf(after, item.id)).toEqual(slotOf(before, item.id))
    }
  })

  it('never reuses a departed slot: the next newcomer goes past the high-water mark', () => {
    const before = advanceStableLayout(EMPTY_STABLE_LAYOUT, datasetA())
    const withoutTop = advanceStableLayout(
      before,
      datasetA().filter((item) => item.id !== 'a3'),
    )
    const newcomer = makeConclusion('a9', 'alice', '2026-01-05T00:00:00Z')
    const after = advanceStableLayout(withoutTop, [
      ...datasetA().filter((item) => item.id !== 'a3'),
      newcomer,
    ])
    // a3 held index 2; a9 must NOT land on it.
    expect(after.slots.get('a9')?.index).toBe(3)
  })

  it('is idempotent: advancing the same dataset twice changes nothing', () => {
    const first = advanceStableLayout(EMPTY_STABLE_LAYOUT, datasetA())
    const second = advanceStableLayout(first, datasetA())
    expect(second).toBe(first)
  })

  it('does not mutate the previous state', () => {
    const before = advanceStableLayout(EMPTY_STABLE_LAYOUT, datasetA())
    const sizeBefore = before.slots.size
    advanceStableLayout(before, [
      ...datasetA(),
      makeConclusion('z1', 'alice', '2026-02-01T00:00:00Z'),
    ])
    expect(before.slots.size).toBe(sizeBefore)
    expect(before.slots.has('z1')).toBe(false)
  })

  it('assigns multiple newcomers consecutive indices in (created_at, id) order', () => {
    const before = advanceStableLayout(EMPTY_STABLE_LAYOUT, datasetA())
    const late = makeConclusion('n2', 'alice', '2026-03-02T00:00:00Z')
    const early = makeConclusion('n1', 'alice', '2026-03-01T00:00:00Z')
    const after = advanceStableLayout(before, [...datasetA(), late, early])
    expect(after.slots.get('n1')?.index).toBe(3)
    expect(after.slots.get('n2')?.index).toBe(4)
    // A newcomer for one peer never touches the other peer's slots.
    expect(slotOf(after, 'b1')).toEqual(slotOf(before, 'b1'))
    expect(slotOf(after, 'b2')).toEqual(slotOf(before, 'b2'))
  })

  it('first load reproduces the spiral layout coordinates exactly', () => {
    const items = datasetA()
    const state = advanceStableLayout(EMPTY_STABLE_LAYOUT, items)
    const layout = layoutConstellation(items, ['alice', 'bob', 'hermes'])
    const hubByPeer = new Map(layout.hubs.map((hub) => [hub.peerId, hub]))
    for (const dot of layout.dots) {
      const slot = state.slots.get(dot.conclusion.id)
      const hub = hubByPeer.get(dot.peerId)
      if (!slot || !hub) throw new Error('missing slot or hub')
      expect(dot.x).toBeCloseTo(hub.x + slot.radius * Math.cos(slot.angle), 6)
      expect(dot.y).toBeCloseTo(hub.y + slot.radius * Math.sin(slot.angle), 6)
    }
  })

  it('prefers stability over age order for a backfilled older conclusion', () => {
    const before = advanceStableLayout(EMPTY_STABLE_LAYOUT, datasetA())
    const backfill = makeConclusion('old1', 'alice', '2025-12-01T00:00:00Z')
    const after = advanceStableLayout(before, [...datasetA(), backfill])
    // Oldest by created_at, but it arrived last: it takes the next
    // outer slot instead of displacing a1 from the innermost slot.
    expect(after.slots.get('old1')?.index).toBe(3)
    expect(slotOf(after, 'a1')).toEqual(slotOf(before, 'a1'))
  })
})
