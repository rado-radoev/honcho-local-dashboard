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
import type { OpenApiDoc } from './openapi'
import type { PerformanceStats } from '../lib/stats'

// The surface of the Honcho v3 API that the dashboard uses.
// Implemented twice: HonchoClient (live HTTP) and DemoHonchoApi (fixtures),
// so every view can render without a live server in demo mode.
export interface HonchoApi {
  routeDescription(): string
  health(): Promise<{ status: string }>
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
