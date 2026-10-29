import { describe, expect, it } from 'vitest'
import {
  EMPTY_RADIUS_STABLE_LAYOUT,
  advanceRadiusStableLayout,
  radiusSlot,
  type RadiusStableLayoutState,
} from '../lib/stableLayout'
import { radiusBandForDepth } from '../lib/derivationDepth'
import type { Conclusion } from '../types'

// Append-stable radius slots: within a (peer, depth-band) group a
// conclusion keeps its first-assigned slot across refreshes; only new
// conclusions in the group get fresh slots.

function makeConclusion(
  id: string,
  observed: string,
  createdAt: string,
  depth: number,
): { item: Conclusion; depth: number } {
  return {
    item: {
      id,
      content: `conclusion ${id}`,
      observer_id: 'hermes',
      observed_id: observed,
      session_id: 's1',
      level: 'deductive',
      source_ids: [],
      source_message_ids: [],
      times_derived: 1,
      created_at: createdAt,
    },
    depth,
  }
}

function advance(
  state: RadiusStableLayoutState,
  entries: Array<{ item: Conclusion; depth: number }>,
): RadiusStableLayoutState {
  const bandById = new Map(
    entries.map((entry) => [entry.item.id, radiusBandForDepth(entry.depth)]),
  )
  return advanceRadiusStableLayout(
    state,
    entries.map((entry) => entry.item),
    bandById,
  )
}

function datasetA() {
  return [
    makeConclusion('a1', 'alice', '2026-01-01T00:00:00Z', 0),
    makeConclusion('a2', 'alice', '2026-01-02T00:00:00Z', 0),
    makeConclusion('a3', 'alice', '2026-01-03T00:00:00Z', 3),
    makeConclusion('a4', 'alice', '2026-01-04T00:00:00Z', 5),
    makeConclusion('b1', 'bob', '2026-01-01T00:00:00Z', 0),
  ]
}

function slotOf(state: RadiusStableLayoutState, id: string) {
  const slot = state.slots.get(id)
  if (!slot) throw new Error(`no slot for ${id}`)
  return { angle: slot.angle, subRadius: slot.subRadius, index: slot.index, band: slot.band }
}

describe('advanceRadiusStableLayout', () => {
  it('assigns indices per (peer, band) group, not per peer', () => {
    const state = advance(EMPTY_RADIUS_STABLE_LAYOUT, datasetA())
    // alice band 0: a1, a2 → 0, 1. alice band 3+: a3 (depth 3) and
    // a4 (depth 5, capped) share the band group → 0, 1.
    expect(state.slots.get('a1')?.index).toBe(0)
    expect(state.slots.get('a2')?.index).toBe(1)
    expect(state.slots.get('a3')?.index).toBe(0)
    expect(state.slots.get('a3')?.band).toBe(3)
    expect(state.slots.get('a4')?.index).toBe(1)
    expect(state.slots.get('a4')?.band).toBe(3)
    expect(state.slots.get('b1')?.index).toBe(0)
  })

  it('appending inside one group leaves every existing slot unchanged', () => {
    const before = advance(EMPTY_RADIUS_STABLE_LAYOUT, datasetA())
    const added = makeConclusion('a5', 'alice', '2026-01-05T00:00:00Z', 0)
    const after = advance(before, [...datasetA(), added])
    for (const entry of datasetA()) {
      expect(slotOf(after, entry.item.id)).toEqual(slotOf(before, entry.item.id))
    }
    expect(after.slots.get('a5')?.index).toBe(2)
    const expected = radiusSlot('alice', 0, 2)
    expect(slotOf(after, 'a5')).toEqual({
      angle: expected.angle,
      subRadius: expected.subRadius,
      index: 2,
      band: 0,
    })
  })

  it('a removal never shifts the survivors and its index is not reused', () => {
    const before = advance(EMPTY_RADIUS_STABLE_LAYOUT, datasetA())
    const remaining = datasetA().filter((entry) => entry.item.id !== 'a2')
    const afterRemoval = advance(before, remaining)
    expect(afterRemoval.slots.has('a2')).toBe(false)
    for (const entry of remaining) {
      expect(slotOf(afterRemoval, entry.item.id)).toEqual(slotOf(before, entry.item.id))
    }
    const newcomer = makeConclusion('a9', 'alice', '2026-01-06T00:00:00Z', 0)
    const after = advance(afterRemoval, [...remaining, newcomer])
    // a2 held band-0 index 1; a9 goes past the high-water mark.
    expect(after.slots.get('a9')?.index).toBe(2)
  })

  it('is idempotent and does not mutate the previous state', () => {
    const first = advance(EMPTY_RADIUS_STABLE_LAYOUT, datasetA())
    const second = advance(first, datasetA())
    expect(second).toBe(first)
    const sizeBefore = first.slots.size
    advance(first, [...datasetA(), makeConclusion('z1', 'alice', '2026-02-01T00:00:00Z', 1)])
    expect(first.slots.size).toBe(sizeBefore)
    expect(first.slots.has('z1')).toBe(false)
  })

  it('a depth change WITHIN the capped band keeps the slot; crossing bands re-slots', () => {
    const before = advance(EMPTY_RADIUS_STABLE_LAYOUT, datasetA())
    // a4 deepens from depth 5 to depth 7 — still band 3+, same slot.
    const deepened = datasetA().map((entry) =>
      entry.item.id === 'a4' ? { ...entry, depth: 7 } : entry,
    )
    const afterDeepen = advance(before, deepened)
    expect(slotOf(afterDeepen, 'a4')).toEqual(slotOf(before, 'a4'))
    // a2 gains an in-set source and moves band 0 → band 1: it is
    // fresh in its new group, everyone else keeps their slot.
    const promoted = datasetA().map((entry) =>
      entry.item.id === 'a2' ? { ...entry, depth: 1 } : entry,
    )
    const afterPromote = advance(before, promoted)
    expect(afterPromote.slots.get('a2')?.band).toBe(1)
    expect(afterPromote.slots.get('a2')?.index).toBe(0)
    expect(slotOf(afterPromote, 'a1')).toEqual(slotOf(before, 'a1'))
  })
})
