import { describe, expect, it } from 'vitest'
import { parseHash, routeToHash } from '../lib/routing'

// Phase C: the Conclusions route gained an explicit id allow-list
// (?ids=a,b,c) so Fault Lines can open the Explorer filtered to
// exactly one cluster's members.

describe('conclusions route ids param', () => {
  it('round-trips an id list through hash encode/parse', () => {
    const hash = routeToHash({
      name: 'conclusions',
      workspaceId: 'hermes',
      filters: {
        observer: '',
        observed: '',
        level: '',
        sessionId: '',
        ids: ['concl_hermes_g116', 'concl_hermes_g117'],
      },
    })
    expect(hash).toBe('#/conclusions/hermes?ids=concl_hermes_g116%2Cconcl_hermes_g117')
    const parsed = parseHash(hash)
    expect(parsed).toEqual({
      name: 'conclusions',
      workspaceId: 'hermes',
      filters: {
        observer: '',
        observed: '',
        level: '',
        sessionId: '',
        ids: ['concl_hermes_g116', 'concl_hermes_g117'],
      },
    })
  })

  it('omits the param when the id list is empty and parses a missing param as []', () => {
    const hash = routeToHash({
      name: 'conclusions',
      workspaceId: 'hermes',
      filters: { observer: '', observed: '', level: 'contradiction', sessionId: '', ids: [] },
    })
    expect(hash).toBe('#/conclusions/hermes?level=contradiction')
    const parsed = parseHash(hash)
    if (parsed.name !== 'conclusions') throw new Error('expected conclusions route')
    expect(parsed.filters.ids).toEqual([])
  })

  it('combines ids with the existing filters', () => {
    const parsed = parseHash('#/conclusions/hermes?level=contradiction&ids=a,b')
    if (parsed.name !== 'conclusions') throw new Error('expected conclusions route')
    expect(parsed.filters.level).toBe('contradiction')
    expect(parsed.filters.ids).toEqual(['a', 'b'])
  })
})
