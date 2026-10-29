import { useState } from 'react'
import { Layers, Pencil, Send } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime } from '../lib/format'
import { navigate } from '../lib/routing'
import { REASONING_LEVELS, type Message, type ReasoningLevel } from '../types'
import {
  Breadcrumbs,
  EmptyState,
  ErrorBox,
  PageHeader,
  PaginationControls,
  Spinner,
  TabBar,
} from '../components/ui'
import { MessageList } from '../components/MessageList'

// Peer Utilities page, mirroring the cloud peer dashboard. The cloud tab
// order is Search / Chat / Sessions / Config; this local read-only build
// keeps those and adds Peer Card, Representation, and Conclusions tabs —
// the core memory data Honcho keeps about a peer — before Config.

const PEER_TABS = [
  { id: 'search', label: 'Search' },
  { id: 'chat', label: 'Chat' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'card', label: 'Peer Card' },
  { id: 'representation', label: 'Representation' },
  { id: 'conclusions', label: 'Conclusions' },
  { id: 'config', label: 'Config' },
]

export function PeerPage({
  workspaceId,
  peerId,
  tab,
}: {
  workspaceId: string
  peerId: string
  tab: string
}) {
  const activeTab = PEER_TABS.some((entry) => entry.id === tab) ? tab : 'search'

  function selectTab(tabId: string) {
    navigate({ name: 'peer', workspaceId, peerId, tab: tabId })
  }

  return (
    <div>
      <PageHeader
        icon={<Layers className="h-6 w-6" />}
        title="Explore"
        subtitle="Browse all peers in this workspace"
        backRoute={{ name: 'peers', workspaceId }}
      />
      <Breadcrumbs
        parts={[
          { label: 'Workspaces', route: { name: 'explore' } },
          { label: workspaceId, route: { name: 'workspace', workspaceId } },
          { label: 'Peers', route: { name: 'peers', workspaceId } },
          { label: peerId },
        ]}
      />

      <h2 className="mb-5 flex items-center gap-3 text-lg text-fog">
        Peer Utilities for <span className="font-bold text-mist">{peerId}</span>
        <span className="flex items-center gap-1.5 text-sm text-fog" title="Read-only in the local v1">
          <Pencil className="h-4 w-4" /> Edit Config (read-only here)
        </span>
      </h2>

      <TabBar tabs={PEER_TABS} activeTab={activeTab} onSelect={selectTab} />

      {activeTab === 'search' ? <PeerSearchTab workspaceId={workspaceId} peerId={peerId} /> : null}
      {activeTab === 'chat' ? <PeerChatTab workspaceId={workspaceId} peerId={peerId} /> : null}
      {activeTab === 'sessions' ? <PeerSessionsTab workspaceId={workspaceId} peerId={peerId} /> : null}
      {activeTab === 'card' ? <PeerCardTab workspaceId={workspaceId} peerId={peerId} /> : null}
      {activeTab === 'representation' ? (
        <PeerRepresentationTab workspaceId={workspaceId} peerId={peerId} />
      ) : null}
      {activeTab === 'conclusions' ? (
        <PeerConclusionsTab workspaceId={workspaceId} peerId={peerId} />
      ) : null}
      {activeTab === 'config' ? <PeerConfigTab workspaceId={workspaceId} peerId={peerId} /> : null}
    </div>
  )
}

function PeerSearchTab({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const { api } = useConnection()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function runSearch() {
    if (!api || query.trim().length === 0) return
    setSearching(true)
    setError(null)
    try {
      setResults(await api.searchPeer(workspaceId, peerId, query.trim()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed')
    }
    setSearching(false)
  }

  return (
    <section aria-label="Message search">
      <p className="mb-3 text-sm text-fog">Message search across all sessions for this peer.</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch()
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this peer's messages…"
          className="w-full max-w-xl rounded-md border border-line bg-panel px-3 py-2.5 text-sm text-mist outline-none focus:border-fog"
        />
        <button
          type="submit"
          className="rounded-md bg-badge px-4 py-2.5 text-sm font-semibold text-badge-ink hover:brightness-110"
        >
          Search
        </button>
      </form>
      {searching ? <Spinner label="Searching…" /> : null}
      {error ? (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      ) : null}
      {results !== null && !searching ? (
        <div className="mt-4">
          <MessageList messages={results} showSession emptyText="No messages matched your search." />
        </div>
      ) : null}
    </section>
  )
}

function PeerChatTab({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const { api } = useConnection()
  const [sessionScope, setSessionScope] = useState('')
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>('low')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  async function runChat() {
    if (!api || question.trim().length === 0) return
    setAsking(true)
    setError(null)
    try {
      const content = await api.chatWithPeer(
        workspaceId,
        peerId,
        question.trim(),
        reasoningLevel,
        sessionScope.trim().length > 0 ? sessionScope.trim() : undefined,
      )
      setAnswer(content ?? 'Honcho returned an empty answer.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chat failed')
    }
    setAsking(false)
  }

  return (
    <section aria-label="Chat">
      <label className="block text-xs tracking-widest text-fog" htmlFor="chat-session-scope">
        SESSION ID
      </label>
      <input
        id="chat-session-scope"
        value={sessionScope}
        onChange={(event) => setSessionScope(event.target.value)}
        placeholder="Optional session scope"
        className="mt-1.5 w-full max-w-md rounded-md border border-line bg-panel px-3 py-2.5 text-sm text-mist outline-none focus:border-fog"
      />

      <label className="mt-4 block text-xs tracking-widest text-fog" htmlFor="chat-reasoning">
        REASONING LEVEL
      </label>
      <select
        id="chat-reasoning"
        value={reasoningLevel}
        onChange={(event) => setReasoningLevel(event.target.value as ReasoningLevel)}
        className="mt-1.5 rounded-md border border-line bg-panel px-3 py-2.5 text-sm text-mist outline-none"
      >
        {REASONING_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>

      <div className="mt-4 flex items-start gap-2">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={`Ask about ${peerId}…`}
          rows={3}
          className="w-full rounded-md border border-line bg-panel px-3 py-2.5 text-sm text-mist outline-none focus:border-fog"
        />
        <button
          type="button"
          onClick={runChat}
          disabled={asking}
          title="Ask"
          className="rounded-md border border-line p-3 text-mist hover:bg-panel-raise disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      {asking ? <Spinner label="Thinking — dialectic queries can take a while…" /> : null}
      {error ? (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      ) : null}
      {answer !== null && !asking ? (
        <div className="mt-4 whitespace-pre-wrap rounded-md border border-line bg-panel p-5 text-sm leading-relaxed text-mist">
          {answer}
        </div>
      ) : null}
    </section>
  )
}

function PeerSessionsTab({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const { api } = useConnection()
  const { data, error, loading } = useAsyncData(
    async () => (api ? api.listSessionsForPeer(workspaceId, peerId) : null),
    [api, workspaceId, peerId],
  )

  if (loading && !data) return <Spinner label="Loading sessions…" />
  if (error) return <ErrorBox message={error} />
  if (!data || data.items.length === 0) {
    return <EmptyState>This peer is not active in any session yet.</EmptyState>
  }

  return (
    <section aria-label="Sessions">
      <p className="mb-3 text-sm text-fog">Session logs — sessions this peer is active in.</p>
      <div className="flex flex-col gap-3">
        {data.items.map((session) => (
          <button
            key={session.uid}
            type="button"
            className="flex items-center justify-between rounded-md border border-line px-4 py-3 text-left hover:bg-panel"
            onClick={() =>
              navigate({ name: 'session', workspaceId, sessionId: session.id, tab: 'messages' })
            }
          >
            <span className="text-sm font-semibold text-mist">{session.id}</span>
            <span className="text-xs text-fog">{formatDateTime(session.created_at)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function PeerCardTab({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const { api } = useConnection()
  const { data, error, loading } = useAsyncData(
    async () => (api ? api.getPeerCard(workspaceId, peerId) : null),
    [api, workspaceId, peerId],
  )

  if (loading && data === null) return <Spinner label="Loading peer card…" />
  if (error) return <ErrorBox message={error} />
  if (!data || data.length === 0) {
    return (
      <EmptyState>
        No peer card yet. Cards appear once Honcho has processed some of this peer&apos;s messages.
      </EmptyState>
    )
  }

  return (
    <section aria-label="Peer card">
      <ul className="flex flex-col gap-2">
        {data.map((line, index) => (
          <li
            key={`${index}-${line}`}
            className="rounded-md border border-line bg-panel px-4 py-3 text-sm text-mist"
          >
            {line}
          </li>
        ))}
      </ul>
    </section>
  )
}

function PeerRepresentationTab({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const { api } = useConnection()
  const { data, error, loading } = useAsyncData(
    async () => (api ? api.getRepresentation(workspaceId, peerId) : null),
    [api, workspaceId, peerId],
  )

  if (loading && data === null) return <Spinner label="Loading representation…" />
  if (error) return <ErrorBox message={error} />
  if (!data || data.trim().length === 0) {
    return (
      <EmptyState>
        No representation yet. Representations build up as the deriver processes this peer&apos;s
        messages.
      </EmptyState>
    )
  }

  return (
    <section
      aria-label="Representation"
      className="whitespace-pre-wrap rounded-md border border-line bg-panel p-5 text-sm leading-relaxed text-mist"
    >
      {data}
    </section>
  )
}

function PeerConclusionsTab({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const { api } = useConnection()
  const [page, setPage] = useState(1)
  const { data, error, loading } = useAsyncData(
    async () => (api ? api.listConclusionsAboutPeer(workspaceId, peerId, page, 50) : null),
    [api, workspaceId, peerId, page],
  )

  if (loading && !data) return <Spinner label="Loading conclusions…" />
  if (error) return <ErrorBox message={error} />
  if (!data || data.items.length === 0) {
    return <EmptyState>No conclusions about this peer yet.</EmptyState>
  }

  return (
    <section aria-label="Conclusions">
      <div className="mb-4 flex justify-end">
        <PaginationControls page={data.page} pages={data.pages} onChange={setPage} />
      </div>
      <ul className="flex flex-col gap-3">
        {data.items.map((conclusion) => (
          <li key={conclusion.id} className="rounded-md border border-line bg-panel px-4 py-3">
            <p className="text-sm leading-relaxed text-mist">{conclusion.content}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fog">
              <span className="rounded bg-panel-raise px-2 py-0.5 tracking-widest">
                {conclusion.level.toUpperCase()}
              </span>
              <span>
                {conclusion.observer_id} → {conclusion.observed_id}
              </span>
              {conclusion.session_id ? <span>in {conclusion.session_id}</span> : null}
              <span>{formatDateTime(conclusion.created_at)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PeerConfigTab({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const { api } = useConnection()
  const { data, error, loading } = useAsyncData(
    async () => {
      if (!api) return null
      const page = await api.listPeers(workspaceId, 1, 100)
      return page.items.find((peer) => peer.id === peerId) ?? null
    },
    [api, workspaceId, peerId],
  )

  if (loading && !data) return <Spinner label="Loading configuration…" />
  if (error) return <ErrorBox message={error} />
  if (!data) return <EmptyState>Peer not found in this workspace.</EmptyState>

  return (
    <section aria-label="Configuration">
      <p className="mb-3 text-sm text-fog">
        Peer configuration and metadata, read-only in this local dashboard (the cloud dashboard
        edits these via Edit Config).
      </p>
      <h3 className="mb-2 text-xs tracking-widest text-fog">CONFIGURATION</h3>
      <pre className="mb-5 overflow-x-auto rounded-md border border-line bg-panel p-4 text-xs text-mist">
        {JSON.stringify(data.configuration, null, 2)}
      </pre>
      <h3 className="mb-2 text-xs tracking-widest text-fog">METADATA</h3>
      <pre className="overflow-x-auto rounded-md border border-line bg-panel p-4 text-xs text-mist">
        {JSON.stringify(data.metadata, null, 2)}
      </pre>
    </section>
  )
}
