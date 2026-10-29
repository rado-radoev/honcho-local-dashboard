import { describe, expect, it } from 'vitest'
import {
  RADIUS_BAND_LABELS,
  computeDerivationDepths,
  monthTicksForPeer,
  radiusBandForDepth,
} from '../lib/derivationDepth'
import { layoutConstellationRadius, radiusBandCenter } from '../lib/memoryGraph'
import type { Conclusion } from '../types'

// Reasoning Radius depth: LONGEST in-set ancestor chain, cycle-safe,
// missing sources contribute no hop, display bands cap at 3+.

function makeConclusion(
  id: string,
  sourceIds: string[] = [],
  overrides: Partial<Conclusion> = {},
): Conclusion {
  return {
    id,
    content: `conclusion ${id}`,
    observer_id: 'hermes',
    observed_id: 'radoslav',
    session_id: 's1',
    level: 'deductive',
    source_ids: sourceIds,
    source_message_ids: [],
    times_derived: 1,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('computeDerivationDepths', () => {
  it('gives a linear chain depths 0, 1, 2, 3 from the said root', () => {
    const d = makeConclusion('d', [], { level: 'explicit' })
    const c = makeConclusion('c', ['d'])
    const b = makeConclusion('b', ['c'])
    const a = makeConclusion('a', ['b'])
    const depths = computeDerivationDepths([a, b, c, d])
    expect(depths.get('d')).toBe(0)
    expect(depths.get('c')).toBe(1)
    expect(depths.get('b')).toBe(2)
    expect(depths.get('a')).toBe(3)
  })

  it('uses the LONGEST chain when a conclusion has shallow and deep sources', () => {
    const root = makeConclusion('root', [], { level: 'explicit' })
    const shallow = makeConclusion('shallow', ['root'])
    const mid = makeConclusion('mid', ['root'])
    const deep = makeConclusion('deep', ['mid'])
    // First-listed source is the shallow one: a first-found walk
    // would give 2, the longest-chain rule must give 3.
    const top = makeConclusion('top', ['shallow', 'deep'])
    const depths = computeDerivationDepths([top, shallow, deep, mid, root])
    expect(depths.get('shallow')).toBe(1)
    expect(depths.get('deep')).toBe(2)
    expect(depths.get('top')).toBe(3)
  })

  it('counts a diamond-shared ancestor once, at its longest depth', () => {
    const root = makeConclusion('root', [], { level: 'explicit' })
    const b = makeConclusion('b', ['root'])
    const c = makeConclusion('c', ['b'])
    const a = makeConclusion('a', ['b', 'c'])
    const depths = computeDerivationDepths([a, b, c, root])
    expect(depths.get('a')).toBe(3)
  })

  it('is cycle-safe: A -> B -> A terminates with deterministic depths', () => {
    const a = makeConclusion('a', ['b'])
    const b = makeConclusion('b', ['a'])
    const depths = computeDerivationDepths([a, b])
    // Roots walk in id order: B's only source is the in-progress A
    // (back-edge, no hop) so B = 0, then A = 1.
    expect(depths.get('b')).toBe(0)
    expect(depths.get('a')).toBe(1)
  })

  it('is cycle-safe for a self-referencing conclusion (depth 0)', () => {
    const depths = computeDerivationDepths([makeConclusion('a', ['a'])])
    expect(depths.get('a')).toBe(0)
  })

  it('missing sources contribute no hop', () => {
    const only = makeConclusion('only', ['ghost'])
    const real = makeConclusion('real', [], { level: 'explicit' })
    const mixed = makeConclusion('mixed', ['ghost', 'real'])
    const depths = computeDerivationDepths([only, mixed, real])
    expect(depths.get('only')).toBe(0)
    expect(depths.get('mixed')).toBe(1)
  })

  it('an explicit conclusion with only source_message_ids is depth 0', () => {
    const item = makeConclusion('said', [], {
      level: 'explicit',
      source_message_ids: ['msg_1', 'msg_2'],
    })
    expect(computeDerivationDepths([item]).get('said')).toBe(0)
  })

  it('does not depend on input order', () => {
    const items = [
      makeConclusion('a', ['b']),
      makeConclusion('b', ['c']),
      makeConclusion('c', [], { level: 'explicit' }),
    ]
    const forward = computeDerivationDepths(items)
    const reversed = computeDerivationDepths([...items].reverse())
    expect(Object.fromEntries(reversed)).toEqual(Object.fromEntries(forward))
  })
})

describe('radiusBandForDepth', () => {
  it('keeps bands 0, 1, 2 and caps everything deeper at 3+', () => {
    expect(radiusBandForDepth(0)).toBe(0)
    expect(radiusBandForDepth(1)).toBe(1)
    expect(radiusBandForDepth(2)).toBe(2)
    expect(radiusBandForDepth(3)).toBe(3)
    expect(radiusBandForDepth(5)).toBe(3)
    expect(radiusBandForDepth(40)).toBe(3)
    expect(RADIUS_BAND_LABELS).toEqual(['Said', 'Derived ×1', 'Derived ×2', 'Derived ×3+'])
  })
})

describe('monthTicksForPeer', () => {
  it('returns distinct months for that peer only, in chronological order', () => {
    const items = [
      makeConclusion('a', [], { created_at: '2026-10-03T00:00:00Z' }),
      makeConclusion('b', [], { created_at: '2026-04-20T00:00:00Z' }),
      makeConclusion('c', [], { created_at: '2026-04-01T00:00:00Z' }),
      makeConclusion('d', [], {
        observed_id: 'claude',
        created_at: '2026-06-01T00:00:00Z',
      }),
    ]
    const ticks = monthTicksForPeer(items, 'radoslav')
    expect(ticks.map((tick) => tick.key)).toEqual(['2026-04', '2026-10'])
    expect(ticks.map((tick) => tick.label)).toEqual(['Apr', 'Oct'])
    // Spread evenly from the top of the hub.
    expect(ticks[0].angle).toBeCloseTo(-Math.PI / 2)
    expect(ticks[1].angle).toBeCloseTo(Math.PI / 2)
  })

  it('returns no ticks for a peer with no conclusions', () => {
    expect(monthTicksForPeer([makeConclusion('a')], 'nobody')).toEqual([])
  })
})

describe('layoutConstellationRadius', () => {
  it('places each dot at its band centre (± sub-ring) from its hub', () => {
    const items: Conclusion[] = []
    let previous: string | null = null
    for (let index = 0; index < 6; index += 1) {
      const id = `chain${index}`
      items.push(
        makeConclusion(id, previous ? [previous] : [], {
          level: index === 0 ? 'explicit' : 'deductive',
          created_at: `2026-01-0${index + 1}T00:00:00Z`,
        }),
      )
      previous = id
    }
    const depths = computeDerivationDepths(items)
    const layout = layoutConstellationRadius(items, ['radoslav'], depths)
    const hub = layout.hubs[0]
    for (const dot of layout.dots) {
      const distance = Math.hypot(dot.x - hub.x, dot.y - hub.y)
      const centre = radiusBandCenter(dot.band)
      expect(Math.abs(distance - centre)).toBeLessThanOrEqual(6.01)
      expect(dot.depth).toBe(depths.get(dot.conclusion.id))
    }
    // Depth 5 bands to 3+ and sits strictly outside the depth-0 dot.
    const deep = layout.dots.find((dot) => dot.conclusion.id === 'chain5')!
    const said = layout.dots.find((dot) => dot.conclusion.id === 'chain0')!
    expect(deep.band).toBe(3)
    expect(Math.hypot(deep.x - hub.x, deep.y - hub.y)).toBeGreaterThan(
      Math.hypot(said.x - hub.x, said.y - hub.y),
    )
    // Size encoding is unchanged: radius still follows times_derived.
    const big = layoutConstellationRadius(
      [makeConclusion('big', [], { times_derived: 6 })],
      ['radoslav'],
      new Map([['big', 0]]),
    )
    expect(big.dots[0].r).toBe(7)
  })
})
