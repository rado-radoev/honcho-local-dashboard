import type {
  Conclusion,
  CreateKeyOptions,
  ExecuteResult,
  Message,
  Page,
  Peer,
  QueueStatus,
  ReasoningLevel,
  Session,
  SessionContext,
  SessionSummaries,
  WebhookEndpoint,
  Workspace,
} from '../types'
import type { HonchoApi } from './honchoApi'
import type { OpenApiDoc } from './openapi'
import { StatsCollector, type PerformanceStats } from '../lib/stats'
import { ensureRecord, normalizePage } from '../lib/page'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

function normalizeWorkspace(raw: Workspace): Workspace {
  return { ...raw, metadata: ensureRecord(raw.metadata), configuration: ensureRecord(raw.configuration) }
}
function normalizePeer(raw: Peer): Peer {
  return { ...raw, metadata: ensureRecord(raw.metadata), configuration: ensureRecord(raw.configuration) }
}
function normalizeSession(raw: Session): Session {
  return { ...raw, metadata: ensureRecord(raw.metadata), configuration: ensureRecord(raw.configuration) }
}

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

// Health-failure message with the tried route appended, so the Connect
// screen and the in-app banner say exactly what was attempted (proxy vs
// direct, which URL) instead of a bare "could not reach the server".
export function formatHealthError(error: unknown, api: HonchoApi): string {
  const message = error instanceof Error ? error.message : 'Health check failed'
  return `${message} — tried: ${api.routeDescription()}`
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
  private readonly configuredServer: string
  private readonly useProxy: boolean
  private readonly token?: string
  private readonly fetchFn: typeof fetch
  private readonly stats = new StatsCollector()

  constructor(options: HonchoClientOptions) {
    this.requestBase = resolveRequestBase(options)
    this.configuredServer = stripTrailingSlash(options.baseUrl)
    this.useProxy = options.useProxy ?? false
    this.token = options.token
    // Native browser fetch requires the global receiver, not this client.
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  // Diagnostics: describes the route a request actually takes, so a failed
  // health check can say exactly what was tried instead of a bare
  // "could not reach the server". `path` defaults to the health endpoint,
  // which is the request connection checks make.
  routeDescription(method: 'GET' | 'POST' = 'GET', path = '/health'): string {
    const url = `${this.requestBase}${path}`
    if (this.requestBase === PROXY_PREFIX) {
      return `${method} ${url} (via Vite proxy — useProxy on, configured server ${this.configuredServer})`
    }
    const proxyState = this.useProxy ? 'on' : 'off'
    return `${method} ${url} (direct, no proxy — useProxy ${proxyState})`
  }

  private buildHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {}
    if (hasBody) headers['Content-Type'] = 'application/json'
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    return headers
  }

  // One raw fetch through the bound fetchFn, recording the call in the
  // performance stats collector (status 0 when the request never landed).
  private async rawFetch(
    method: HttpMethod,
    path: string,
    bodyText?: string,
  ): Promise<{ response: Response; durationMs: number }> {
    const started = performance.now()
    try {
      const response = await this.fetchFn(`${this.requestBase}${path}`, {
        method,
        headers: this.buildHeaders(bodyText !== undefined),
        body: bodyText,
      })
      const durationMs = performance.now() - started
      this.stats.record(method, path, response.status, durationMs)
      return { response, durationMs }
    } catch (error) {
      const durationMs = performance.now() - started
      this.stats.record(method, path, 0, durationMs)
      throw error
    }
  }

  private async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      const result = await this.rawFetch(
        method,
        path,
        body === undefined ? undefined : JSON.stringify(body),
      )
      response = result.response
    } catch {
      // fetch itself rejected: server unreachable, DNS, or a CORS block.
      throw new HonchoError(
        0,
        'Could not reach the Honcho server. Check the URL, that the server is running, and (in a browser) CORS — see the README proxy notes.',
      )
    }

    if (!response.ok) {
      const fallback = `Honcho request failed with HTTP ${response.status}`
      let message = fallback
      let bodyText = ''
      let hasText = false
      if (typeof response.text === 'function') {
        try {
          bodyText = await response.text()
          hasText = true
        } catch {
          hasText = false
        }
      }
      if (hasText) {
        const trimmed = bodyText.trim()
        if (trimmed.length > 0) {
          let parsed: unknown = null
          let isJson = false
          try {
            parsed = JSON.parse(bodyText)
            isJson = true
          } catch {
            isJson = false
          }
          if (isJson) {
            message = describeErrorBody(parsed, fallback)
          } else {
            message = `${fallback}: ${trimmed.slice(0, 200)}`
          }
        }
      } else {
        let parsed: unknown = null
        try {
          parsed = await response.json()
        } catch {
          parsed = null
        }
        message = describeErrorBody(parsed, fallback)
      }
      throw new HonchoError(response.status, message)
    }

    if (response.status === 204) return undefined as T
    if (typeof response.text === 'function') {
      const text = await response.text()
      if (text.trim().length === 0) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        // Plain-text response (e.g. a raw key string) — return as-is.
        return text as T
      }
    }
    return (await response.json()) as T
  }

  // Generic Playground execution: HTTP error statuses are returned as
  // data, never thrown. Network failures also return (status 0).
  async execute(
    method: string,
    path: string,
    queryParams: Record<string, string> = {},
    jsonBodyText?: string,
  ): Promise<ExecuteResult> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(queryParams)) {
      if (value.trim().length > 0) query.set(key, value)
    }
    const queryText = query.toString()
    const fullPath = queryText.length > 0 ? `${path}?${queryText}` : path
    const upper = method.toUpperCase() as HttpMethod
    try {
      const { response, durationMs } = await this.rawFetch(
        upper,
        fullPath,
        jsonBodyText && jsonBodyText.trim().length > 0 ? jsonBodyText : undefined,
      )
      let bodyText = ''
      if (typeof response.text === 'function') {
        bodyText = await response.text()
      } else if (typeof response.json === 'function') {
        const parsed = await response.json().catch(() => null)
        bodyText = parsed === null ? '' : JSON.stringify(parsed)
      }
      let bodyJson: unknown
      try {
        bodyJson = JSON.parse(bodyText)
      } catch {
        bodyJson = undefined
      }
      return { status: response.status, durationMs, bodyText, bodyJson }
    } catch {
      return { status: 0, durationMs: 0, bodyText: 'Network error: could not reach the server.' }
    }
  }

  async fetchSpec(): Promise<OpenApiDoc> {
    return this.request<OpenApiDoc>('GET', '/openapi.json')
  }

  getPerformanceStats(): PerformanceStats {
    return this.stats.snapshot()
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
    const raw = await this.request<unknown>('POST', `/v3/workspaces/list${this.pageQuery(page, size)}`, {})
    const normalized = normalizePage<Workspace>(raw, page, size)
    return { ...normalized, items: normalized.items.map(normalizeWorkspace) }
  }

  async createWorkspace(id: string): Promise<Workspace> {
    const raw = await this.request<Workspace>('POST', '/v3/workspaces', { id })
    return normalizeWorkspace(raw)
  }

  async updateWorkspace(
    workspaceId: string,
    update: { metadata?: Record<string, unknown>; configuration?: Record<string, unknown> },
  ): Promise<Workspace> {
    const raw = await this.request<Workspace>('PUT', `/v3/workspaces/${workspaceId}`, update)
    return normalizeWorkspace(raw)
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const page = await this.listWorkspaces(1, 50)
    return page.items.find((workspace) => workspace.id === workspaceId) ?? null
  }

  async listPeers(workspaceId: string, page = 1, size = 50): Promise<Page<Peer>> {
    const raw = await this.request<unknown>(
      'POST',
      `/v3/workspaces/${workspaceId}/peers/list${this.pageQuery(page, size)}`,
      {},
    )
    const normalized = normalizePage<Peer>(raw, page, size)
    return { ...normalized, items: normalized.items.map(normalizePeer) }
  }

  async createPeer(workspaceId: string, id: string): Promise<Peer> {
    const raw = await this.request<Peer>('POST', `/v3/workspaces/${workspaceId}/peers`, { id })
    return normalizePeer(raw)
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
    const raw = await this.request<unknown>(
      'POST',
      `/v3/workspaces/${workspaceId}/conclusions/list${this.pageQuery(page, size)}`,
      { filters: { observed_id: peerId } },
    )
    return normalizePage<Conclusion>(raw, page, size)
  }

  async listSessions(workspaceId: string, page = 1, size = 50): Promise<Page<Session>> {
    const raw = await this.request<unknown>(
      'POST',
      `/v3/workspaces/${workspaceId}/sessions/list${this.pageQuery(page, size)}`,
      {},
    )
    const normalized = normalizePage<Session>(raw, page, size)
    return { ...normalized, items: normalized.items.map(normalizeSession) }
  }

  async createSession(workspaceId: string, id: string): Promise<Session> {
    const raw = await this.request<Session>('POST', `/v3/workspaces/${workspaceId}/sessions`, { id })
    return normalizeSession(raw)
  }

  async addPeersToSession(
    workspaceId: string,
    sessionId: string,
    peerIds: string[],
  ): Promise<Session> {
    const body: Record<string, Record<string, unknown>> = {}
    for (const peerId of peerIds) body[peerId] = {}
    const raw = await this.request<Session>(
      'POST',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/peers`,
      body,
    )
    return normalizeSession(raw)
  }

  async listSessionsForPeer(workspaceId: string, peerId: string): Promise<Page<Session>> {
    const raw = await this.request<unknown>(
      'POST',
      `/v3/workspaces/${workspaceId}/peers/${peerId}/sessions${this.pageQuery(1, 50)}`,
      {},
    )
    const normalized = normalizePage<Session>(raw, 1, 50)
    return { ...normalized, items: normalized.items.map(normalizeSession) }
  }

  async listMessages(
    workspaceId: string,
    sessionId: string,
    page = 1,
    size = 50,
  ): Promise<Page<Message>> {
    const raw = await this.request<unknown>(
      'POST',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/messages/list${this.pageQuery(page, size)}`,
      {},
    )
    return normalizePage<Message>(raw, page, size)
  }

  async getSessionPeers(workspaceId: string, sessionId: string): Promise<Peer[]> {
    const raw = await this.request<unknown>(
      'GET',
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/peers`,
    )
    return normalizePage<Peer>(raw, 1, 50).items.map(normalizePeer)
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

  async createKey(options: CreateKeyOptions): Promise<unknown> {
    const query = new URLSearchParams()
    if (options.workspaceId) query.set('workspace_id', options.workspaceId)
    if (options.peerId) query.set('peer_id', options.peerId)
    if (options.sessionId) query.set('session_id', options.sessionId)
    if (options.expiresAt) query.set('expires_at', options.expiresAt)
    if (options.scopeId) query.set('scope_id', options.scopeId)
    const suffix = query.toString().length > 0 ? `?${query.toString()}` : ''
    return this.request<unknown>('POST', `/v3/keys${suffix}`)
  }

  async listWebhooks(workspaceId: string): Promise<Page<WebhookEndpoint>> {
    const raw = await this.request<unknown>(
      'GET',
      `/v3/workspaces/${workspaceId}/webhooks${this.pageQuery(1, 50)}`,
    )
    return normalizePage<WebhookEndpoint>(raw, 1, 50)
  }

  async createWebhook(workspaceId: string, url: string): Promise<WebhookEndpoint> {
    return this.request<WebhookEndpoint>('POST', `/v3/workspaces/${workspaceId}/webhooks`, { url })
  }

  async deleteWebhook(workspaceId: string, endpointId: string): Promise<void> {
    await this.request<unknown>(
      'DELETE',
      `/v3/workspaces/${workspaceId}/webhooks/${endpointId}`,
    )
  }
}
