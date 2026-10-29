import { describe, expect, it, vi } from 'vitest'
import { HonchoClient } from '../api/client'
import { DemoHonchoApi } from '../api/demoClient'
import type { HonchoApi } from '../api/honchoApi'
import { swapToNewServer, type NewServerConnection } from '../lib/connectionSwap'

// Tests for the Settings-page server swap: the NEW server is
// health-checked through a candidate HonchoClient (same bound-fetch +
// resolveRequestBase machinery as the live connection) BEFORE anything
// is applied. `apply` here stands in for the connection provider's swap
// (persist to the localStorage connection record + rebuild the client):
// on failure it must never run, so the old connection persists exactly
// as it was; on success it runs once with the trimmed new connection.

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function mockFetch(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch
}

// A candidate factory mirroring the provider's createLiveApi, with the
// proxy knobs explicit so tests can exercise both route modes.
function candidateFactory(fetchFn: typeof fetch, useProxy: boolean) {
  return (connection: NewServerConnection): HonchoApi =>
    new HonchoClient({
      baseUrl: connection.baseUrl,
      token: connection.token || undefined,
      proxyTarget: 'http://localhost:8000',
      useProxy,
      fetchFn,
    })
}

// Simulates the provider: `persisted` is the saved connection record,
// replaced only when `apply` runs.
function makeSwapHarness(fetchFn: typeof fetch, useProxy = false) {
  let persisted: NewServerConnection = { baseUrl: 'http://old.local:8000', token: 'old-token' }
  const apply = vi.fn((connection: NewServerConnection) => {
    persisted = connection
  })
  return {
    deps: { createCandidate: candidateFactory(fetchFn, useProxy), apply },
    apply,
    getPersisted: () => persisted,
  }
}

describe('swapToNewServer — health validation failure', () => {
  it('keeps the old connection and persists nothing when the new server is unreachable (proxy route)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch
    const harness = makeSwapHarness(fetchFn, true)

    const result = await swapToNewServer(
      { baseUrl: 'http://localhost:8000', token: '' },
      harness.deps,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Could not reach the Honcho server')
      expect(result.error).toContain(
        '— tried: GET /honcho-api/health (via Vite proxy — useProxy on, configured server http://localhost:8000)',
      )
    }
    expect(harness.apply).not.toHaveBeenCalled()
    expect(harness.getPersisted()).toEqual({ baseUrl: 'http://old.local:8000', token: 'old-token' })
  })

  it('keeps the old connection on an HTTP error and names the tried direct route', async () => {
    const fetchFn = mockFetch(jsonResponse({ detail: 'Invalid token' }, 401))
    const harness = makeSwapHarness(fetchFn)

    const result = await swapToNewServer(
      { baseUrl: 'http://new.local:9000', token: 'bad-token' },
      harness.deps,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid token')
      expect(result.error).toContain(
        '— tried: GET http://new.local:9000/health (direct, no proxy — useProxy off)',
      )
    }
    expect(harness.apply).not.toHaveBeenCalled()
    expect(harness.getPersisted()).toEqual({ baseUrl: 'http://old.local:8000', token: 'old-token' })
  })

  it('treats a non-ok health payload as failure and persists nothing', async () => {
    const fetchFn = mockFetch(jsonResponse({ status: 'degraded' }))
    const harness = makeSwapHarness(fetchFn)

    const result = await swapToNewServer(
      { baseUrl: 'http://new.local:9000', token: '' },
      harness.deps,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Unexpected health response')
      expect(result.error).toContain('— tried: GET http://new.local:9000/health')
    }
    expect(harness.apply).not.toHaveBeenCalled()
    expect(harness.getPersisted()).toEqual({ baseUrl: 'http://old.local:8000', token: 'old-token' })
  })
})

describe('swapToNewServer — health validation success', () => {
  it('swaps and persists the trimmed new connection (direct route, token sent)', async () => {
    const fetchFn = mockFetch(jsonResponse({ status: 'ok' }))
    const harness = makeSwapHarness(fetchFn)

    const result = await swapToNewServer(
      { baseUrl: '  http://new.local:9000  ', token: '  new-token  ' },
      harness.deps,
    )

    expect(result).toEqual({ ok: true })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://new.local:9000/health')
    expect(init.headers.Authorization).toBe('Bearer new-token')
    expect(harness.apply).toHaveBeenCalledTimes(1)
    expect(harness.apply).toHaveBeenCalledWith({
      baseUrl: 'http://new.local:9000',
      token: 'new-token',
    })
    expect(harness.getPersisted()).toEqual({
      baseUrl: 'http://new.local:9000',
      token: 'new-token',
    })
  })

  it('validates through the proxy when the new URL is loopback-equivalent to the proxy target', async () => {
    const fetchFn = mockFetch(jsonResponse({ status: 'ok' }))
    const harness = makeSwapHarness(fetchFn, true)

    const result = await swapToNewServer(
      { baseUrl: 'http://127.0.0.1:8000', token: '' },
      harness.deps,
    )

    expect(result).toEqual({ ok: true })
    const [url] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/honcho-api/health')
    expect(harness.getPersisted()).toEqual({ baseUrl: 'http://127.0.0.1:8000', token: '' })
  })

  it('allows an empty token (server running with auth off)', async () => {
    const fetchFn = mockFetch(jsonResponse({ status: 'ok' }))
    const harness = makeSwapHarness(fetchFn)

    const result = await swapToNewServer(
      { baseUrl: 'http://new.local:9000', token: '' },
      harness.deps,
    )

    expect(result).toEqual({ ok: true })
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
    expect(harness.getPersisted().token).toBe('')
  })
})

describe('clearServerData — swap invalidation', () => {
  it('clears the live client conclusions cache and stats collector', async () => {
    let conclusionCalls = 0
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/conclusions/list')) {
        conclusionCalls += 1
        return jsonResponse({ items: [{ id: 'c1' }], total: 1, page: 1, size: 100, pages: 1 })
      }
      return jsonResponse({ status: 'ok' })
    }) as unknown as typeof fetch
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    await client.fetchConclusionsCapped('ws-1')
    await client.fetchConclusionsCapped('ws-1')
    expect(conclusionCalls).toBe(1)
    expect(client.getPerformanceStats().totalCalls).toBeGreaterThan(0)

    client.clearServerData()

    expect(client.getPerformanceStats().totalCalls).toBe(0)
    await client.fetchConclusionsCapped('ws-1')
    expect(conclusionCalls).toBe(2)
  })

  it('clears the demo client stats collector', () => {
    const demo = new DemoHonchoApi()
    expect(demo.getPerformanceStats().totalCalls).toBe(41)

    demo.clearServerData()

    expect(demo.getPerformanceStats().totalCalls).toBe(0)
  })
})
