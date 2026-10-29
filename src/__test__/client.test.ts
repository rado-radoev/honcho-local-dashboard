import { describe, expect, it, vi } from 'vitest'
import {
  HonchoClient,
  HonchoError,
  formatHealthError,
  resolveRequestBase,
  shouldUseProxy,
} from '../api/client'
import { DemoHonchoApi } from '../api/demoClient'

// Tests for the Honcho API client: URL building (including the dev-proxy
// rule), the auth header, error handling, and request shapes for the
// endpoints the dashboard depends on. fetch is mocked throughout.

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

describe('resolveRequestBase', () => {
  it('uses the proxy prefix in dev when the server is the proxy target', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(base).toBe('/honcho-api')
  })

  it('ignores trailing slashes when matching the proxy target', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://localhost:8000/',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(base).toBe('/honcho-api')
  })

  it('calls a different server directly, even in dev', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://192.168.1.50:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(base).toBe('http://192.168.1.50:8000')
  })

  it('calls the server directly outside dev (production build)', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: false,
    })
    expect(base).toBe('http://localhost:8000')
  })

  it('uses the proxy when base is localhost and target is 127.0.0.1 (same port)', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://127.0.0.1:8000',
      useProxy: true,
    })
    expect(base).toBe('/honcho-api')
  })

  it('uses the proxy when base is 127.0.0.1 and target is localhost (same port)', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://127.0.0.1:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(base).toBe('/honcho-api')
  })

  it('uses the proxy when base is 0.0.0.0 and target is localhost (same port)', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://0.0.0.0:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(base).toBe('/honcho-api')
  })

  it('uses the proxy when base is [::1] and target is localhost (same port)', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://[::1]:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(base).toBe('/honcho-api')
  })

  it('calls loopback directly when ports differ', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://127.0.0.1:9000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(base).toBe('http://127.0.0.1:9000')
  })

  it('calls loopback directly when ports differ (localhost vs 127.0.0.1)', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://localhost:9000',
      proxyTarget: 'http://127.0.0.1:8000',
      useProxy: true,
    })
    expect(base).toBe('http://localhost:9000')
  })
})

describe('shouldUseProxy', () => {
  it('is true for the dev server (mode "development")', () => {
    expect(shouldUseProxy('development')).toBe(true)
  })

  // Regression test for the preview bug: a preview build is a production
  // bundle (import.meta.env.DEV === false) served by `vite preview`, which
  // DOES provide the /honcho-api proxy. Basing useProxy on DEV made
  // preview builds call the Honcho server directly and fail on CORS.
  it('is true for a preview-served build (mode "preview")', () => {
    expect(shouldUseProxy('preview')).toBe(true)
  })

  it('is false for a production build (mode "production")', () => {
    expect(shouldUseProxy('production')).toBe(false)
  })

  it('is false for any other mode', () => {
    expect(shouldUseProxy('test')).toBe(false)
  })

  it('routes a preview-served build through the proxy when the server is the target', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: shouldUseProxy('preview'),
    })
    expect(base).toBe('/honcho-api')
  })

  it('keeps a production build off the proxy even when the server is the target', () => {
    const base = resolveRequestBase({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: shouldUseProxy('production'),
    })
    expect(base).toBe('http://localhost:8000')
  })
})

describe('HonchoClient', () => {
  it('health() GETs /health and returns the parsed body', async () => {
    const fetchFn = mockFetch(jsonResponse({ status: 'ok' }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    const result = await client.health()

    expect(result).toEqual({ status: 'ok' })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://honcho.local:8000/health')
    expect(init.method).toBe('GET')
  })

  it('sends the Authorization header only when a token is configured', async () => {
    const fetchFn = mockFetch(jsonResponse({ status: 'ok' }))
    const authed = new HonchoClient({
      baseUrl: 'http://honcho.local:8000',
      token: 'jwt-123',
      fetchFn,
    })
    await authed.health()
    const authedInit = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(authedInit.headers.Authorization).toBe('Bearer jwt-123')

    const fetchFn2 = mockFetch(jsonResponse({ status: 'ok' }))
    const anonymous = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn: fetchFn2 })
    await anonymous.health()
    const anonInit = (fetchFn2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(anonInit.headers.Authorization).toBeUndefined()
  })

  it('listWorkspaces() POSTs to /v3/workspaces/list with pagination params', async () => {
    const page = { items: [], total: 0, page: 2, size: 10, pages: 0 }
    const fetchFn = mockFetch(jsonResponse(page))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    const result = await client.listWorkspaces(2, 10)

    expect(result).toEqual(page)
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/list?page=2&size=10')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({})
  })

  it('listConclusionsAboutPeer() filters by observed_id', async () => {
    const fetchFn = mockFetch(jsonResponse({ items: [], total: 0, page: 1, size: 50, pages: 0 }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    await client.listConclusionsAboutPeer('test-1', 'alice')

    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/test-1/conclusions/list?page=1&size=50')
    expect(JSON.parse(init.body)).toEqual({ filters: { observed_id: 'alice' } })
  })

  it('chatWithPeer() sends query, reasoning level and stream=false', async () => {
    const fetchFn = mockFetch(jsonResponse({ content: 'Alice likes sci-fi.' }))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    const answer = await client.chatWithPeer('test-1', 'alice', 'What does Alice like?', 'high')

    expect(answer).toBe('Alice likes sci-fi.')
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://honcho.local:8000/v3/workspaces/test-1/peers/alice/chat')
    expect(JSON.parse(init.body)).toEqual({
      query: 'What does Alice like?',
      reasoning_level: 'high',
      stream: false,
    })
  })

  it('routes requests through the dev proxy when configured', async () => {
    const fetchFn = mockFetch(jsonResponse({ status: 'ok' }))
    const client = new HonchoClient({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
      fetchFn,
    })

    await client.health()

    const [url] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/honcho-api/health')
  })

  it('turns a FastAPI error body into a HonchoError with status and detail', async () => {
    const fetchFn = mockFetch(jsonResponse({ detail: 'Invalid token' }, 401))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    await expect(client.health()).rejects.toMatchObject({
      name: 'HonchoError',
      status: 401,
      message: 'Invalid token',
    })
  })

  it('turns a network failure into a HonchoError with status 0', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    const caught = await client.health().catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(HonchoError)
    expect((caught as HonchoError).status).toBe(0)
  })
})

describe('routeDescription', () => {
  it('describes the proxy route with the configured server', () => {
    const client = new HonchoClient({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://127.0.0.1:8000',
      useProxy: true,
    })
    expect(client.routeDescription()).toBe(
      'GET /honcho-api/health (via Vite proxy — useProxy on, configured server http://localhost:8000)',
    )
  })

  it('describes a direct route when the proxy is off (production build)', () => {
    const client = new HonchoClient({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: false,
    })
    expect(client.routeDescription()).toBe(
      'GET http://localhost:8000/health (direct, no proxy — useProxy off)',
    )
  })

  it('describes a direct route in dev when the server is not the proxy target', () => {
    const client = new HonchoClient({
      baseUrl: 'http://192.168.1.50:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
    })
    expect(client.routeDescription()).toBe(
      'GET http://192.168.1.50:8000/health (direct, no proxy — useProxy on)',
    )
  })

  it('demo client reports demo fixtures instead of a server route', () => {
    expect(new DemoHonchoApi().routeDescription()).toBe('demo fixtures (no server request)')
  })
})

describe('health failure diagnostics', () => {
  it('a network-failed health check, surfaced via the connection, names the tried proxy route', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch
    const client = new HonchoClient({
      baseUrl: 'http://localhost:8000',
      proxyTarget: 'http://localhost:8000',
      useProxy: true,
      fetchFn,
    })

    const caught = await client.health().catch((error: unknown) => error)
    const message = formatHealthError(caught, client)

    expect(message).toContain('Could not reach the Honcho server')
    expect(message).toContain(
      '— tried: GET /honcho-api/health (via Vite proxy — useProxy on, configured server http://localhost:8000)',
    )
  })

  it('an HTTP-error health check, surfaced via the connection, names the tried direct route', async () => {
    const fetchFn = mockFetch(jsonResponse({ detail: 'Invalid token' }, 401))
    const client = new HonchoClient({ baseUrl: 'http://honcho.local:8000', fetchFn })

    const caught = await client.health().catch((error: unknown) => error)
    const message = formatHealthError(caught, client)

    expect(message).toContain('Invalid token')
    expect(message).toContain(
      '— tried: GET http://honcho.local:8000/health (direct, no proxy — useProxy off)',
    )
  })
})
