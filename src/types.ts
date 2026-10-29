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

export interface QueueStatus {
  total_work_units: number
  completed_work_units: number
  in_progress_work_units: number
  pending_work_units: number
}

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'max'

export const REASONING_LEVELS: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'max']
