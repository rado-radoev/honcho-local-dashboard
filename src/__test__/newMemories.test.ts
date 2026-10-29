import { describe, expect, it } from 'vitest'
import { diffConclusionIds } from '../lib/newMemories'
import { DemoHonchoApi } from '../api/demoClient'
import { DEMO_PULSE_CONCLUSION_IDS } from '../api/demoFixtures'

// New-memory diff: first load never pulses, additions only, removals
// ignored, order + dedupe from the next set. Plus the demo fixture
// flag that makes the pulse exercisable end-to-end in demo mode.

describe('diffConclusionIds', () => {
  it('returns nothing on first load (null previous set)', () => {
    expect(diffConclusionIds(null, ['a', 'b', 'c'])).toEqual([])
    expect(diffConclusionIds(undefined, ['a'])).toEqual([])
  })

  it('returns nothing when the set is unchanged', () => {
    expect(diffConclusionIds(new Set(['a', 'b']), ['b', 'a'])).toEqual([])
    expect(diffConclusionIds(['a', 'b'], [])).toEqual([])
  })

  it('returns only the added ids, in next-set order', () => {
    expect(diffConclusionIds(new Set(['a', 'b']), ['x', 'a', 'y', 'b'])).toEqual(['x', 'y'])
  })

  it('ignores removals', () => {
    expect(diffConclusionIds(new Set(['a', 'b', 'c']), ['a'])).toEqual([])
  })

  it('dedupes repeated ids in the next set', () => {
    expect(diffConclusionIds(new Set(['a']), ['n', 'n', 'a', 'n'])).toEqual(['n'])
  })

  it('accepts arrays and sets interchangeably', () => {
    expect(diffConclusionIds(['a'], new Set(['a', 'b']))).toEqual(['b'])
  })

  it('treats an empty previous set as a real (non-first) load', () => {
    expect(diffConclusionIds(new Set(), ['a'])).toEqual(['a'])
  })
})

describe('demo pulse fixture flag', () => {
  it('a pulse-enabled demo client adds the pulse conclusions on its second capped fetch', async () => {
    const demo = new DemoHonchoApi({ pulse: true })
    const first = await demo.fetchConclusionsCapped('hermes')
    expect(first.items).toHaveLength(120)
    const second = await demo.fetchConclusionsCapped('hermes')
    expect(second.items).toHaveLength(120 + DEMO_PULSE_CONCLUSION_IDS.length)
    const fresh = diffConclusionIds(
      new Set(first.items.map((item) => item.id)),
      second.items.map((item) => item.id),
    )
    expect(fresh).toEqual(DEMO_PULSE_CONCLUSION_IDS)
    // Third fetch: the pulse set is stable, nothing new appears.
    const third = await demo.fetchConclusionsCapped('hermes')
    expect(
      diffConclusionIds(
        new Set(second.items.map((item) => item.id)),
        third.items.map((item) => item.id),
      ),
    ).toEqual([])
  })

  it('a default demo client never pulses (fixtures stay static)', async () => {
    const demo = new DemoHonchoApi()
    const first = await demo.fetchConclusionsCapped('hermes')
    const second = await demo.fetchConclusionsCapped('hermes')
    expect(second.items).toHaveLength(first.items.length)
  })

  it('the pulse does not leak into other workspaces', async () => {
    const demo = new DemoHonchoApi({ pulse: true })
    await demo.fetchConclusionsCapped('test-1')
    const second = await demo.fetchConclusionsCapped('test-1')
    expect(second.items).toHaveLength(10)
    expect(second.items.some((item) => item.id.startsWith('concl_demo_pulse'))).toBe(false)
  })
})
