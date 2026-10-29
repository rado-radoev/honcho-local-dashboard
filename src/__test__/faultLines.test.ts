import { describe, expect, it } from 'vitest'
import { clusterFaultLines, faultLinkBetween } from '../lib/faultLines'
import { buildHermesConclusions } from '../api/demoFixtures'
import type { Conclusion } from '../types'

// Fault Lines clustering: direct linkage signals only (direct
// source reference, shared source conclusion, shared source
// message). Unlinked contradictions stay unlinked — never
// force-matched, never merged through non-contradiction chains.

function makeConclusion(
  id: string,
  overrides: Partial<Conclusion> = {},
): Conclusion {
  return {
    id,
    content: `content of ${id}`,
    observer_id: 'hermes',
    observed_id: 'radoslav',
    session_id: 's1',
    level: 'contradiction',
    source_ids: [],
    source_message_ids: [],
    times_derived: 1,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('faultLinkBetween', () => {
  it('detects a direct reference in either direction', () => {
    const a = makeConclusion('a', { source_ids: ['b'] })
    const b = makeConclusion('b')
    expect(faultLinkBetween(a, b)?.signals).toEqual(['direct-reference'])
    expect(faultLinkBetween(b, a)?.signals).toEqual(['direct-reference'])
  })

  it('detects a shared source conclusion and a shared source message', () => {
    const a = makeConclusion('a', { source_ids: ['x'], source_message_ids: ['m1'] })
    const b = makeConclusion('b', { source_ids: ['x', 'y'], source_message_ids: ['m1', 'm2'] })
    const link = faultLinkBetween(a, b)
    expect(link?.signals).toEqual(['shared-source', 'shared-message'])
    expect(link?.sharedIds).toEqual(['m1', 'x'])
  })

  it('returns null when nothing is shared', () => {
    const a = makeConclusion('a', { source_ids: ['x'], source_message_ids: ['m1'] })
    const b = makeConclusion('b', { source_ids: ['y'], source_message_ids: ['m2'] })
    expect(faultLinkBetween(a, b)).toBeNull()
  })

  it('treats null source_message_ids as empty', () => {
    const a = makeConclusion('a', { source_message_ids: null })
    const b = makeConclusion('b', { source_message_ids: null })
    expect(faultLinkBetween(a, b)).toBeNull()
  })
})

describe('clusterFaultLines', () => {
  it('clusters a cross-referencing pair together', () => {
    const a = makeConclusion('a', { created_at: '2026-01-01T00:00:00Z' })
    const b = makeConclusion('b', {
      source_ids: ['a'],
      created_at: '2026-01-02T00:00:00Z',
    })
    const result = clusterFaultLines([b, a])
    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0].members.map((member) => member.id)).toEqual(['a', 'b'])
    expect(result.clusters[0].links).toHaveLength(1)
    expect(result.clusters[0].links[0].signals).toContain('direct-reference')
    expect(result.unlinked).toEqual([])
  })

  it('clusters contradictions that share a source conclusion', () => {
    const a = makeConclusion('a', { source_ids: ['root'] })
    const b = makeConclusion('b', { source_ids: ['root', 'other'] })
    const result = clusterFaultLines([a, b])
    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0].links[0].signals).toContain('shared-source')
    expect(result.clusters[0].links[0].sharedIds).toContain('root')
  })

  it('clusters contradictions that share a source message', () => {
    const a = makeConclusion('a', { source_message_ids: ['msg_1'] })
    const b = makeConclusion('b', { source_message_ids: ['msg_1', 'msg_2'] })
    const result = clusterFaultLines([a, b])
    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0].links[0].signals).toContain('shared-message')
  })

  it('merges transitively through a middle contradiction', () => {
    const a = makeConclusion('a', { source_ids: ['shared-1'] })
    const b = makeConclusion('b', { source_ids: ['shared-1', 'shared-2'] })
    const c = makeConclusion('c', { source_ids: ['shared-2'] })
    const result = clusterFaultLines([a, b, c])
    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0].members.map((member) => member.id)).toEqual(['a', 'b', 'c'])
    expect(result.clusters[0].links).toHaveLength(2)
  })

  it('keeps unlinked contradictions as singles in the Unlinked group', () => {
    const a = makeConclusion('a', { source_ids: ['x'] })
    const b = makeConclusion('b', { source_ids: ['y'] })
    const c = makeConclusion('c', { source_ids: ['z'] })
    const result = clusterFaultLines([a, b, c])
    expect(result.clusters).toEqual([])
    expect(result.unlinked.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(result.contradictions).toHaveLength(3)
  })

  it('does NOT merge contradictions linked only through a non-contradiction chain (no false merges)', () => {
    // a → mid (explicit) → b: ancestry through a non-contradiction is
    // not a linkage signal, so a and b must stay unlinked.
    const mid = makeConclusion('mid', { level: 'explicit', source_ids: ['b'] })
    const a = makeConclusion('a', { source_ids: ['mid'] })
    const b = makeConclusion('b')
    const result = clusterFaultLines([a, mid, b])
    expect(result.contradictions.map((item) => item.id)).toEqual(['a', 'b'])
    expect(result.clusters).toEqual([])
    expect(result.unlinked.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('ignores non-contradiction conclusions entirely', () => {
    const explicit = makeConclusion('e', { level: 'explicit', source_ids: ['a'] })
    const a = makeConclusion('a')
    const result = clusterFaultLines([explicit, a])
    expect(result.contradictions.map((item) => item.id)).toEqual(['a'])
    expect(result.unlinked.map((item) => item.id)).toEqual(['a'])
  })

  it('returns an empty result for a coherent set (no contradictions)', () => {
    const result = clusterFaultLines([makeConclusion('e', { level: 'explicit' })])
    expect(result.contradictions).toEqual([])
    expect(result.clusters).toEqual([])
    expect(result.unlinked).toEqual([])
  })

  it('is deterministic regardless of input order', () => {
    const a = makeConclusion('a', { source_ids: ['s'], created_at: '2026-01-03T00:00:00Z' })
    const b = makeConclusion('b', { source_ids: ['s'], created_at: '2026-01-01T00:00:00Z' })
    const first = clusterFaultLines([a, b])
    const second = clusterFaultLines([b, a])
    expect(first.clusters[0].members.map((member) => member.id)).toEqual(['b', 'a'])
    expect(second.clusters[0].members.map((member) => member.id)).toEqual(['b', 'a'])
    expect(first.clusters[0].id).toBe('fault-b')
  })
})

describe('clusterFaultLines — hermes demo fixtures', () => {
  it('puts the cross-referenced pair (fixture indices 115/116) in ONE cluster', () => {
    const generated = buildHermesConclusions()
    const first = generated[115]
    const second = generated[116]
    expect(first.level).toBe('contradiction')
    expect(second.level).toBe('contradiction')
    expect(second.source_ids).toContain(first.id)

    const result = clusterFaultLines(generated)
    const home = result.clusters.find((cluster) =>
      cluster.members.some((member) => member.id === first.id),
    )
    expect(home).toBeDefined()
    expect(home?.members.map((member) => member.id)).toContain(second.id)
    const link = home?.links.find(
      (entry) =>
        (entry.aId === first.id && entry.bId === second.id) ||
        (entry.aId === second.id && entry.bId === first.id),
    )
    expect(link?.signals).toContain('direct-reference')
  })

  it('finds exactly the 7 generated hermes contradictions', () => {
    const result = clusterFaultLines(buildHermesConclusions())
    expect(result.contradictions).toHaveLength(7)
    const clustered =
      result.clusters.reduce((sum, cluster) => sum + cluster.members.length, 0) +
      result.unlinked.length
    expect(clustered).toBe(7)
  })
})
