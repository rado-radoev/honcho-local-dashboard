import type { Conclusion } from '../types'

// Append-stable dot placement for the Memory Map constellation.
//
// Problem: the deterministic layout (memoryGraph.ts) positions a dot
// by its RANK in the peer's sorted conclusions, so one new conclusion
// on a cache refresh renumbers every newer dot — dots would teleport
// mid-orbit. This module fixes that with a pure state transition:
//
//   advanceStableLayout(previousState, conclusions) -> nextState
//
// A conclusion keeps the slot (angle + radius) it was first assigned
// for as long as it stays in the dataset; genuinely new conclusions
// get the next free spiral indices for their peer (past a high-water
// mark, so a departed dot's slot is never reused mid-session);
// departed conclusions simply drop out. No mutation: the caller holds
// the returned state (the page keeps it in a ref) and passes it back
// on the next dataset. Pure and idempotent — advancing the same
// dataset twice returns the same state.
//
// Tradeoff, chosen deliberately: stability beats strict age ordering
// for late arrivals. Slots are first assigned in (created_at, id)
// order, so on first load the layout is EXACTLY the spiral layout —
// oldest innermost, byte-identical screenshots. But a new conclusion
// whose created_at predates existing ones (backfill, out-of-order
// ingest) takes an OUTER slot instead of displacing the dots that
// would have to move to make room for it chronologically.

export interface StableSlot {
  peerId: string
  index: number
  angle: number
  radius: number
}

export interface StableLayoutState {
  slots: ReadonlyMap<string, StableSlot>
  nextIndexByPeer: ReadonlyMap<string, number>
}

export const EMPTY_STABLE_LAYOUT: StableLayoutState = {
  slots: new Map(),
  nextIndexByPeer: new Map(),
}

// Same spiral as memoryGraph.ts: golden angle, radius grows with
// sqrt(index) from a 22px base. Kept in step with that module — a
// first-load assignment must reproduce its coordinates exactly.
const GOLDEN_ANGLE = 2.399963229728653
const SLOT_BASE_RADIUS = 22
const SLOT_RADIUS_STEP = 8.5

export function spiralSlot(peerId: string, index: number): StableSlot {
  return {
    peerId,
    index,
    angle: index * GOLDEN_ANGLE,
    radius: SLOT_BASE_RADIUS + SLOT_RADIUS_STEP * Math.sqrt(index),
  }
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

function byAgeThenId(a: Conclusion, b: Conclusion): number {
  const byDate = a.created_at.localeCompare(b.created_at)
  if (byDate !== 0) return byDate
  return a.id.localeCompare(b.id)
}

export function advanceStableLayout(
  state: StableLayoutState,
  conclusions: Conclusion[],
): StableLayoutState {
  const unique = dedupe(conclusions)
  const slots = new Map<string, StableSlot>()
  const freshByPeer = new Map<string, Conclusion[]>()

  for (const item of unique) {
    const previous = state.slots.get(item.id)
    if (previous && previous.peerId === item.observed_id) {
      slots.set(item.id, previous)
      continue
    }
    const list = freshByPeer.get(item.observed_id) ?? []
    list.push(item)
    freshByPeer.set(item.observed_id, list)
  }

  if (freshByPeer.size === 0 && slots.size === state.slots.size) {
    return state
  }

  const nextIndexByPeer = new Map(state.nextIndexByPeer)
  for (const [peerId, list] of freshByPeer) {
    list.sort(byAgeThenId)
    let next = nextIndexByPeer.get(peerId) ?? 0
    for (const slot of slots.values()) {
      if (slot.peerId === peerId && slot.index >= next) next = slot.index + 1
    }
    for (const item of list) {
      slots.set(item.id, spiralSlot(peerId, next))
      next += 1
    }
    nextIndexByPeer.set(peerId, next)
  }

  return { slots, nextIndexByPeer }
}
