import type {
  CappedConclusions,
  Conclusion,
  ConclusionFilters,
  CreateKeyOptions,
  ExecuteResult,
  Message,
  Page,
  Peer,
  QueueStatus,
  ReasoningLevel,
  Scope,
  ScopeStatus,
  Session,
  SessionContext,
  SessionSummaries,
  WebhookEndpoint,
  Workspace,
  WorkspaceChatResult,
  WorkspaceCounts,
} from '../types'
import type { OpenApiDoc } from './openapi'
import type { PerformanceStats } from '../lib/stats'

// The surface of the Honcho v3 API that the dashboard uses.
// Implemented twice: HonchoClient (live HTTP) and DemoHonchoApi (fixtures),
// so every view can render without a live server in demo mode.
export interface HonchoApi {
  routeDescription(): string
  health(): Promise<{ status: string }>
  // Drop every piece of server-derived state this client holds (the
  // conclusions cache and the performance stats collector). Called when
  // the connection swaps to a different server, so the old server's data
  // can never surface under the new connection.
  clearServerData(): void
  serverVersion(): Promise<string | null>
  listWorkspaces(page?: number, size?: number): Promise<Page<Workspace>>
  createWorkspace(id: string): Promise<Workspace>
  updateWorkspace(
    workspaceId: string,
    update: { metadata?: Record<string, unknown>; configuration?: Record<string, unknown> },
  ): Promise<Workspace>
  getWorkspace(workspaceId: string): Promise<Workspace | null>
  listPeers(workspaceId: string, page?: number, size?: number): Promise<Page<Peer>>
  createPeer(workspaceId: string, id: string): Promise<Peer>
  getPeerCard(workspaceId: string, peerId: string): Promise<string[] | null>
  getRepresentation(workspaceId: string, peerId: string): Promise<string>
  listConclusionsAboutPeer(
    workspaceId: string,
    peerId: string,
    page?: number,
    size?: number,
  ): Promise<Page<Conclusion>>
  // Round 3: generic conclusions access (list with filters, capped fetch
  // with a 60s in-memory cache, single get, semantic query, delete).
  listConclusions(
    workspaceId: string,
    filters?: ConclusionFilters,
    page?: number,
    size?: number,
  ): Promise<Page<Conclusion>>
  fetchConclusionsCapped(
    workspaceId: string,
    filters?: ConclusionFilters,
  ): Promise<CappedConclusions>
  getConclusion(workspaceId: string, conclusionId: string): Promise<Conclusion>
  queryConclusions(
    workspaceId: string,
    query: string,
    topK?: number,
    filters?: ConclusionFilters,
  ): Promise<Conclusion[]>
  deleteConclusion(workspaceId: string, conclusionId: string): Promise<void>
  getWorkspaceCounts(workspaceId: string): Promise<WorkspaceCounts>
  chatWorkspace(
    workspaceId: string,
    query: string,
    reasoningLevel?: ReasoningLevel,
  ): Promise<WorkspaceChatResult>
  // Scopes (read-only browser).
  listScopes(workspaceId: string, page?: number, size?: number): Promise<Page<Scope>>
  getScopeStatus(workspaceId: string, scopeId: string): Promise<ScopeStatus>
  listScopeSessions(workspaceId: string, scopeId: string, page?: number, size?: number): Promise<Page<Session>>
  listSessions(workspaceId: string, page?: number, size?: number): Promise<Page<Session>>
  createSession(workspaceId: string, id: string): Promise<Session>
  addPeersToSession(
    workspaceId: string,
    sessionId: string,
    peerIds: string[],
  ): Promise<Session>
  listSessionsForPeer(workspaceId: string, peerId: string): Promise<Page<Session>>
  listMessages(
    workspaceId: string,
    sessionId: string,
    page?: number,
    size?: number,
  ): Promise<Page<Message>>
  getSessionPeers(workspaceId: string, sessionId: string): Promise<Peer[]>
  getSessionSummaries(workspaceId: string, sessionId: string): Promise<SessionSummaries>
  getSessionContext(
    workspaceId: string,
    sessionId: string,
    tokens: number,
  ): Promise<SessionContext>
  searchWorkspace(workspaceId: string, query: string, limit?: number): Promise<Message[]>
  searchPeer(workspaceId: string, peerId: string, query: string, limit?: number): Promise<Message[]>
  searchSession(
    workspaceId: string,
    sessionId: string,
    query: string,
    limit?: number,
  ): Promise<Message[]>
  chatWithPeer(
    workspaceId: string,
    peerId: string,
    query: string,
    reasoningLevel: ReasoningLevel,
    sessionId?: string,
  ): Promise<string | null>
  getQueueStatus(workspaceId: string): Promise<QueueStatus>
  // API Playground: live spec + generic execution (errors are data).
  fetchSpec(): Promise<OpenApiDoc>
  execute(
    method: string,
    path: string,
    queryParams?: Record<string, string>,
    jsonBodyText?: string,
  ): Promise<ExecuteResult>
  // Performance: stats from this dashboard's own requests since connect.
  getPerformanceStats(): PerformanceStats
  // API Keys: create only — the v3 API has no list/revoke endpoint.
  createKey(options: CreateKeyOptions): Promise<unknown>
  // Webhooks.
  listWebhooks(workspaceId: string): Promise<Page<WebhookEndpoint>>
  createWebhook(workspaceId: string, url: string): Promise<WebhookEndpoint>
  deleteWebhook(workspaceId: string, endpointId: string): Promise<void>
}
