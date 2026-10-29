import { describe, expect, it } from 'vitest'
import { TRACE_MAX_DEPTH, traceChain, traceChainById } from '../lib/traceChain'
import type { Conclusion } from '../types'

// Derivation trace: DFS pre-order over source_ids, depth-capped,
// cycle-safe, tolerant of ids missing from the pool.

function makeConclusion(id: string, sourceIds: string[] = []): Conclusion {
  return {
    id,
    content: `content of ${id}`,
    observer_id: 'hermes',
    observed_id: 'radoslav',
    session_id: 's1',
    level: 'explicit',
    source_ids: sourceIds,
    source_message_ids: [],
    times_derived: 1,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function poolOf(...items: Conclusion[]): Map<string, Conclusion> {
  return new Map(items.map((item) => [item.id, item]))
}

describe('traceChain', () => {
  it('returns just the root for a conclusion with no sources', () => {
    const root = makeConclusion('a')
    const result = traceChain(root, poolOf(root))
    expect(result.orderedIds).toEqual(['a'])
    expect(result.steps[0]).toMatchObject({ id: 'a', depth: 0, missing: false })
    expect(result.edges).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('walks a linear chain in derivation order with increasing depth', () => {
    const d = makeConclusion('d')
    const c = makeConclusion('c', ['d'])
    const b = makeConclusion('b', ['c'])
    const a = makeConclusion('a', ['b'])
    const result = traceChain(a, poolOf(a, b, c, d))
    expect(result.orderedIds).toEqual(['a', 'b', 'c', 'd'])
    expect(result.steps.map((step) => step.depth)).toEqual([0, 1, 2, 3])
    expect(result.edges).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ])
    expect(result.idSet.has('c')).toBe(true)
    expect(result.orderById.get('d')).toBe(3)
  })

  it('branches depth-first: first source sub-chain before the next source', () => {
    const d = makeConclusion('d')
    const b = makeConclusion('b', ['d'])
    const c = makeConclusion('c')
    const a = makeConclusion('a', ['b', 'c'])
    const result = traceChain(a, poolOf(a, b, c, d))
    expect(result.orderedIds).toEqual(['a', 'b', 'd', 'c'])
    expect(result.steps.map((step) => step.depth)).toEqual([0, 1, 2, 1])
  })

  it('emits a diamond-shared ancestor exactly once', () => {
    const d = makeConclusion('d')
    const b = makeConclusion('b', ['d'])
    const c = makeConclusion('c', ['d'])
    const a = makeConclusion('a', ['b', 'c'])
    const result = traceChain(a, poolOf(a, b, c, d))
    expect(result.orderedIds).toEqual(['a', 'b', 'd', 'c'])
    // Both derivation edges to d are real and recorded.
    expect(result.edges).toContainEqual({ from: 'c', to: 'd' })
    expect(result.edges).toContainEqual({ from: 'b', to: 'd' })
  })

  it('is cycle-safe: A -> B -> A terminates with each id once', () => {
    const a = makeConclusion('a', ['b'])
    const b = makeConclusion('b', ['a'])
    const result = traceChain(a, poolOf(a, b))
    expect(result.orderedIds).toEqual(['a', 'b'])
    expect(result.edges).toContainEqual({ from: 'b', to: 'a' })
  })

  it('is cycle-safe for a self-referencing conclusion', () => {
    const a = makeConclusion('a', ['a'])
    const result = traceChain(a, poolOf(a))
    expect(result.orderedIds).toEqual(['a'])
  })

  it('tolerates missing source ids as non-expanded missing steps', () => {
    const a = makeConclusion('a', ['ghost', 'b'])
    const b = makeConclusion('b')
    const result = traceChain(a, poolOf(a, b))
    expect(result.orderedIds).toEqual(['a', 'ghost', 'b'])
    const ghost = result.steps[1]
    expect(ghost.missing).toBe(true)
    expect(ghost.conclusion).toBeNull()
    expect(ghost.depth).toBe(1)
  })

  it('caps depth at 5 by default and reports truncation', () => {
    const items: Conclusion[] = []
    for (let index = 0; index < 9; index += 1) {
      items.push(makeConclusion(`n${index}`, index < 8 ? [`n${index + 1}`] : []))
    }
    const result = traceChain(items[0], poolOf(...items))
    expect(TRACE_MAX_DEPTH).toBe(5)
    expect(result.orderedIds).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    expect(result.steps[5].depth).toBe(5)
    expect(result.truncated).toBe(true)
  })

  it('does not report truncation when the chain ends exactly at the cap', () => {
    const items: Conclusion[] = []
    for (let index = 0; index < 6; index += 1) {
      items.push(makeConclusion(`n${index}`, index < 5 ? [`n${index + 1}`] : []))
    }
    const result = traceChain(items[0], poolOf(...items))
    expect(result.orderedIds).toHaveLength(6)
    expect(result.truncated).toBe(false)
  })

  it('honours a custom maxDepth', () => {
    const c = makeConclusion('c')
    const b = makeConclusion('b', ['c'])
    const a = makeConclusion('a', ['b'])
    const result = traceChain(a, poolOf(a, b, c), 1)
    expect(result.orderedIds).toEqual(['a', 'b'])
    expect(result.truncated).toBe(true)
  })

  it('resolves the root from the pool in traceChainById', () => {
    const b = makeConclusion('b')
    const a = makeConclusion('a', ['b'])
    const result = traceChainById('a', poolOf(a, b))
    expect(result.orderedIds).toEqual(['a', 'b'])
  })

  it('traceChainById yields one missing step for an unknown root', () => {
    const result = traceChainById('nope', poolOf())
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({ id: 'nope', missing: true, depth: 0 })
  })

  it('uses the root object even when it is absent from the pool', () => {
    const b = makeConclusion('b')
    const a = makeConclusion('a', ['b'])
    const result = traceChain(a, poolOf(b))
    expect(result.orderedIds).toEqual(['a', 'b'])
    expect(result.steps[0].missing).toBe(false)
  })
})
