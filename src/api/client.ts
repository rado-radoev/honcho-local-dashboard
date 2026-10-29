import type {
  Conclusion,
  Message,
  Page,
  Peer,
  QueueStatus,
  ReasoningLevel,
  Session,
  SessionContext,
  SessionSummaries,
  Workspace,
} from '../types'
import type { HonchoApi } from './honchoApi'

// Error type for failed Honcho requests. `status` is the HTTP status code,
// or 0 when the request never reached the server (network error / CORS).
export class HonchoError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HonchoError'
    this.status = status
  }
}

export interface HonchoClientOptions {
  // The Honcho server the user wants to talk to, e.g. http://localhost:8000
  baseUrl: string
  // Optional JWT / API token. Sent as `Authorization: Bearer <token>`.
  token?: string
  // The server the Vite proxy forwards /honcho-api to. Only used to
  // decide whether requests for `baseUrl` can ride the proxy (see below).
  proxyTarget?: string
  // True when this bundle is served by a Vite server that provides the
  // /honcho-api proxy — the dev server or a preview build. Decide it with
  // shouldUseProxy(import.meta.env.MODE), not import.meta.env.DEV: DEV is
  // false for the production bundle that `vite preview` serves, which used
  // to make preview builds bypass the proxy and die on CORS.
  useProxy?: boolean
  fetchFn?: typeof fetch
}

export const PROXY_PREFIX = '/honcho-api'
export const DEFAULT_PROXY_TARGET = 'http://localhost:8000'

// Which Vite mode this bundle was built/served for decides whether the
// /honcho-api proxy may be used:
// - "development" (`npm run dev`): the dev server proxies /honcho-api.
// - "preview" (`npm run build:preview`, served by `npm run preview`): the
//   preview server also proxies /honcho-api (preview.proxy in
//   vite.config.ts), so the flag is baked into that build on purpose.
// - "production" (`npm run build`): NO proxy — a real deployment is served
//   as static files with no /honcho-api endpoint, so requests must go
//   directly to the configured server (same-origin or reverse-proxied
//   deployments have no CORS problem to sidestep).
export function shouldUseProxy(mode: string): boolean {
  return mode === 'development' || mode === 'preview'
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function effectivePort(url: URL): string {
  if (url.port) return url.port
  if (url.protocol === 'http:') return '80'
  if (url.protocol === 'https:') return '443'
  return ''
}

function isLoopbackEquivalent(baseUrl: string, proxyTarget: string): boolean {
  const base = parseUrl(baseUrl)
  const target = parseUrl(proxyTarget)
  if (!base || !target) return false
  if (!isLoopbackHost(base.hostname)) return false
  if (!isLoopbackHost(target.hostname)) return false
  return effectivePort(base) === effectivePort(target)
}

// Decides where requests actually go.
// - When the bundle may use the proxy (dev / preview builds — see
//   shouldUseProxy) and the configured server IS the proxy target, requests
//   go to the same-origin proxy prefix instead, sidestepping CORS entirely.
// - Everywhere else the configured base URL is used directly (production
//   deployments are expected to serve the dashboard same-origin with the
//   API or behind a reverse proxy — see README).
export function resolveRequestBase(options: HonchoClientOptions): string {
  const base = stripTrailingSlash(options.baseUrl)
  const target = stripTrailingSlash(options.proxyTarget ?? DEFAULT_PROXY_TARGET)
  if (!options.useProxy) {
    return base
  }
  if (base === target) {
    return PROXY_PREFIX
  }
  if (isLoopbackEquivalent(base, target)) {
    return PROXY_PREFIX
  }
  return base
}

// Extract a human-readable message from a FastAPI error body, whose
// `detail` is either a string or a list of validation error objects.
function describeErrorBody(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      const messages = detail
        .map((entry) =>
          typeof entry === 'object' && entry !== null && 'msg' in entry
            ? String((entry as { msg: unknown }).msg)
            : '',
        )
        .filter((text) => text.length > 0)
      if (messages.length > 0) return messages.join('; ')
    }
  }
  return fallback
}

export class HonchoClient implements HonchoApi {
  private readonly requestBase: string
  private readonly token?: string
  private readonly fetchFn: typeof fetch

  constructor(options: HonchoClientOptions) {
    this.requestBase = resolveRequestBase(options)
    this.token = options.token
    this.fetchFn = options.fetchFn ?? fetch
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    let response: Response
    try {
      response = await this.fetchFn(`${this.requestBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      // fetch itself rejected: server unreachable, DNS, or a CORS block.
      throw new HonchoError(
        0,
        'Could not reach the Honcho server. Check the URL, that the server is running, and (in a browser) CORS — see the README proxy notes.',
      )
    }

    if (!response.ok) {
      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        parsed = null
      }
      throw new HonchoError(
        response.status,
        describeErrorBody(parsed, `Honcho request failed with HTTP ${response.status}`),
      )
    }

    return (await response.json()) as T
  }

  private pageQuery(page: number, size: number): string {
    return `?page=${page}&size=${size}`
  }

  async health(): Promise<{ status: string }> {
    return this.request<{ status: string }>('GET', '/health')
  }

  async serverVersion(): Promise<string | null> {
    try {
      const spec = await this.request<{ info?: { version?: string } }>('GET', '/openapi.json')
      return spec.info?.version ?? null
    } catch {
      return null
    }
  }

  async listWorkspaces(page = 1, size = 50): Promise<Page<Workspace>> {
    return this.request<Page<Workspace>>('POST', `/v3/workspaces/list${this.pageQuery(page, size)}`, {})
  }

  async listPeers(workspaceId: string, page = 1, size = 50): Promise<Page<Peer>> {
    return this.request<Page<Peer>>(
      'POST',
      `/v3/workspaces/${workspaceId}/peers/list${this.pageQuery(page, size)}`,
      {},
    )
  }

  async getPeerCard(workspaceId: string, peerId: string): Promise<string[] | null> {
    const result = await this.request<{ peer_card: string[] | null }>(
      'GET',
      `/v3/workspaces/${workspaceId}/peers/${peerId}/card`,
    )
    return result.peer_card
  }

  async getRepresentation(workspaceId: string, peerId: string): Promise<string> {
    const result = await this.request<{ representation: string }>(
      'POST',
      `/v3/workspaces/${workspaceId}/peers/${peerId}/representation`,
      {},
    )
    return result.representation
  }

  async listConclusionsAboutPeer(
    workspaceId: string,
    peerId: string,
    page = 1,
    size = 50,
  ): Promise<Page<Conclusion>> {
    return this.request<Page<Conclusion>>(
      'POST',
      `/v3/workspaces/${workspaceId}/conclusions/list${this.pageQuery(page, size)}`,
      { filters: { observed_id: peerId } },
    )
  }

  async listSessions(workspaceId: string, page = 1, size = 50): Promise<Page<Session>> {
    return this.request<Page<Session>>(
      'POST',
      `/v3/workspaces/${workspaceId}/sessions/list${this.pageQuery(page, size)}`,
      {},
    )
  }

  async listSessionsForPeer(workspaceId: string, peerId: string): Promise<Page<Session>> {
    return this.request<Page<Session>>(
      'POST',
      `/v3/workspaces/${workspaceId}/peers/${peerId}/sessions`,
      {},
    )
  }

  async listMessages(
    workspaceId: string,
    sessionId: string,
    page = 1,
    size = 50,
  ): Promise<Page<Message>> {
    return this.request<Page<Message>>(
      'POST',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/messages/list${this.pageQuery(page, size)}`,
      {},
    )
  }

  async getSessionPeers(workspaceId: string, sessionId: string): Promise<Peer[]> {
    const page = await this.request<Page<Peer>>(
      'GET',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/peers`,
    )
    return page.items
  }

  async getSessionSummaries(workspaceId: string, sessionId: string): Promise<SessionSummaries> {
    return this.request<SessionSummaries>(
      'GET',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/summaries`,
    )
  }

  async getSessionContext(
    workspaceId: string,
    sessionId: string,
    tokens: number,
  ): Promise<SessionContext> {
    return this.request<SessionContext>(
      'GET',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/context?summary=true&tokens=${tokens}`,
    )
  }

  async searchWorkspace(workspaceId: string, query: string, limit = 20): Promise<Message[]> {
    return this.request<Message[]>('POST', `/v3/workspaces/${workspaceId}/search`, { query, limit })
  }

  async searchPeer(
    workspaceId: string,
    peerId: string,
    query: string,
    limit = 20,
  ): Promise<Message[]> {
    return this.request<Message[]>(
      'POST',
      `/v3/workspaces/${workspaceId}/peers/${peerId}/search`,
      { query, limit },
    )
  }

  async searchSession(
    workspaceId: string,
    sessionId: string,
    query: string,
    limit = 20,
  ): Promise<Message[]> {
    return this.request<Message[]>(
      'POST',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/search`,
      { query, limit },
    )
  }

  async chatWithPeer(
    workspaceId: string,
    peerId: string,
    query: string,
    reasoningLevel: ReasoningLevel,
    sessionId?: string,
  ): Promise<string | null> {
    const body: Record<string, unknown> = {
      query,
      reasoning_level: reasoningLevel,
      stream: false,
    }
    if (sessionId) body.session_id = sessionId
    const result = await this.request<{ content: string | null }>(
      'POST',
      `/v3/workspaces/${workspaceId}/peers/${peerId}/chat`,
      body,
    )
    return result.content
  }

  async getQueueStatus(workspaceId: string): Promise<QueueStatus> {
    return this.request<QueueStatus>('GET', `/v3/workspaces/${workspaceId}/queue/status`)
  }
}
