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

// The read-only surface of the Honcho v3 API that the dashboard uses.
// Implemented twice: HonchoClient (live HTTP) and DemoHonchoApi (fixtures),
// so every view can render without a live server in demo mode.
export interface HonchoApi {
  // Human-readable description of the route requests actually take, for
  // connection diagnostics: proxy vs direct, the exact URL a request goes
  // to, and the configured server. Shown in health errors and on the
  // Get Started page so a failed connection reports what was tried.
  routeDescription(): string
  health(): Promise<{ status: string }>
  // Best-effort server version from GET /openapi.json (info.version).
  serverVersion(): Promise<string | null>
  listWorkspaces(page?: number, size?: number): Promise<Page<Workspace>>
  listPeers(workspaceId: string, page?: number, size?: number): Promise<Page<Peer>>
  getPeerCard(workspaceId: string, peerId: string): Promise<string[] | null>
  getRepresentation(workspaceId: string, peerId: string): Promise<string>
  listConclusionsAboutPeer(
    workspaceId: string,
    peerId: string,
    page?: number,
    size?: number,
  ): Promise<Page<Conclusion>>
  listSessions(workspaceId: string, page?: number, size?: number): Promise<Page<Session>>
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
}
