// Types for the Honcho v3 API, transcribed from the official OpenAPI spec
// (docs/v3/openapi.json in plastic-labs/honcho). Only the fields the
// dashboard reads are modeled; the API returns more (metadata blobs etc.).

export interface Workspace {
  id: string
  uid: string
  metadata: Record<string, unknown>
  configuration: Record<string, unknown>
  created_at: string
}

export interface Peer {
  id: string
  uid: string
  workspace_id: string
  created_at: string
  metadata: Record<string, unknown>
  configuration: Record<string, unknown>
}

export interface Session {
  id: string
  uid: string
  is_active: boolean
  workspace_id: string
  metadata: Record<string, unknown>
  configuration: Record<string, unknown>
  created_at: string
}

export interface Message {
  id: string
  content: string
  peer_id: string
  session_id: string
  workspace_id: string
  metadata: Record<string, unknown>
  created_at: string
  token_count: number
}

export type ConclusionLevel = 'explicit' | 'deductive' | 'inductive' | 'contradiction'

export interface Conclusion {
  id: string
  content: string
  observer_id: string
  observed_id: string
  session_id: string | null
  level: ConclusionLevel
  source_ids: string[]
  source_message_ids: string[] | null
  times_derived: number
  created_at: string
}

// Offset-pagination envelope returned by every POST .../list endpoint.
export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

export interface Summary {
  content: string
  message_id: string
  summary_type: string
  created_at: string
  token_count: number
}

export interface SessionSummaries {
  id: string
  short_summary: Summary | null
  long_summary: Summary | null
}

export interface SessionContext {
  id: string
  messages: Message[]
  summary: Summary | null
  peer_representation: string | null
  peer_card: string[] | null
}

export interface SessionQueueStatus {
  session_id: string | null
  total_work_units: number
  completed_work_units: number
  in_progress_work_units: number
  pending_work_units: number
}

export interface QueueStatus {
  total_work_units: number
  completed_work_units: number
  in_progress_work_units: number
  pending_work_units: number
  // Per-session breakdown, present when the status is not filtered to one
  // session (spec: QueueStatus.sessions, keyed by session id).
  sessions?: Record<string, SessionQueueStatus> | null
}

// Filters accepted by POST /v3/workspaces/{id}/conclusions/list.
export interface ConclusionFilters {
  level?: ConclusionLevel
  observer_id?: string
  observed_id?: string
  session_id?: string
}

// Result of the capped conclusions fetch: `items` holds at most the cap,
// `total` is the server's honest total, `capped` drives the
// "latest N of M" label in the UI.
export interface CappedConclusions {
  items: Conclusion[]
  total: number
  capped: boolean
}

// Cheap honest counts for one workspace, from size=1 Page.total calls.
export interface WorkspaceCounts {
  peers: number
  sessions: number
  conclusions: number
  byLevel: Record<ConclusionLevel, number>
}

// Evidence returned by workspace chat when include_evidence is true
// (spec: Evidence / EvidenceObservation / EvidenceMessageRef).
export interface ChatEvidenceConclusion {
  id: string
  level: ConclusionLevel
  content: string
  created_at?: string
}

export interface ChatEvidenceMessageRef {
  id: string
  session_id: string
  peer_id: string
  created_at?: string
}

export interface ChatEvidence {
  conclusions: ChatEvidenceConclusion[]
  messages: ChatEvidenceMessageRef[]
  tool_calls: Array<Record<string, unknown>>
}

export interface WorkspaceChatResult {
  content: string | null
  evidence: ChatEvidence | null
}

// Scope (spec: Scope) — the external view of the peer backing a scope;
// `id` is the unprefixed scope name.
export interface Scope {
  id: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface ScopeBackfillEntry {
  state: string
  updated_at?: string
  docs_copied?: number
}

// Scope status (spec: ScopeStatus): per-session backfill job states.
export interface ScopeStatus {
  backfill_status: Record<string, ScopeBackfillEntry>
}

export interface WebhookEndpoint {
  id: string
  workspace_id: string | null
  url: string
  created_at: string
}

// Result of a generic Playground execution. HTTP error statuses are data
// here, not exceptions — the Playground shows them in its response panel.
export interface ExecuteResult {
  status: number
  durationMs: number
  bodyText: string
  bodyJson?: unknown
  isDemo?: boolean
}

export interface CreateKeyOptions {
  workspaceId?: string
  peerId?: string
  sessionId?: string
  expiresAt?: string
  scopeId?: string
}

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'max'

export const REASONING_LEVELS: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'max']
