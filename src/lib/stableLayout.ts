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

// ---------------------------------------------------------------------------
// Reasoning Radius slots (Phase E): the SAME append-stable rule, applied
// per (peer, depth-band) group instead of per peer. A radius dot's slot
// is its angle around the hub plus a small sub-ring offset inside its
// band (bands are ~22px wide; three sub-rings at -6/0/+6px keep a busy
// band from stacking every dot on one circle). A conclusion keeps its
// slot for as long as it stays in the same (peer, band) group; only
// genuinely new conclusions in a group get fresh indices for that
// group, past a per-group high-water mark. Bands come from
// lib/derivationDepth.ts (depth capped at the 3+ display band), so the
// group key IS the displayed depth: (peer, capped depth).

export interface RadiusSlot {
  peerId: string
  band: number
  index: number
  angle: number
  // Offset in px from the band's centre radius (-6, 0 or +6).
  subRadius: number
}

export interface RadiusStableLayoutState {
  slots: ReadonlyMap<string, RadiusSlot>
  nextIndexByGroup: ReadonlyMap<string, number>
}

export const EMPTY_RADIUS_STABLE_LAYOUT: RadiusStableLayoutState = {
  slots: new Map(),
  nextIndexByGroup: new Map(),
}

export function radiusSlot(peerId: string, band: number, index: number): RadiusSlot {
  return {
    peerId,
    band,
    index,
    angle: index * GOLDEN_ANGLE,
    subRadius: ((index % 3) - 1) * 6,
  }
}

function radiusGroupKey(peerId: string, band: number): string {
  return `${peerId}:${band}`
}

export function advanceRadiusStableLayout(
  state: RadiusStableLayoutState,
  conclusions: Conclusion[],
  bandById: ReadonlyMap<string, number>,
): RadiusStableLayoutState {
  const unique = dedupe(conclusions)
  const slots = new Map<string, RadiusSlot>()
  const freshByGroup = new Map<string, Conclusion[]>()

  for (const item of unique) {
    const band = bandById.get(item.id) ?? 0
    const previous = state.slots.get(item.id)
    if (previous && previous.peerId === item.observed_id && previous.band === band) {
      slots.set(item.id, previous)
      continue
    }
    const key = radiusGroupKey(item.observed_id, band)
    const list = freshByGroup.get(key) ?? []
    list.push(item)
    freshByGroup.set(key, list)
  }

  if (freshByGroup.size === 0 && slots.size === state.slots.size) {
    return state
  }

  const nextIndexByGroup = new Map(state.nextIndexByGroup)
  for (const [key, list] of freshByGroup) {
    list.sort(byAgeThenId)
    let next = nextIndexByGroup.get(key) ?? 0
    for (const slot of slots.values()) {
      if (radiusGroupKey(slot.peerId, slot.band) === key && slot.index >= next) {
        next = slot.index + 1
      }
    }
    for (const item of list) {
      const band = bandById.get(item.id) ?? 0
      slots.set(item.id, radiusSlot(item.observed_id, band, next))
      next += 1
    }
    nextIndexByGroup.set(key, next)
  }

  return { slots, nextIndexByGroup }
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
