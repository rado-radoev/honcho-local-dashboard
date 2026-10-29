import { describe, expect, it, vi } from 'vitest'
import { HonchoClient } from '../api/client'
import { DemoHonchoApi } from '../api/demoClient'
import {
  buildBodySkeleton,
  buildCurl,
  extractPathParams,
  groupEndpointsByTag,
  parseEndpoints,
  type OpenApiDoc,
} from '../api/openapi'
import { aggregateStats, endpointLabel, StatsCollector, seedDemoStats } from '../lib/stats'
import { normalizePage } from '../lib/page'

// Round-2 tests: write methods, Playground spec handling, generic
// execute(), performance stats aggregation, and the Work Item 5 audit
// (realistic live-shaped payloads + CursorPage normalization).

function jsonResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as Response
}

function recordingFetch(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

function calls(fetchFn: unknown) {
  return (fetchFn as ReturnType<typeof vi.fn>).mock.calls
}

describe('write methods (Work Item 1e)', () => {
  it('createWorkspace POSTs {id} to /v3/workspaces', async () => {
    const fetchFn = recordingFetch(
      jsonResponse({ id: 'new-ws', uid: 'u1', metadata: {}, configuration: {}, created_at: '2026-01-01T00:00:00Z' }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.createWorkspace('new-ws')
    expect(result.id).toBe('new-ws')
    const [url, init] = calls(fetchFn)[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ id: 'new-ws' })
  })

  it('updateWorkspace PUTs metadata+configuration', async () => {
    const fetchFn = recordingFetch(
      jsonResponse({ id: 'test-1', uid: 'u1', metadata: { a: 1 }, configuration: {}, created_at: '2026-01-01T00:00:00Z' }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    await client.updateWorkspace('test-1', { metadata: { a: 1 }, configuration: {} })
    const [url, init] = calls(fetchFn)[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/test-1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ metadata: { a: 1 }, configuration: {} })
  })

  it('createPeer / createSession POST {id} to the nested paths', async () => {
    const fetchFn = recordingFetch(
      jsonResponse({ id: 'x', uid: 'u', workspace_id: 'test-1', created_at: '2026-01-01T00:00:00Z', metadata: {}, configuration: {}, is_active: true }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    await client.createPeer('test-1', 'dave')
    await client.createSession('test-1', 'chat-9')
    expect(calls(fetchFn)[0][0]).toBe('http://honcho.local:8000/v3/workspaces/test-1/peers')
    expect(JSON.parse(calls(fetchFn)[0][1].body)).toEqual({ id: 'dave' })
    expect(calls(fetchFn)[1][0]).toBe('http://honcho.local:8000/v3/workspaces/test-1/sessions')
    expect(JSON.parse(calls(fetchFn)[1][1].body)).toEqual({ id: 'chat-9' })
  })

  it('addPeersToSession POSTs a {peerId: {}} map', async () => {
    const fetchFn = recordingFetch(
      jsonResponse({ id: 's1', uid: 'u', workspace_id: 'test-1', created_at: '2026-01-01T00:00:00Z', metadata: {}, configuration: {}, is_active: true }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    await client.addPeersToSession('test-1', 's1', ['alice', 'bob'])
    const [url, init] = calls(fetchFn)[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/test-1/sessions/s1/peers')
    expect(JSON.parse(init.body)).toEqual({ alice: {}, bob: {} })
  })

  it('createKey POSTs /v3/keys with scope query params and no body', async () => {
    const fetchFn = recordingFetch(jsonResponse('hch-real-key'))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const key = await client.createKey({ workspaceId: 'test-1', peerId: 'alice' })
    expect(key).toBe('hch-real-key')
    const [url, init] = calls(fetchFn)[0]
    expect(url).toBe('http://honcho.local:8000/v3/keys?workspace_id=test-1&peer_id=alice')
    expect(init.method).toBe('POST')
  })

  it('webhooks list/create/delete hit the spec paths', async () => {
    const page = { items: [{ id: 'wh1', workspace_id: 'test-1', url: 'https://x.example/h', created_at: '2026-01-01T00:00:00Z' }], total: 1, page: 1, size: 50, pages: 1 }
    const fetchFn = recordingFetch(jsonResponse(page))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const listed = await client.listWebhooks('test-1')
    expect(listed.items).toHaveLength(1)
    expect(calls(fetchFn)[0][0]).toContain('/v3/workspaces/test-1/webhooks')

    const fetchFn2 = recordingFetch(jsonResponse(page.items[0], 201))
    const client2 = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn: fetchFn2 })
    await client2.createWebhook('test-1', 'https://x.example/h')
    expect(JSON.parse(calls(fetchFn2)[0][1].body)).toEqual({ url: 'https://x.example/h' })

    const fetchFn3 = recordingFetch(jsonResponse('', 200))
    const client3 = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn: fetchFn3 })
    await client3.deleteWebhook('test-1', 'wh1')
    expect(calls(fetchFn3)[0][1].method).toBe('DELETE')
    expect(calls(fetchFn3)[0][0]).toBe('http://honcho.local:8000/v3/workspaces/test-1/webhooks/wh1')
  })
})

describe('Work Item 5 audit — live-shaped payloads', () => {
  // Exactly the spec's Workspace schema for the user's real workspace.
  const hermesWorkspace = {
    id: 'hermes',
    uid: 'a1b2c3d4-0000-4000-8000-000000000001',
    metadata: {},
    configuration: {},
    created_at: '2026-10-19T09:12:44.123456Z',
  }

  it('listWorkspaces returns the hermes item from a Page_Workspace_ body', async () => {
    const fetchFn = recordingFetch(
      jsonResponse({ items: [hermesWorkspace], total: 1, page: 1, size: 50, pages: 1 }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.listWorkspaces()
    expect(result.total).toBe(1)
    expect(result.items.map((workspace) => workspace.id)).toEqual(['hermes'])
    expect(result.items[0].uid).toBe(hermesWorkspace.uid)
  })

  it('listWorkspaces survives a CursorPage_ body (items, total null, no pages)', async () => {
    const fetchFn = recordingFetch(
      jsonResponse({
        items: [hermesWorkspace],
        total: null,
        current_page: 'cursor-abc',
        current_page_backwards: null,
        previous_page: null,
        next_page: null,
      }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.listWorkspaces()
    expect(result.items.map((workspace) => workspace.id)).toEqual(['hermes'])
    expect(result.total).toBe(1)
    expect(result.pages).toBe(1)
    expect(Number.isFinite(result.page)).toBe(true)
  })

  it('listPeers / listSessions return live-shaped items (uid fields)', async () => {
    const peer = {
      id: 'hermes',
      uid: 'peer-uid-1',
      workspace_id: 'hermes',
      created_at: '2026-10-19T09:13:03Z',
      metadata: {},
      configuration: {},
    }
    const fetchFn = recordingFetch(jsonResponse({ items: [peer], total: 1, page: 1, size: 50, pages: 1 }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const peers = await client.listPeers('hermes')
    expect(peers.items[0].id).toBe('hermes')
    expect(peers.items[0].uid).toBe('peer-uid-1')

    const session = {
      id: 'hermes-desktop',
      uid: 'session-uid-1',
      is_active: true,
      workspace_id: 'hermes',
      metadata: {},
      configuration: {},
      created_at: '2026-10-20T16:02:11Z',
    }
    const fetchFn2 = recordingFetch(jsonResponse({ items: [session], total: 1, page: 1, size: 50, pages: 1 }))
    const client2 = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn: fetchFn2 })
    const sessions = await client2.listSessions('hermes')
    expect(sessions.items[0].id).toBe('hermes-desktop')
    expect(sessions.items[0].is_active).toBe(true)
  })

  it('missing metadata/configuration are coerced to {}', async () => {
    const bare = { id: 'hermes', uid: 'u9', created_at: '2026-10-19T09:12:44Z' }
    const fetchFn = recordingFetch(jsonResponse({ items: [bare], total: 1, page: 1, size: 50, pages: 1 }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.listWorkspaces()
    expect(result.items[0].metadata).toEqual({})
    expect(result.items[0].configuration).toEqual({})
  })

  it('listSessionsForPeer requests ?page=1&size=50', async () => {
    const fetchFn = recordingFetch(jsonResponse({ items: [], total: 0, page: 1, size: 50, pages: 0 }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    await client.listSessionsForPeer('hermes', 'alice')
    const [url, init] = calls(fetchFn)[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/hermes/peers/alice/sessions?page=1&size=50')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({})
  })

  it('missing/null metadata/configuration are coerced to {} for peers', async () => {
    const missing = { id: 'alice', uid: 'p1', workspace_id: 'hermes', created_at: '2026-10-19T09:13:03Z' }
    const nulled = {
      id: 'bob',
      uid: 'p2',
      workspace_id: 'hermes',
      created_at: '2026-10-19T09:13:04Z',
      metadata: null,
      configuration: null,
    }
    const fetchFn = recordingFetch(
      jsonResponse({ items: [missing, nulled], total: 2, page: 1, size: 50, pages: 1 }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.listPeers('hermes')
    expect(result.items[0].metadata).toEqual({})
    expect(result.items[0].configuration).toEqual({})
    expect(result.items[1].metadata).toEqual({})
    expect(result.items[1].configuration).toEqual({})
  })

  it('missing/null metadata/configuration are coerced to {} for sessions', async () => {
    const missing = {
      id: 's-missing',
      uid: 's1',
      is_active: true,
      workspace_id: 'hermes',
      created_at: '2026-10-20T16:02:11Z',
    }
    const nulled = {
      id: 's-null',
      uid: 's2',
      is_active: false,
      workspace_id: 'hermes',
      created_at: '2026-10-20T16:02:12Z',
      metadata: null,
      configuration: null,
    }
    const fetchFn = recordingFetch(
      jsonResponse({ items: [missing, nulled], total: 2, page: 1, size: 50, pages: 1 }),
    )
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.listSessions('hermes')
    expect(result.items[0].metadata).toEqual({})
    expect(result.items[0].configuration).toEqual({})
    expect(result.items[1].metadata).toEqual({})
    expect(result.items[1].configuration).toEqual({})
  })

  it('normalizePage handles Page, CursorPage and items-only bodies', () => {
    expect(normalizePage({ items: [1, 2], total: 2, page: 1, size: 50, pages: 1 })).toEqual({
      items: [1, 2], total: 2, page: 1, size: 50, pages: 1,
    })
    const cursor = normalizePage({ items: [1], total: null, current_page: 'x' }, 1, 50)
    expect(cursor.total).toBe(1)
    expect(cursor.pages).toBe(1)
    expect(normalizePage(null).items).toEqual([])
  })

  it('list request shapes match the spec ({} body, page/size query)', async () => {
    const fetchFn = recordingFetch(jsonResponse({ items: [], total: 0, page: 1, size: 50, pages: 0 }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    await client.listPeers('hermes')
    await client.listSessions('hermes')
    await client.listMessages('hermes', 's1')
    const urls = calls(fetchFn).map((call) => call[0] as string)
    expect(urls[0]).toBe('http://honcho.local:8000/v3/workspaces/hermes/peers/list?page=1&size=50')
    expect(urls[1]).toBe('http://honcho.local:8000/v3/workspaces/hermes/sessions/list?page=1&size=50')
    expect(urls[2]).toBe('http://honcho.local:8000/v3/workspaces/hermes/sessions/s1/messages/list?page=1&size=50')
    for (const call of calls(fetchFn)) expect(JSON.parse(call[1].body)).toEqual({})
  })
})

describe('Playground spec handling', () => {
  const doc: OpenApiDoc = {
    info: { version: '3.4.1' },
    paths: {
      '/v3/workspaces': {
        post: {
          summary: 'Get Or Create Workspace',
          tags: ['workspaces'],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkspaceCreate' } } } },
        },
      },
      '/v3/workspaces/{workspace_id}/sessions/{session_id}/messages': {
        post: {
          summary: 'Create Messages For Session',
          tags: ['messages'],
          parameters: [
            { name: 'workspace_id', in: 'path', required: true },
            { name: 'session_id', in: 'path', required: true },
          ],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageBatchCreate' } } } },
        },
      },
      '/health': { get: { summary: 'Health Check', tags: [] } },
    },
    components: {
      schemas: {
        WorkspaceCreate: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' }, metadata: { type: 'object' } },
        },
        MessageBatchCreate: {
          type: 'object',
          required: ['messages'],
          properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/MessageCreate' } } },
        },
        MessageCreate: {
          type: 'object',
          required: ['content', 'peer_id'],
          properties: { content: { type: 'string' }, peer_id: { type: 'string' }, metadata: { type: 'object' } },
        },
      },
    },
  }

  it('parses endpoints and groups by tag', () => {
    const endpoints = parseEndpoints(doc)
    expect(endpoints).toHaveLength(3)
    const groups = groupEndpointsByTag(endpoints)
    const tags = groups.map((group) => group.tag).sort()
    expect(tags).toContain('workspaces')
    expect(tags).toContain('messages')
  })

  it('extracts path params', () => {
    expect(extractPathParams('/v3/workspaces/{workspace_id}/sessions/{session_id}/messages')).toEqual([
      'workspace_id',
      'session_id',
    ])
    expect(extractPathParams('/health')).toEqual([])
  })

  it('generates a WorkspaceCreate skeleton with required fields only', () => {
    const endpoints = parseEndpoints(doc)
    const create = endpoints.find((endpoint) => endpoint.path === '/v3/workspaces')
    const skeleton = buildBodySkeleton(create?.requestBodySchema ?? null, doc)
    expect(JSON.parse(skeleton ?? '{}')).toEqual({ id: '' })
  })

  it('generates a MessageBatchCreate skeleton with a nested message', () => {
    const endpoints = parseEndpoints(doc)
    const batch = endpoints.find((endpoint) => endpoint.summary.includes('Messages'))
    const skeleton = buildBodySkeleton(batch?.requestBodySchema ?? null, doc)
    expect(JSON.parse(skeleton ?? '{}')).toEqual({ messages: [{ content: '', peer_id: '' }] })
  })

  it('builds a cURL command', () => {
    const curl = buildCurl({ method: 'POST', url: 'http://localhost:8000/v3/workspaces', bodyText: '{"id":"x"}' })
    expect(curl).toContain("curl -X POST 'http://localhost:8000/v3/workspaces'")
    expect(curl).toContain('-d \'{"id":"x"}\'')
  })

  it('execute() returns HTTP errors as data, never throws', async () => {
    const fetchFn = recordingFetch(jsonResponse({ detail: 'nope' }, 422))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.execute('POST', '/v3/workspaces', {}, '{"id":"x"}')
    expect(result.status).toBe(422)
    expect(result.bodyJson).toEqual({ detail: 'nope' })
  })

  it('execute() returns status 0 on network failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const result = await client.execute('GET', '/health')
    expect(result.status).toBe(0)
  })

  it('fetchSpec GETs /openapi.json through the same client', async () => {
    const fetchFn = recordingFetch(jsonResponse(doc))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    const spec = await client.fetchSpec()
    expect(spec.info?.version).toBe('3.4.1')
    expect(calls(fetchFn)[0][0]).toBe('http://honcho.local:8000/openapi.json')
  })
})

describe('performance stats', () => {
  it('endpointLabel derives method + singular resource noun', () => {
    expect(endpointLabel('GET', '/health')).toBe('GET health')
    expect(endpointLabel('POST', '/v3/workspaces/list?page=1&size=50')).toBe('POST workspace')
    expect(endpointLabel('POST', '/v3/workspaces/w/sessions/s/messages/list')).toBe('POST message')
    expect(endpointLabel('GET', '/v3/workspaces/w/sessions/s/peers')).toBe('GET peer')
    expect(endpointLabel('GET', '/v3/workspaces/w/sessions/s1')).toBe('GET session')
  })

  it('aggregates totals, average and per-endpoint last status', () => {
    const stats = aggregateStats([
      { method: 'GET', label: 'GET session', status: 200, durationMs: 100 },
      { method: 'GET', label: 'GET session', status: 500, durationMs: 300 },
      { method: 'POST', label: 'POST workspace', status: 201, durationMs: 200 },
    ])
    expect(stats.totalCalls).toBe(3)
    expect(stats.averageMs).toBe(200)
    const sessionRow = stats.endpoints.find((row) => row.label === 'GET session')
    expect(sessionRow?.calls).toBe(2)
    expect(sessionRow?.lastStatus).toBe(500)
  })

  it('the live client records its own requests', async () => {
    const fetchFn = recordingFetch(jsonResponse({ status: 'ok' }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })
    await client.health()
    const stats = client.getPerformanceStats()
    expect(stats.totalCalls).toBe(1)
    expect(stats.endpoints[0].label).toBe('GET health')
    expect(stats.endpoints[0].lastStatus).toBe(200)
  })

  it('demo seed matches the cloud screenshot shape (41 calls, 541.51 ms)', () => {
    const collector = new StatsCollector()
    seedDemoStats(collector)
    const stats = collector.snapshot()
    expect(stats.totalCalls).toBe(41)
    expect(stats.averageMs).toBeCloseTo(541.51, 2)
    expect(stats.endpoints).toEqual([
      { label: 'GET session', lastStatus: 200, calls: 4 },
      { label: 'POST message', lastStatus: 200, calls: 6 },
      { label: 'POST peer', lastStatus: 200, calls: 9 },
      { label: 'POST session', lastStatus: 200, calls: 14 },
      { label: 'POST workspace', lastStatus: 200, calls: 8 },
    ])
  })
})

describe('demo mode writes + canned execute', () => {
  it('demo create workspace/peer/session + add peers work in memory', async () => {
    const demo = new DemoHonchoApi()
    await demo.createWorkspace('demo-new')
    const workspaces = await demo.listWorkspaces()
    expect(workspaces.items.map((workspace) => workspace.id)).toContain('demo-new')
    await demo.createPeer('demo-new', 'zoe')
    await demo.createSession('demo-new', 'chat-1')
    await demo.addPeersToSession('demo-new', 'chat-1', ['zoe'])
    const sessionPeers = await demo.getSessionPeers('demo-new', 'chat-1')
    expect(sessionPeers.map((peer) => peer.id)).toEqual(['zoe'])
    const updated = await demo.updateWorkspace('demo-new', { metadata: { x: 1 } })
    expect(updated.metadata).toEqual({ x: 1 })
  })

  it('demo execute is labeled demo and never pretends to call a server', async () => {
    const demo = new DemoHonchoApi()
    const result = await demo.execute('GET', '/health')
    expect(result.isDemo).toBe(true)
    expect(result.bodyText).toContain('Demo mode')
  })

  it('demo serverVersion matches the bundled spec version', async () => {
    const demo = new DemoHonchoApi()
    const spec = await demo.fetchSpec()
    expect(spec.info?.version).toBe('3.4.1')
    expect(await demo.serverVersion()).toBe('3.4.1 (demo)')
    expect(await demo.serverVersion()).toBe(`${spec.info?.version} (demo)`)
  })

  it('demo key is clearly fake; demo stats are seeded; demo spec parses', async () => {
    const demo = new DemoHonchoApi()
    const key = (await demo.createKey({})) as string
    expect(key).toContain('FAKE')
    expect(demo.getPerformanceStats().totalCalls).toBe(41)
    const spec = await demo.fetchSpec()
    expect(parseEndpoints(spec).length).toBeGreaterThan(30)
  })

  it('demo webhooks create/list/delete in memory', async () => {
    const demo = new DemoHonchoApi()
    const before = await demo.listWebhooks('test-1')
    expect(before.items).toHaveLength(1)
    const created = await demo.createWebhook('test-1', 'https://example.com/new')
    const after = await demo.listWebhooks('test-1')
    expect(after.items).toHaveLength(2)
    await demo.deleteWebhook('test-1', created.id)
    const final = await demo.listWebhooks('test-1')
    expect(final.items).toHaveLength(1)
  })
})
