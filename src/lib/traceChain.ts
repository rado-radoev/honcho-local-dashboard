import type { Conclusion } from '../types'

// Pure derivation-chain traversal, extracted from the Conclusions
// Explorer (which rendered it as a recursive component) so the
// Explorer and the Memory Map's derivation trace share ONE walk.
//
// traceChain walks `source_ids` depth-first in pre-order — the same
// reading order the Explorer's nested list used: a conclusion, then
// its first source's whole sub-chain, then its next source. Depth is
// capped (default TRACE_MAX_DEPTH = 5, the Explorer's historic cap).
// The walk is cycle-safe: an id already emitted is never expanded
// again, so A → B → A terminates. Ids with no conclusion in the pool
// are tolerated as `missing` steps (the Explorer renders them as
// "(not in capped set)") and are never expanded.
//
// No DOM, no fetching, no randomness: same inputs, same steps.

export const TRACE_MAX_DEPTH = 5

export interface TraceStep {
  id: string
  // 0 = the traced conclusion itself, 1 = a direct source, and so on.
  depth: number
  // Null when the id could not be resolved from the pool.
  conclusion: Conclusion | null
  missing: boolean
}

export interface TraceEdge {
  // The derived conclusion…
  from: string
  // …and the source it was derived from.
  to: string
}

export interface TraceChainResult {
  // Unique steps in derivation (DFS pre-order) order.
  steps: TraceStep[]
  orderedIds: string[]
  idSet: ReadonlySet<string>
  // id -> index into `steps`, for hop-by-hop highlighting.
  orderById: ReadonlyMap<string, number>
  edges: TraceEdge[]
  // True when the depth cap cut off at least one expandable chain.
  truncated: boolean
}

function walk(
  rootId: string,
  rootConclusion: Conclusion | null,
  byId: ReadonlyMap<string, Conclusion>,
  maxDepth: number,
): TraceChainResult {
  const steps: TraceStep[] = []
  const edges: TraceEdge[] = []
  const visited = new Set<string>()
  let truncated = false

  // Explicit stack (children pushed in reverse) keeps pre-order DFS
  // without recursion, so a pathological pool can never blow the
  // call stack — the depth cap alone would bound recursion anyway.
  interface Frame {
    id: string
    depth: number
    conclusion: Conclusion | null
  }
  const stack: Frame[] = [{ id: rootId, depth: 0, conclusion: rootConclusion }]

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (visited.has(frame.id)) continue
    visited.add(frame.id)
    const conclusion = frame.conclusion ?? byId.get(frame.id) ?? null
    steps.push({
      id: frame.id,
      depth: frame.depth,
      conclusion,
      missing: conclusion === null,
    })
    if (!conclusion) continue
    if (frame.depth >= maxDepth) {
      if (conclusion.source_ids.length > 0) truncated = true
      continue
    }
    // Record every derivation edge from this step, even to ids that
    // turn out missing or already visited (a cycle edge is real).
    for (const sourceId of conclusion.source_ids) {
      edges.push({ from: frame.id, to: sourceId })
    }
    for (let index = conclusion.source_ids.length - 1; index >= 0; index -= 1) {
      const sourceId = conclusion.source_ids[index]
      if (visited.has(sourceId)) continue
      stack.push({
        id: sourceId,
        depth: frame.depth + 1,
        conclusion: byId.get(sourceId) ?? null,
      })
    }
  }

  const orderById = new Map<string, number>()
  steps.forEach((step, index) => orderById.set(step.id, index))
  return {
    steps,
    orderedIds: steps.map((step) => step.id),
    idSet: new Set(steps.map((step) => step.id)),
    orderById,
    edges,
    truncated,
  }
}

// Trace from a conclusion object (used when the root itself may not
// be in the pool map — e.g. the Memory Map's selected dot).
export function traceChain(
  root: Conclusion,
  byId: ReadonlyMap<string, Conclusion>,
  maxDepth: number = TRACE_MAX_DEPTH,
): TraceChainResult {
  return walk(root.id, root, byId, maxDepth)
}

// Trace from a bare id resolved through the pool. An unknown root id
// yields a single missing step instead of throwing.
export function traceChainById(
  rootId: string,
  byId: ReadonlyMap<string, Conclusion>,
  maxDepth: number = TRACE_MAX_DEPTH,
): TraceChainResult {
  return walk(rootId, byId.get(rootId) ?? null, byId, maxDepth)
}
