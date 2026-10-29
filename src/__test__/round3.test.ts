import { describe, expect, it, vi } from 'vitest'
import { HonchoClient } from '../api/client'
import { DemoHonchoApi } from '../api/demoClient'
import { fetchConclusionsCapped, CONCLUSIONS_CAP } from '../lib/conclusions'
import { StatsCollector, STATS_RING_CAP } from '../lib/stats'
import type { Conclusion, Page } from '../types'

// Round-3 foundations: capped conclusions fetch (cap / label data /
// dedupe / concurrency), size=1 counts, the 60s in-memory cache and its
// write invalidation, workspace chat + scopes client shapes, the stats
// ring cap, and demo fixture determinism/shape.

function jsonResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as Response
}

function makeConclusion(id: string, index: number): Conclusion {
  return {
    id,
    content: `conclusion ${id}`,
    observer_id: 'hermes',
    observed_id: 'radoslav',
    session_id: 's1',
    level: 'explicit',
    source_ids: [],
    source_message_ids: [],
    times_derived: 1,
    created_at: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  }
}

function pagedFetcher(total: number, calls: number[]) {
  return async (page: number, size: number): Promise<Page<Conclusion>> => {
    calls.push(page)
    const start = (page - 1) * size
    const items: Conclusion[] = []
    for (let i = start; i < Math.min(start + size, total); i += 1) {
      items.push(makeConclusion(`c${i}`, i))
    }
    return { items, total, page, size, pages: Math.ceil(total / size) }
  }
}

describe('fetchConclusionsCapped', () => {
  it('fetches every page of 100 when under the cap', async () => {
    const calls: number[] = []
    const result = await fetchConclusionsCapped(pagedFetcher(250, calls))
    expect(result.total).toBe(250)
    expect(result.items).toHaveLength(250)
    expect(result.capped).toBe(false)
    expect(calls).toEqual([1, 2, 3])
  })

  it('hard-caps at 2,000 and reports capped=true with the honest total', async () => {
    const calls: number[] = []
    const result = await fetchConclusionsCapped(pagedFetcher(5300, calls))
    expect(result.items).toHaveLength(CONCLUSIONS_CAP)
    expect(result.total).toBe(5300)
    expect(result.capped).toBe(true)
    expect(calls).toHaveLength(20)
  })

  it('dedupes overlapping pages by id', async () => {
    const fetcher = async (page: number, size: number): Promise<Page<Conclusion>> => {
      const items = [makeConclusion('dup', 1), makeConclusion(`p${page}`, page)]
      return { items, total: 150, page, size, pages: 2 }
    }
    const result = await fetchConclusionsCapped(fetcher)
    expect(result.items.map((item) => item.id)).toEqual(['dup', 'p1', 'p2'])
  })

  it('never runs more than 4 page requests in flight', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetcher = async (page: number, size: number): Promise<Page<Conclusion>> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      const start = (page - 1) * size
      const items: Conclusion[] = []
      for (let i = start; i < start + size; i += 1) items.push(makeConclusion(`c${i}`, i))
      return { items, total: 1000, page, size, pages: 10 }
    }
    const result = await fetchConclusionsCapped(fetcher)
    expect(result.items).toHaveLength(1000)
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })
})

describe('HonchoClient round-3 methods', () => {
  function clientWith(handler: (url: string, init: { method: string; body?: string }) => unknown) {
    const fetchFn = vi.fn(async (url: string, init: { method: string; body?: string }) =>
      jsonResponse(handler(url, init)),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    return { client, fetchFn }
  }

  it('getWorkspaceCounts uses size=1 totals incl. per-level calls', async () => {
    const { client, fetchFn } = clientWith((url) => {
      if (url.includes('/peers/list')) return { items: [], total: 3, page: 1, size: 1, pages: 3 }
      if (url.includes('/sessions/list')) return { items: [], total: 6, page: 1, size: 1, pages: 6 }
      return { items: [], total: 7, page: 1, size: 1, pages: 7 }
    })
    const counts = await client.getWorkspaceCounts('hermes')
    expect(counts.peers).toBe(3)
    expect(counts.sessions).toBe(6)
    expect(counts.conclusions).toBe(7)
    expect(counts.byLevel.explicit).toBe(7)
    const urls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))
    expect(urls.every((url) => url.includes('size=1'))).toBe(true)
    expect(urls).toHaveLength(7)
  })

  it('fetchConclusionsCapped caches for 60s and deleteConclusion invalidates', async () => {
    let listCalls = 0
    const { client } = clientWith((_url, init) => {
      if (init.method === 'DELETE') return {}
      listCalls += 1
      return {
        items: [makeConclusion('c1', 1)],
        total: 1,
        page: 1,
        size: 100,
        pages: 1,
      }
    })
    const first = await client.fetchConclusionsCapped('hermes')
    const second = await client.fetchConclusionsCapped('hermes')
    expect(first).toBe(second)
    expect(listCalls).toBe(1)
    await client.deleteConclusion('hermes', 'c1')
    await client.fetchConclusionsCapped('hermes')
    expect(listCalls).toBe(2)
  })

  it('chatWorkspace posts include_evidence:true, non-streaming', async () => {
    const { client, fetchFn } = clientWith(() => ({
      content: 'answer',
      evidence: { conclusions: [], messages: [], tool_calls: [] },
    }))
    const result = await client.chatWorkspace('hermes', 'what do you know?')
    expect(result.content).toBe('answer')
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/hermes/chat')
    expect(JSON.parse(init.body)).toMatchObject({
      query: 'what do you know?',
      include_evidence: true,
      stream: false,
    })
  })

  it('listScopes / getScopeStatus hit the spec paths', async () => {
    const { client, fetchFn } = clientWith((url) => {
      if (url.includes('/status')) return { backfill_status: {} }
      return { items: [{ id: 'personal', metadata: {}, created_at: '2026-01-01T00:00:00Z' }], total: 1, page: 1, size: 50, pages: 1 }
    })
    const scopes = await client.listScopes('hermes')
    expect(scopes.items[0].id).toBe('personal')
    await client.getScopeStatus('hermes', 'personal')
    const urls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))
    expect(urls[0]).toBe('http://honcho.local:8000/v3/workspaces/hermes/scopes/list?page=1&size=50')
    expect(urls[1]).toBe('http://honcho.local:8000/v3/workspaces/hermes/scopes/personal/status')
  })

  it('queryConclusions posts query + top_k to conclusions/query', async () => {
    const { client, fetchFn } = clientWith(() => [makeConclusion('c9', 9)])
    const results = await client.queryConclusions('hermes', 'preferences', 5)
    expect(results).toHaveLength(1)
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/hermes/conclusions/query')
    expect(JSON.parse(init.body)).toMatchObject({ query: 'preferences', top_k: 5 })
  })
})

describe('StatsCollector ring cap', () => {
  it('keeps at most 1,000 records and reports startedAt', () => {
    const collector = new StatsCollector(1234)
    for (let i = 0; i < STATS_RING_CAP + 25; i += 1) {
      collector.recordLabel('GET session', 200, 10)
    }
    const stats = collector.snapshot()
    expect(stats.totalCalls).toBe(STATS_RING_CAP)
    expect(stats.startedAt).toBe(1234)
    expect(stats.ringCapped).toBe(true)
  })
})

describe('demo fixtures (round 3)', () => {
  it('hermes has 3 peers, 6 sessions, 120 conclusions across all levels', async () => {
    const demo = new DemoHonchoApi()
    const counts = await demo.getWorkspaceCounts('hermes')
    expect(counts.peers).toBe(3)
    expect(counts.sessions).toBe(6)
    expect(counts.conclusions).toBe(120)
    expect(counts.byLevel.explicit).toBeGreaterThan(0)
    expect(counts.byLevel.deductive).toBeGreaterThan(0)
    expect(counts.byLevel.inductive).toBeGreaterThan(0)
    expect(counts.byLevel.contradiction).toBeGreaterThanOrEqual(2)
  })

  it('test-1 stays small at 10 conclusions', async () => {
    const demo = new DemoHonchoApi()
    const counts = await demo.getWorkspaceCounts('test-1')
    expect(counts.conclusions).toBe(10)
  })

  it('hermes conclusions have chains at least 3 deep and times_derived 1-6', async () => {
    const demo = new DemoHonchoApi()
    const capped = await demo.fetchConclusionsCapped('hermes')
    const byId = new Map(capped.items.map((item) => [item.id, item]))
    let maxDepth = 0
    for (const item of capped.items) {
      let depth = 0
      let current: Conclusion | undefined = item
      const guard = new Set<string>()
      while (current && current.source_ids.length > 0 && !guard.has(current.id)) {
        guard.add(current.id)
        depth += 1
        current = byId.get(current.source_ids[0])
      }
      maxDepth = Math.max(maxDepth, depth)
      expect(item.times_derived).toBeGreaterThanOrEqual(1)
      expect(item.times_derived).toBeLessThanOrEqual(6)
    }
    expect(maxDepth).toBeGreaterThanOrEqual(3)
  })

  it('fixture generation is deterministic across instances', async () => {
    const a = new DemoHonchoApi()
    const b = new DemoHonchoApi()
    const first = await a.fetchConclusionsCapped('hermes')
    const second = await b.fetchConclusionsCapped('hermes')
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id))
    expect(second.items.map((item) => item.created_at)).toEqual(
      first.items.map((item) => item.created_at),
    )
    const times = first.items.map((item) => new Date(item.created_at).getTime())
    const span = Math.max(...times) - Math.min(...times)
    expect(span).toBeGreaterThan(120 * 24 * 3600 * 1000)
  })

  it('demo queryConclusions ranks lexically and deterministically', async () => {
    const demo = new DemoHonchoApi()
    const results = await demo.queryConclusions('test-1', 'sci-fi novels', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].content.toLowerCase()).toContain('sci-fi')
    const again = await demo.queryConclusions('test-1', 'sci-fi novels', 5)
    expect(again.map((item) => item.id)).toEqual(results.map((item) => item.id))
  })

  it('demo chatWorkspace returns evidence', async () => {
    const demo = new DemoHonchoApi()
    const result = await demo.chatWorkspace('hermes', 'preferences')
    expect(result.content).toContain('Demo answer')
    expect(result.evidence).not.toBeNull()
  })
})

import { aggregateEdges, layoutConstellation, layoutNetwork } from '../lib/memoryGraph'

function graphConclusion(id: string, observer: string, observed: string, index: number, level: Conclusion['level'] = 'explicit'): Conclusion {
  return {
    id,
    content: `c ${id}`,
    observer_id: observer,
    observed_id: observed,
    session_id: 's1',
    level,
    source_ids: [],
    source_message_ids: [],
    times_derived: (index % 6) + 1,
    created_at: `2026-02-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  }
}

describe('memoryGraph layout', () => {
  it('is deterministic: identical input gives identical coordinates', () => {
    const items = Array.from({ length: 60 }, (_, i) => graphConclusion(`g${i}`, 'hermes', i % 2 ? 'alice' : 'bob', i))
    const first = layoutConstellation(items, ['bob', 'alice', 'hermes'])
    const second = layoutConstellation(items, ['hermes', 'alice', 'bob'])
    expect(second).toEqual(first)
  })

  it('dedupes by id and keeps coordinates bounded', () => {
    const items = Array.from({ length: 300 }, (_, i) => graphConclusion(`g${i % 250}`, 'hermes', 'alice', i))
    const layout = layoutConstellation(items, ['alice', 'hermes'])
    expect(layout.total).toBe(250)
    expect(layout.dots).toHaveLength(250)
    for (const dot of layout.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(8)
      expect(dot.x).toBeLessThanOrEqual(760 - 8)
      expect(dot.y).toBeGreaterThanOrEqual(8)
      expect(dot.y).toBeLessThanOrEqual(560 - 8)
      expect(dot.r).toBeGreaterThanOrEqual(3)
      expect(dot.r).toBeLessThanOrEqual(7)
    }
  })

  it('shrinks dots to 2px above 500 conclusions', () => {
    const items = Array.from({ length: 600 }, (_, i) => graphConclusion(`g${i}`, 'hermes', 'alice', i))
    const layout = layoutConstellation(items, ['alice', 'hermes'])
    expect(layout.dots.every((dot) => dot.r === 2)).toBe(true)
  })

  it('aggregates into density cells above 5,000 conclusions', () => {
    const items = Array.from({ length: 5001 }, (_, i) =>
      graphConclusion(`g${i}`, 'hermes', i % 2 ? 'alice' : 'bob', i, i % 3 ? 'explicit' : 'deductive'),
    )
    const layout = layoutConstellation(items, ['alice', 'bob', 'hermes'])
    expect(layout.aggregated).toBe(true)
    expect(layout.dots).toHaveLength(0)
    expect(layout.cells).toHaveLength(2)
    expect(layout.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(5001)
  })

  it('aggregates network edges with counts and dominant level', () => {
    const items = [
      graphConclusion('a', 'hermes', 'alice', 1, 'explicit'),
      graphConclusion('b', 'hermes', 'alice', 2, 'explicit'),
      graphConclusion('c', 'hermes', 'alice', 3, 'deductive'),
      graphConclusion('d', 'alice', 'hermes', 4, 'inductive'),
    ]
    const edges = aggregateEdges(items)
    expect(edges).toHaveLength(2)
    expect(edges[0]).toMatchObject({ observer: 'alice', observed: 'hermes', count: 1 })
    expect(edges[1]).toMatchObject({ observer: 'hermes', observed: 'alice', count: 3, dominantLevel: 'explicit' })
    const network = layoutNetwork(items, ['alice', 'hermes'])
    expect(network.edges).toHaveLength(2)
    expect(network.edges[1].width).toBeGreaterThan(network.edges[0].width)
  })
})
