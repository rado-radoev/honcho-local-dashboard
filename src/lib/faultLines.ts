import type { Conclusion } from '../types'

// Fault Lines clustering (Phase C1): group level=contradiction
// conclusions by DISCOVERABLE linkage only. Two contradictions are
// linked when any of these direct signals holds:
//   - direct-reference: one's source_ids contain the other's id
//   - shared-source:    their source_ids sets intersect (they were
//                       both derived from the same conclusion)
//   - shared-message:   their source_message_ids sets intersect
//                       (they were both derived from the same message)
// Clusters are the connected components of that pairwise graph
// (union-find), so A–B and B–C merge A, B, C into one cluster even
// when A and C share no direct signal.
//
// Deliberately NOT a signal: sharing an ANCESTOR through a chain of
// non-contradiction conclusions. In a chained dataset almost every
// contradiction would then merge into one giant cluster — a false
// merge that hides which statements actually conflict. A
// contradiction with no direct signal to any other contradiction is
// reported as unlinked, never force-matched.
//
// Pure and deterministic: no Date.now, no randomness; members and
// clusters are sorted by (created_at, id).

export type FaultLinkSignal = 'direct-reference' | 'shared-source' | 'shared-message'

export interface FaultLink {
  aId: string
  bId: string
  signals: FaultLinkSignal[]
  // The shared conclusion ids (shared-source) or message ids
  // (shared-message) behind the link, sorted; empty for a pure
  // direct reference.
  sharedIds: string[]
}

export interface FaultCluster {
  // Stable cluster id: `fault-<first member id>`.
  id: string
  members: Conclusion[]
  // Every pairwise link inside the cluster, in member order.
  links: FaultLink[]
}

export interface FaultLinesResult {
  // All contradictions in the input, sorted by (created_at, id).
  contradictions: Conclusion[]
  // Clusters of two or more linked contradictions.
  clusters: FaultCluster[]
  // Contradictions with no linkage to any other contradiction.
  unlinked: Conclusion[]
}

function byTimeThenId(a: Conclusion, b: Conclusion): number {
  const byTime = a.created_at.localeCompare(b.created_at)
  if (byTime !== 0) return byTime
  return a.id.localeCompare(b.id)
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function intersection(a: string[], b: string[]): string[] {
  const bSet = new Set(b)
  return uniqueSorted(a.filter((value) => bSet.has(value)))
}

// The direct linkage signals between two conclusions (empty array =
// not linked). Exported so tests and the view can explain WHY two
// statements sit in the same cluster.
export function faultLinkBetween(a: Conclusion, b: Conclusion): FaultLink | null {
  const signals: FaultLinkSignal[] = []
  const sharedIds: string[] = []
  if (a.source_ids.includes(b.id) || b.source_ids.includes(a.id)) {
    signals.push('direct-reference')
  }
  const sharedSources = intersection(a.source_ids, b.source_ids)
  if (sharedSources.length > 0) {
    signals.push('shared-source')
    sharedIds.push(...sharedSources)
  }
  const sharedMessages = intersection(a.source_message_ids ?? [], b.source_message_ids ?? [])
  if (sharedMessages.length > 0) {
    signals.push('shared-message')
    sharedIds.push(...sharedMessages)
  }
  if (signals.length === 0) return null
  return { aId: a.id, bId: b.id, signals, sharedIds: uniqueSorted(sharedIds) }
}

export function clusterFaultLines(items: Conclusion[]): FaultLinesResult {
  const contradictions = items
    .filter((item) => item.level === 'contradiction')
    .sort(byTimeThenId)

  // Union-find over contradiction indices.
  const parent = contradictions.map((_, index) => index)
  function find(index: number): number {
    let root = index
    while (parent[root] !== root) root = parent[root]
    return root
  }
  function union(a: number, b: number) {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
  }

  const pairwiseLinks: FaultLink[] = []
  for (let i = 0; i < contradictions.length; i += 1) {
    for (let j = i + 1; j < contradictions.length; j += 1) {
      const link = faultLinkBetween(contradictions[i], contradictions[j])
      if (link) {
        pairwiseLinks.push(link)
        union(i, j)
      }
    }
  }

  const groups = new Map<number, Conclusion[]>()
  contradictions.forEach((item, index) => {
    const root = find(index)
    const group = groups.get(root) ?? []
    group.push(item)
    groups.set(root, group)
  })

  const clusters: FaultCluster[] = []
  const unlinked: Conclusion[] = []
  const sortedGroups = [...groups.values()].sort((a, b) => byTimeThenId(a[0], b[0]))
  for (const members of sortedGroups) {
    if (members.length === 1) {
      unlinked.push(members[0])
      continue
    }
    const memberIds = new Set(members.map((member) => member.id))
    const links = pairwiseLinks.filter(
      (link) => memberIds.has(link.aId) && memberIds.has(link.bId),
    )
    clusters.push({ id: `fault-${members[0].id}`, members, links })
  }
  unlinked.sort(byTimeThenId)
  return { contradictions, clusters, unlinked }
}
