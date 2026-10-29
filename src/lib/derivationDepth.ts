import type { Conclusion } from '../types'

// Reasoning Radius depth (Phase E): how many in-set `source_ids` hops
// separate a conclusion from something that was actually said.
//
//   depth 0  — no in-set sources. That covers a plain explicit
//              conclusion whose only provenance is source_message_ids,
//              AND any conclusion whose source_ids all point outside
//              the loaded (capped) set: depth is computed WITHIN the
//              fetched set, so an unloaded source contributes no hop.
//   depth n  — 1 + the LONGEST in-set ancestor chain below it. Longest,
//              not first-found: a conclusion derived from both a
//              shallow and a deep source sits at the deep ring, because
//              its reasoning really does rest on that whole chain.
//
// Why not reuse traceChain (Phase A) directly? Its DFS pre-order steps
// record the depth at which an id is FIRST reached, which for a
// diamond (one ancestor reachable by a short and a long path) is the
// short one — the trace's job is reading order, not longest lineage.
// This module therefore walks the same source_ids graph with its own
// memoised post-order pass, borrowing traceChain's conventions:
// explicit stack (no recursion, so a pathological pool cannot blow
// the call stack), visited-set cycle safety, missing ids tolerated.
//
// Cycle rule: a back-edge to a conclusion already on the walk stack
// contributes NO hop (it is ignored, exactly as traceChain refuses to
// re-expand a visited id). Roots are visited in id order, so even a
// pure cycle (A → B → A) gets one deterministic answer: B resolves to
// 0 (its only source is the in-progress A), A resolves to 1.
//
// Pure and deterministic: no DOM, no fetching, no randomness, no
// Date.now — same input set, same depths, every run.

export const RADIUS_BAND_MAX = 3

export const RADIUS_BAND_LABELS = ['Said', 'Derived ×1', 'Derived ×2', 'Derived ×3+'] as const

// Display band for a depth: depths 0, 1, 2 keep their own ring and
// every deeper conclusion shares the outer 3+ ring.
export function radiusBandForDepth(depth: number): number {
  if (!(depth > 0)) return 0
  return Math.min(RADIUS_BAND_MAX, Math.trunc(depth))
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

interface DepthFrame {
  id: string
  // In-set source ids, in the conclusion's own source_ids order.
  sources: string[]
  nextIndex: number
  // Longest resolved source depth seen so far, or -1 while none has
  // resolved (no in-set sources, or only cycle back-edges).
  best: number
}

export function computeDerivationDepths(
  conclusions: Conclusion[],
): ReadonlyMap<string, number> {
  const unique = dedupe(conclusions)
  const byId = new Map(unique.map((item) => [item.id, item]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  function sourcesInSet(item: Conclusion): string[] {
    return item.source_ids.filter((sourceId) => byId.has(sourceId))
  }

  const roots = [...byId.keys()].sort((a, b) => a.localeCompare(b))
  for (const rootId of roots) {
    if (depths.has(rootId)) continue
    const root = byId.get(rootId)!
    visiting.add(rootId)
    const stack: DepthFrame[] = [
      { id: rootId, sources: sourcesInSet(root), nextIndex: 0, best: -1 },
    ]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame.nextIndex < frame.sources.length) {
        const sourceId = frame.sources[frame.nextIndex]
        frame.nextIndex += 1
        const resolved = depths.get(sourceId)
        if (resolved !== undefined) {
          if (resolved > frame.best) frame.best = resolved
          continue
        }
        // A source already on the stack is a cycle back-edge: no hop.
        if (visiting.has(sourceId)) continue
        const source = byId.get(sourceId)!
        visiting.add(sourceId)
        stack.push({
          id: sourceId,
          sources: sourcesInSet(source),
          nextIndex: 0,
          best: -1,
        })
        continue
      }
      const depth = frame.best < 0 ? 0 : frame.best + 1
      depths.set(frame.id, depth)
      visiting.delete(frame.id)
      stack.pop()
      // Propagate the finished depth to the parent frame that was
      // waiting on this source.
      const parent = stack[stack.length - 1]
      if (parent && depth > parent.best) parent.best = depth
    }
  }
  return depths
}

// Strata borrow (Phase E): the distinct months present in ONE peer's
// conclusions, in chronological order, for the faint rim ticks drawn
// around that peer's hub in Radius mode. `label` is the short English
// month name (Apr, Oct, …) — letters, per the designer's tick spec,
// and unambiguous where a single letter would collide (Jun/Jul).
export interface MonthTick {
  // `YYYY-MM` of the month, chronological sort key and stable id.
  key: string
  label: string
  // Angle (radians) of the tick around the hub: ticks are spread
  // evenly over the full circle starting at the top, in month order.
  angle: number
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function monthTicksForPeer(conclusions: Conclusion[], peerId: string): MonthTick[] {
  const keys = new Set<string>()
  for (const item of conclusions) {
    if (item.observed_id !== peerId) continue
    // created_at is ISO; the `YYYY-MM` prefix is the month bucket.
    const key = item.created_at.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(key)) keys.add(key)
  }
  const sorted = [...keys].sort((a, b) => a.localeCompare(b))
  return sorted.map((key, index) => {
    const monthIndex = Number(key.slice(5, 7)) - 1
    let label = key
    if (monthIndex >= 0 && monthIndex < MONTH_LABELS.length) label = MONTH_LABELS[monthIndex]
    return {
      key,
      label,
      angle: -Math.PI / 2 + (index * 2 * Math.PI) / sorted.length,
    }
  })
}
