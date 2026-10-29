import type {
  CappedConclusions,
  Conclusion,
  ConclusionFilters,
  ConclusionLevel,
  Message,
  Page,
  Peer,
  QueueStatus,
  Scope,
  ScopeStatus,
  Session,
  SessionSummaries,
  Workspace,
  WorkspaceChatResult,
  WorkspaceCounts,
} from '../types'
import type { HonchoApi } from './honchoApi'
import type { CreateKeyOptions, ExecuteResult, WebhookEndpoint } from '../types'
import type { OpenApiDoc } from './openapi'
import { StatsCollector, seedDemoStats, type PerformanceStats } from '../lib/stats'
import {
  buildHermesConclusions,
  buildHermesMessages,
  buildTest1ExtraConclusions,
  HERMES_SESSION_PEERS,
  HERMES_SESSIONS,
} from './demoFixtures'
import {
  CONCLUSION_LEVELS,
  CONCLUSIONS_CACHE_MS,
  fetchConclusionsCapped as fetchCapped,
  filterConclusions,
} from '../lib/conclusions'
import demoSpecJson from './demoOpenApi.json'

const demoSpec = demoSpecJson as unknown as OpenApiDoc

// Fixture implementation of the Honcho API used by demo mode. The sample
// workspace mirrors the one in Honcho's official dashboard screenshots
// (test-1 with peers alice/bob/charlie and sessions groupchat_1/2), plus a
// "hermes" workspace resembling a personal Hermes Agent setup. All data is
// invented sample data — nothing here comes from a real server.

let workspaces: Workspace[] = [
  {
    id: 'test-1',
    uid: 'ws_demo_test1',
    metadata: {},
    configuration: {},
    created_at: '2025-08-25T13:23:07Z',
  },
  {
    id: 'hermes',
    uid: 'ws_demo_hermes',
    metadata: {},
    configuration: {},
    created_at: '2026-10-19T09:12:44Z',
  },
]

function makePeer(workspaceId: string, id: string, createdAt: string): Peer {
  return {
    id,
    uid: `peer_demo_${workspaceId}_${id}`,
    workspace_id: workspaceId,
    created_at: createdAt,
    metadata: {},
    configuration: {},
  }
}

const peersByWorkspace: Record<string, Peer[]> = {
  'test-1': [
    makePeer('test-1', 'alice', '2025-08-25T13:25:00Z'),
    makePeer('test-1', 'bob', '2025-08-25T13:25:05Z'),
    makePeer('test-1', 'charlie', '2025-08-25T13:25:11Z'),
  ],
  hermes: [
    makePeer('hermes', 'radoslav', '2026-10-19T09:13:02Z'),
    makePeer('hermes', 'hermes', '2026-10-19T09:13:03Z'),
    makePeer('hermes', 'claude', '2026-10-19T09:13:04Z'),
  ],
}

function makeSession(workspaceId: string, id: string, createdAt: string, isActive: boolean): Session {
  return {
    id,
    uid: `session_demo_${workspaceId}_${id}`,
    is_active: isActive,
    workspace_id: workspaceId,
    metadata: {},
    configuration: {},
    created_at: createdAt,
  }
}

const sessionsByWorkspace: Record<string, Session[]> = {
  'test-1': [
    makeSession('test-1', 'groupchat_1', '2025-08-25T13:25:19Z', true),
    makeSession('test-1', 'groupchat_2', '2025-08-25T13:25:28Z', false),
  ],
  hermes: HERMES_SESSIONS,
}

const sessionPeers: Record<string, string[]> = {
  groupchat_1: ['alice', 'bob', 'charlie'],
  groupchat_2: ['alice', 'charlie'],
  ...HERMES_SESSION_PEERS,
}

const webhooksByWorkspace: Record<string, WebhookEndpoint[]> = {
  'test-1': [
    {
      id: 'wh_demo_1',
      workspace_id: 'test-1',
      url: 'https://example.com/honcho-hook',
      created_at: '2025-08-25T13:30:00Z',
    },
  ],
  hermes: [],
}
let webhookCounter = 1
let demoKeyCounter = 0

let messageCounter = 0
function makeMessage(
  workspaceId: string,
  sessionId: string,
  peerId: string,
  content: string,
  createdAt: string,
): Message {
  messageCounter += 1
  return {
    id: `msg_demo_${messageCounter}`,
    content,
    peer_id: peerId,
    session_id: sessionId,
    workspace_id: workspaceId,
    metadata: {},
    created_at: createdAt,
    token_count: Math.max(1, Math.round(content.split(' ').length * 1.3)),
  }
}

const messagesBySession: Record<string, Message[]> = {
  groupchat_1: [
    makeMessage('test-1', 'groupchat_1', 'alice', 'hey Bob how are you today?', '2025-08-25T13:38:48Z'),
    makeMessage('test-1', 'groupchat_1', 'bob', 'Doing well thanks, did you finish that book?', '2025-08-25T13:39:19Z'),
    makeMessage('test-1', 'groupchat_1', 'alice', 'Yes! It was great, I love sci-fi novels.', '2025-08-25T13:39:45Z'),
    makeMessage('test-1', 'groupchat_1', 'charlie', 'Sci-fi is my least favorite genre.', '2025-08-25T13:41:15Z'),
    makeMessage('test-1', 'groupchat_1', 'alice', 'You always say that — what would you actually recommend instead?', '2025-08-25T13:42:02Z'),
    makeMessage('test-1', 'groupchat_1', 'charlie', 'Historical fiction. Give me a good sea voyage story any day.', '2025-08-25T13:42:40Z'),
    makeMessage('test-1', 'groupchat_1', 'bob', 'I am halfway through a mystery novel and cannot put it down.', '2025-08-25T13:44:10Z'),
    makeMessage('test-1', 'groupchat_1', 'alice', 'We should start a little book club, the three of us.', '2025-08-25T13:45:31Z'),
    makeMessage('test-1', 'groupchat_1', 'charlie', 'Only if I get to pick the second book.', '2025-08-25T13:46:05Z'),
    makeMessage('test-1', 'groupchat_1', 'bob', 'Deal. First pick goes to Alice though.', '2025-08-25T13:46:44Z'),
    makeMessage('test-1', 'groupchat_1', 'alice', 'Then we are reading Dune. No complaints.', '2025-08-25T13:47:20Z'),
    makeMessage('test-1', 'groupchat_1', 'charlie', 'Fine — but I am bringing snacks and strong opinions.', '2025-08-25T13:48:01Z'),
  ],
  groupchat_2: [
    makeMessage('test-1', 'groupchat_2', 'alice', 'Charlie, did you water the plants while I was away?', '2025-08-26T09:02:11Z'),
    makeMessage('test-1', 'groupchat_2', 'charlie', 'Twice! The tomatoes are thriving.', '2025-08-26T09:03:47Z'),
  ],
  'hermes-desktop': [
    makeMessage('hermes', 'hermes-desktop', 'radoslav', 'I want Honcho to run on my Docker host but use my existing Postgres LXC.', '2026-10-20T16:02:30Z'),
    makeMessage('hermes', 'hermes-desktop', 'hermes', 'That works — point DB_CONNECTION_URI at the Postgres LXC and create the pgvector extension as the superuser first.', '2026-10-20T16:02:52Z'),
    makeMessage('hermes', 'hermes-desktop', 'radoslav', 'Remember: I prefer short, direct answers with evidence, not bare claims.', '2026-10-20T16:04:15Z'),
    makeMessage('hermes', 'hermes-desktop', 'hermes', 'Noted. I will keep answers concise and cite what I checked.', '2026-10-20T16:04:31Z'),
  ],
  'evening-planning': [
    makeMessage('hermes', 'evening-planning', 'radoslav', 'The kids have school tours coming up, but do not remind me about them unless I ask.', '2026-10-26T02:42:03Z'),
    makeMessage('hermes', 'evening-planning', 'hermes', 'Understood — school reminders stay off unless you bring them up.', '2026-10-26T02:42:20Z'),
  ],
}

const peerCards: Record<string, string[]> = {
  alice: [
    'Name: Alice',
    'Loves sci-fi novels, recently finished a book she rated highly',
    'Wants to start a book club with Bob and Charlie',
    'Friendly, playful communication style',
  ],
  bob: ['Name: Bob', 'Currently reading a mystery novel', 'Easygoing; defers first book-club pick to Alice'],
  charlie: [
    'Name: Charlie',
    'Dislikes sci-fi; prefers historical fiction and sea voyage stories',
    'Dry humor; negotiates playfully',
  ],
  radoslav: [
    'Stay-at-home mom of two in San Diego',
    'Web developer; runs self-hosted infrastructure on Proxmox',
    'Prefers direct, evidence-backed answers',
    'Works in writing more comfortably than speaking',
  ],
  hermes: ['AI assistant peer for the hermes workspace', 'Runs GPT-class models via Azure Foundry and OpenRouter'],
  claude: ['Second-opinion reviewer peer', 'Prefers deterministic, well-tested code'],
}

const representations: Record<string, string> = {
  alice:
    'Alice is an enthusiastic reader with a strong preference for science fiction. She initiates social plans (proposing a book club) and engages warmly with both Bob and Charlie, teasing Charlie about his dislike of sci-fi while genuinely asking for his recommendations. Her messages are upbeat and inclusive.',
  bob: 'Bob is a relaxed, agreeable participant. He is currently reading a mystery novel he finds hard to put down, and he tends to mediate — for example, proposing Alice gets the first book-club pick.',
  charlie:
    'Charlie has a stated dislike of science fiction ("least favorite genre") and a preference for historical fiction, especially sea voyages. Despite disagreeing with Alice on genre, he engages positively and playfully, asking for the second book-club pick and offering to bring snacks.',
  radoslav:
    'Radoslav is a web developer and stay-at-home mom in San Diego who self-hosts AI tooling (Hermes Agent with Honcho memory, on Proxmox LXCs). She steers work in short, direct instructions, expects claims to be backed by evidence, and prefers written communication. She has explicitly asked not to be reminded about school-choice topics unless she raises them.',
  hermes:
    'Hermes is the AI peer in this workspace. It answers questions, helps configure its own memory stack, and records durable preferences stated by the user peer.',
  claude:
    'Claude is the reviewer peer in this workspace. It joins sessions to give a second opinion, prefers deterministic tests, and writes short, broken-down components.',
}

function makeConclusion(
  id: string,
  observerId: string,
  observedId: string,
  sessionId: string,
  level: Conclusion['level'],
  content: string,
  createdAt: string,
): Conclusion {
  return {
    id,
    content,
    observer_id: observerId,
    observed_id: observedId,
    session_id: sessionId,
    level,
    source_ids: [],
    source_message_ids: [],
    times_derived: 1,
    created_at: createdAt,
  }
}

let conclusions: Conclusion[] = [
  makeConclusion('concl_demo_test1_01', 'hermes', 'alice', 'groupchat_1', 'explicit', 'Alice loves sci-fi novels.', '2025-08-25T13:52:00Z'),
  makeConclusion('concl_demo_test1_02', 'hermes', 'alice', 'groupchat_1', 'explicit', 'Alice proposed starting a book club with Bob and Charlie.', '2025-08-25T13:52:05Z'),
  makeConclusion('concl_demo_test1_03', 'hermes', 'alice', 'groupchat_1', 'deductive', 'Alice values Charlie\u2019s opinion despite their opposing genre tastes.', '2025-08-25T14:05:00Z'),
  makeConclusion('concl_demo_test1_04', 'hermes', 'bob', 'groupchat_1', 'explicit', 'Bob is reading a mystery novel he cannot put down.', '2025-08-25T13:52:10Z'),
  makeConclusion('concl_demo_test1_05', 'hermes', 'charlie', 'groupchat_1', 'explicit', 'Charlie considers sci-fi his least favorite genre.', '2025-08-25T13:52:15Z'),
  makeConclusion('concl_demo_test1_06', 'hermes', 'charlie', 'groupchat_1', 'explicit', 'Charlie prefers historical fiction, especially sea voyage stories.', '2025-08-25T13:52:20Z'),
  ...buildTest1ExtraConclusions(),
  makeConclusion('concl_demo_hermes_01', 'hermes', 'radoslav', 'hermes-desktop', 'explicit', 'Radoslav runs Honcho against an existing Postgres LXC rather than a bundled database.', '2026-10-20T16:10:00Z'),
  makeConclusion('concl_demo_hermes_02', 'hermes', 'radoslav', 'hermes-desktop', 'explicit', 'Radoslav prefers short, direct, evidence-backed answers.', '2026-10-20T16:10:05Z'),
  makeConclusion('concl_demo_hermes_03', 'hermes', 'radoslav', 'evening-planning', 'explicit', 'Radoslav does not want proactive reminders about school tours.', '2026-10-26T02:50:00Z'),
  ...buildHermesConclusions(),
]

const hermesMessages = buildHermesMessages()
for (const [sessionId, generated] of Object.entries(hermesMessages)) {
  const existing = messagesBySession[sessionId] ?? []
  messagesBySession[sessionId] = [...generated, ...existing].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )
}

const scopesByWorkspace: Record<string, Scope[]> = {
  'test-1': [
    { id: 'book-club', metadata: {}, created_at: '2025-08-26T09:10:00Z' },
  ],
  hermes: [
    { id: 'personal-memory', metadata: {}, created_at: '2026-10-21T10:00:00Z' },
    { id: 'work-projects', metadata: {}, created_at: '2026-10-22T10:00:00Z' },
  ],
}

const scopeSessions: Record<string, string[]> = {
  'book-club': ['groupchat_1', 'groupchat_2'],
  'personal-memory': ['hermes-desktop', 'evening-planning', 'family-logistics'],
  'work-projects': ['infra-setup', 'learning-plan'],
}

const scopeStatuses: Record<string, ScopeStatus> = {
  'book-club': {
    backfill_status: {
      groupchat_1: { state: 'completed', updated_at: '2025-08-26T09:12:00Z', docs_copied: 12 },
      groupchat_2: { state: 'completed', updated_at: '2025-08-26T09:12:30Z', docs_copied: 2 },
    },
  },
  'personal-memory': {
    backfill_status: {
      'hermes-desktop': { state: 'completed', updated_at: '2026-10-21T10:05:00Z', docs_copied: 16 },
      'evening-planning': { state: 'pending', updated_at: '2026-10-26T03:00:00Z' },
    },
  },
  'work-projects': { backfill_status: {} },
}

function workspaceSessionIds(workspaceId: string): Set<string> {
  return new Set((sessionsByWorkspace[workspaceId] ?? []).map((session) => session.id))
}

function workspaceConclusions(workspaceId: string): Conclusion[] {
  const sessionIds = workspaceSessionIds(workspaceId)
  return conclusions.filter(
    (entry) => entry.session_id !== null && sessionIds.has(entry.session_id),
  )
}

function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const start = (page - 1) * size
  const slice = items.slice(start, start + size)
  return {
    items: slice,
    total: items.length,
    page,
    size,
    pages: Math.max(1, Math.ceil(items.length / size)),
  }
}

function searchMessages(pool: Message[], query: string, limit: number): Message[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  return pool.filter((message) => message.content.toLowerCase().includes(needle)).slice(0, limit)
}

const allMessages: Message[] = Object.values(messagesBySession).flat()

export class DemoHonchoApi implements HonchoApi {
  private readonly stats = (() => {
    const collector = new StatsCollector()
    seedDemoStats(collector)
    return collector
  })()

  routeDescription(): string {
    return 'demo fixtures (no server request)'
  }

  async health(): Promise<{ status: string }> {
    return { status: 'ok' }
  }

  clearServerData(): void {
    this.demoConclusionsCache.clear()
    this.stats.clear()
  }

  async serverVersion(): Promise<string | null> {
    const version = demoSpec.info?.version
    if (!version) return null
    return `${version} (demo)`
  }

  async listWorkspaces(page = 1, size = 50): Promise<Page<Workspace>> {
    return paginate(workspaces, page, size)
  }

  async createWorkspace(id: string): Promise<Workspace> {
    const existing = workspaces.find((workspace) => workspace.id === id)
    if (existing) return existing
    const created: Workspace = {
      id,
      uid: `ws_demo_${id}`,
      metadata: {},
      configuration: {},
      created_at: '2026-10-29T07:00:00Z',
    }
    workspaces = [...workspaces, created]
    peersByWorkspace[id] = []
    sessionsByWorkspace[id] = []
    return created
  }

  async updateWorkspace(
    workspaceId: string,
    update: { metadata?: Record<string, unknown>; configuration?: Record<string, unknown> },
  ): Promise<Workspace> {
    const found = workspaces.find((workspace) => workspace.id === workspaceId)
    if (!found) throw new Error(`Workspace ${workspaceId} not found (demo)`)
    if (update.metadata !== undefined) found.metadata = update.metadata
    if (update.configuration !== undefined) found.configuration = update.configuration
    return found
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    return workspaces.find((workspace) => workspace.id === workspaceId) ?? null
  }

  async createPeer(workspaceId: string, id: string): Promise<Peer> {
    const list = peersByWorkspace[workspaceId] ?? []
    const existing = list.find((peer) => peer.id === id)
    if (existing) return existing
    const created = makePeer(workspaceId, id, '2026-10-29T07:00:00Z')
    peersByWorkspace[workspaceId] = [...list, created]
    return created
  }

  async createSession(workspaceId: string, id: string): Promise<Session> {
    const list = sessionsByWorkspace[workspaceId] ?? []
    const existing = list.find((session) => session.id === id)
    if (existing) return existing
    const created = makeSession(workspaceId, id, '2026-10-29T07:00:00Z', true)
    sessionsByWorkspace[workspaceId] = [...list, created]
    sessionPeers[id] = []
    return created
  }

  async addPeersToSession(
    workspaceId: string,
    sessionId: string,
    peerIds: string[],
  ): Promise<Session> {
    const current = sessionPeers[sessionId] ?? []
    sessionPeers[sessionId] = [...new Set([...current, ...peerIds])]
    const session = (sessionsByWorkspace[workspaceId] ?? []).find((entry) => entry.id === sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found (demo)`)
    return session
  }

  async fetchSpec(): Promise<OpenApiDoc> {
    return demoSpec
  }

  async execute(
    method: string,
    path: string,
    _queryParams: Record<string, string> = {},
    _jsonBodyText?: string,
  ): Promise<ExecuteResult> {
    const body = {
      demo: true,
      note: 'Demo mode - no server was called. This is a canned response.',
      method: method.toUpperCase(),
      path,
    }
    return { status: 200, durationMs: 0, bodyText: JSON.stringify(body, null, 2), bodyJson: body, isDemo: true }
  }

  getPerformanceStats(): PerformanceStats {
    return this.stats.snapshot()
  }

  async createKey(_options: CreateKeyOptions): Promise<unknown> {
    demoKeyCounter += 1
    return `hch-demo-FAKE-key-${demoKeyCounter}-do-not-use`
  }

  async listWebhooks(workspaceId: string): Promise<Page<WebhookEndpoint>> {
    return paginate(webhooksByWorkspace[workspaceId] ?? [], 1, 50)
  }

  async createWebhook(workspaceId: string, url: string): Promise<WebhookEndpoint> {
    webhookCounter += 1
    const created: WebhookEndpoint = {
      id: `wh_demo_${webhookCounter}`,
      workspace_id: workspaceId,
      url,
      created_at: '2026-10-29T07:00:00Z',
    }
    webhooksByWorkspace[workspaceId] = [...(webhooksByWorkspace[workspaceId] ?? []), created]
    return created
  }

  async deleteWebhook(workspaceId: string, endpointId: string): Promise<void> {
    webhooksByWorkspace[workspaceId] = (webhooksByWorkspace[workspaceId] ?? []).filter(
      (endpoint) => endpoint.id !== endpointId,
    )
  }

  async listPeers(workspaceId: string, page = 1, size = 50): Promise<Page<Peer>> {
    return paginate(peersByWorkspace[workspaceId] ?? [], page, size)
  }

  async getPeerCard(_workspaceId: string, peerId: string): Promise<string[] | null> {
    return peerCards[peerId] ?? null
  }

  async getRepresentation(_workspaceId: string, peerId: string): Promise<string> {
    return representations[peerId] ?? ''
  }

  async listConclusionsAboutPeer(
    workspaceId: string,
    peerId: string,
    page = 1,
    size = 50,
  ): Promise<Page<Conclusion>> {
    return this.listConclusions(workspaceId, { observed_id: peerId }, page, size)
  }

  async listConclusions(
    workspaceId: string,
    filters: ConclusionFilters = {},
    page = 1,
    size = 50,
  ): Promise<Page<Conclusion>> {
    const matching = filterConclusions(workspaceConclusions(workspaceId), filters)
    const sorted = [...matching].sort((a, b) => b.created_at.localeCompare(a.created_at))
    return paginate(sorted, page, size)
  }

  private demoConclusionsCache = new Map<string, { at: number; value: CappedConclusions }>()

  async fetchConclusionsCapped(
    workspaceId: string,
    filters: ConclusionFilters = {},
  ): Promise<CappedConclusions> {
    const key = `${workspaceId}|${JSON.stringify(filters)}`
    const cached = this.demoConclusionsCache.get(key)
    if (cached && Date.now() - cached.at < CONCLUSIONS_CACHE_MS) return cached.value
    const value = await fetchCapped(async (page, size) =>
      this.listConclusions(workspaceId, filters, page, size),
    )
    this.demoConclusionsCache.set(key, { at: Date.now(), value })
    return value
  }

  async getConclusion(_workspaceId: string, conclusionId: string): Promise<Conclusion> {
    const found = conclusions.find((entry) => entry.id === conclusionId)
    if (!found) throw new Error(`Conclusion ${conclusionId} not found (demo)`)
    return found
  }

  // Deterministic lexical ranking stands in for semantic search in demo
  // mode: score = number of query terms present in the content, ties
  // broken by recency, then id — same output on every run.
  async queryConclusions(
    workspaceId: string,
    query: string,
    topK = 20,
    filters: ConclusionFilters = {},
  ): Promise<Conclusion[]> {
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2)
    const pool = filterConclusions(workspaceConclusions(workspaceId), filters)
    const scored = pool
      .map((entry) => {
        const haystack = entry.content.toLowerCase()
        let score = 0
        for (const term of terms) if (haystack.includes(term)) score += 1
        return { entry, score }
      })
      .filter((row) => row.score > 0)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const byDate = b.entry.created_at.localeCompare(a.entry.created_at)
      if (byDate !== 0) return byDate
      return a.entry.id.localeCompare(b.entry.id)
    })
    return scored.slice(0, topK).map((row) => row.entry)
  }

  async deleteConclusion(workspaceId: string, conclusionId: string): Promise<void> {
    conclusions = conclusions.filter((entry) => entry.id !== conclusionId)
    for (const key of [...this.demoConclusionsCache.keys()]) {
      if (key.startsWith(`${workspaceId}|`)) this.demoConclusionsCache.delete(key)
    }
  }

  async getWorkspaceCounts(workspaceId: string): Promise<WorkspaceCounts> {
    const pool = workspaceConclusions(workspaceId)
    const byLevel = {} as Record<ConclusionLevel, number>
    for (const level of CONCLUSION_LEVELS) {
      byLevel[level] = pool.filter((entry) => entry.level === level).length
    }
    return {
      peers: (peersByWorkspace[workspaceId] ?? []).length,
      sessions: (sessionsByWorkspace[workspaceId] ?? []).length,
      conclusions: pool.length,
      byLevel,
    }
  }

  async chatWorkspace(workspaceId: string, query: string): Promise<WorkspaceChatResult> {
    const evidenceConclusions = await this.queryConclusions(workspaceId, query, 3)
    const evidenceMessages = searchMessages(
      allMessages.filter((message) => message.workspace_id === workspaceId),
      query.split(/\s+/)[0] ?? '',
      3,
    )
    const names = (peersByWorkspace[workspaceId] ?? []).map((peer) => peer.id).join(', ')
    return {
      content:
        `Demo answer — in a live connection the dialectic agent reasons over the whole workspace.\n\n` +
        `You asked: "${query}"\n\n` +
        `This workspace remembers ${workspaceConclusions(workspaceId).length} conclusions about: ${names}.`,
      evidence: {
        conclusions: evidenceConclusions.map((entry) => ({
          id: entry.id,
          level: entry.level,
          content: entry.content,
          created_at: entry.created_at,
        })),
        messages: evidenceMessages.map((message) => ({
          id: message.id,
          session_id: message.session_id,
          peer_id: message.peer_id,
          created_at: message.created_at,
        })),
        tool_calls: [{ name: 'conclusions_query', arguments: { query } }],
      },
    }
  }

  async listScopes(workspaceId: string, page = 1, size = 50): Promise<Page<Scope>> {
    return paginate(scopesByWorkspace[workspaceId] ?? [], page, size)
  }

  async getScopeStatus(_workspaceId: string, scopeId: string): Promise<ScopeStatus> {
    return scopeStatuses[scopeId] ?? { backfill_status: {} }
  }

  async listScopeSessions(
    workspaceId: string,
    scopeId: string,
    page = 1,
    size = 50,
  ): Promise<Page<Session>> {
    const ids = scopeSessions[scopeId] ?? []
    const matching = (sessionsByWorkspace[workspaceId] ?? []).filter((session) =>
      ids.includes(session.id),
    )
    return paginate(matching, page, size)
  }

  async listSessions(workspaceId: string, page = 1, size = 50): Promise<Page<Session>> {
    return paginate(sessionsByWorkspace[workspaceId] ?? [], page, size)
  }

  async listSessionsForPeer(workspaceId: string, peerId: string): Promise<Page<Session>> {
    const matching = (sessionsByWorkspace[workspaceId] ?? []).filter((session) =>
      (sessionPeers[session.id] ?? []).includes(peerId),
    )
    return paginate(matching, 1, 50)
  }

  async listMessages(
    _workspaceId: string,
    sessionId: string,
    page = 1,
    size = 50,
  ): Promise<Page<Message>> {
    return paginate(messagesBySession[sessionId] ?? [], page, size)
  }

  async getSessionPeers(workspaceId: string, sessionId: string): Promise<Peer[]> {
    const ids = sessionPeers[sessionId] ?? []
    return (peersByWorkspace[workspaceId] ?? []).filter((peer) => ids.includes(peer.id))
  }

  async getSessionSummaries(_workspaceId: string, sessionId: string): Promise<SessionSummaries> {
    if (sessionId === 'groupchat_1') {
      return {
        id: sessionId,
        short_summary: {
          content:
            'Alice, Bob, and Charlie chat about books: Alice loves sci-fi, Charlie prefers historical fiction, and the three agree to start a book club starting with Dune.',
          message_id: 'msg_demo_12',
          summary_type: 'short',
          created_at: '2025-08-25T13:50:00Z',
          token_count: 42,
        },
        long_summary: null,
      }
    }
    return { id: sessionId, short_summary: null, long_summary: null }
  }

  async getSessionContext(workspaceId: string, sessionId: string, _tokens: number) {
    const summaries = await this.getSessionSummaries(workspaceId, sessionId)
    return {
      id: sessionId,
      messages: messagesBySession[sessionId] ?? [],
      summary: summaries.short_summary,
      peer_representation: null,
      peer_card: null,
    }
  }

  async searchWorkspace(workspaceId: string, query: string, limit = 20): Promise<Message[]> {
    return searchMessages(
      allMessages.filter((message) => message.workspace_id === workspaceId),
      query,
      limit,
    )
  }

  async searchPeer(
    _workspaceId: string,
    peerId: string,
    query: string,
    limit = 20,
  ): Promise<Message[]> {
    return searchMessages(
      allMessages.filter((message) => message.peer_id === peerId),
      query,
      limit,
    )
  }

  async searchSession(
    _workspaceId: string,
    sessionId: string,
    query: string,
    limit = 20,
  ): Promise<Message[]> {
    return searchMessages(messagesBySession[sessionId] ?? [], query, limit)
  }

  async chatWithPeer(
    _workspaceId: string,
    peerId: string,
    query: string,
  ): Promise<string | null> {
    const representation = representations[peerId]
    if (!representation) return 'No memory has been formed about this peer yet.'
    return (
      `Demo answer — in a live connection this is where Honcho's dialectic reasoning replies.\n\n` +
      `You asked: "${query}"\n\n` +
      `What this instance remembers about ${peerId}: ${representation}`
    )
  }

  async getQueueStatus(workspaceId: string): Promise<QueueStatus> {
    const sessions: QueueStatus['sessions'] = {}
    const sessionList = sessionsByWorkspace[workspaceId] ?? []
    sessionList.forEach((session, index) => {
      const total = 24 - index * 3
      sessions[session.id] = {
        session_id: session.id,
        total_work_units: total,
        completed_work_units: total - (index === 0 ? 1 : 0),
        in_progress_work_units: index === 0 ? 1 : 0,
        pending_work_units: index === 1 ? 1 : 0,
      }
    })
    return {
      total_work_units: 128,
      completed_work_units: 126,
      in_progress_work_units: 1,
      pending_work_units: 1,
      sessions,
    }
  }
}
