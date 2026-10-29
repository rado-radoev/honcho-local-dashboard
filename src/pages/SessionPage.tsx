import { useState } from 'react'
import { Layers, Pencil } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime } from '../lib/format'
import { navigate } from '../lib/routing'
import type { Message, SessionContext } from '../types'
import {
  Breadcrumbs,
  CountBadge,
  EmptyState,
  ErrorBox,
  PageHeader,
  PaginationControls,
  RefreshButton,
  Spinner,
  TabBar,
  TableHead,
} from '../components/ui'
import { MessageList } from '../components/MessageList'

// Session Utilities page, mirroring the cloud session dashboard, whose tabs
// are exactly: Messages / Search / Context / Peers.

const SESSION_TABS = [
  { id: 'messages', label: 'Messages' },
  { id: 'search', label: 'Search' },
  { id: 'context', label: 'Context' },
  { id: 'peers', label: 'Peers' },
]

export function SessionPage({
  workspaceId,
  sessionId,
  tab,
}: {
  workspaceId: string
  sessionId: string
  tab: string
}) {
  const activeTab = SESSION_TABS.some((entry) => entry.id === tab) ? tab : 'messages'

  function selectTab(tabId: string) {
    navigate({ name: 'session', workspaceId, sessionId, tab: tabId })
  }

  return (
    <div>
      <PageHeader
        icon={<Layers className="h-6 w-6" />}
        title="Explore"
        subtitle="Browse all sessions in this workspace"
        backRoute={{ name: 'sessions', workspaceId }}
      />
      <Breadcrumbs
        parts={[
          { label: 'Workspaces', route: { name: 'explore' } },
          { label: workspaceId, route: { name: 'workspace', workspaceId } },
          { label: 'Sessions', route: { name: 'sessions', workspaceId } },
          { label: sessionId },
        ]}
      />

      <h2 className="mb-5 flex items-center gap-3 text-lg text-fog">
        Session Utilities for <span className="font-bold text-mist">{sessionId}</span>
        <span className="flex items-center gap-1.5 text-sm text-fog" title="Read-only in the local v1">
          <Pencil className="h-4 w-4" /> Edit Config (read-only here)
        </span>
      </h2>

      <TabBar tabs={SESSION_TABS} activeTab={activeTab} onSelect={selectTab} />

      {activeTab === 'messages' ? (
        <SessionMessagesTab workspaceId={workspaceId} sessionId={sessionId} />
      ) : null}
      {activeTab === 'search' ? (
        <SessionSearchTab workspaceId={workspaceId} sessionId={sessionId} />
      ) : null}
      {activeTab === 'context' ? (
        <SessionContextTab workspaceId={workspaceId} sessionId={sessionId} />
      ) : null}
      {activeTab === 'peers' ? (
        <SessionPeersTab workspaceId={workspaceId} sessionId={sessionId} />
      ) : null}
    </div>
  )
}

function SessionMessagesTab({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { api } = useConnection()
  const [page, setPage] = useState(1)
  const [peerFilter, setPeerFilter] = useState('')

  const messages = useAsyncData(
    async () => (api ? api.listMessages(workspaceId, sessionId, page, 50) : null),
    [api, workspaceId, sessionId, page],
  )
  const summaries = useAsyncData(
    async () => (api ? api.getSessionSummaries(workspaceId, sessionId) : null),
    [api, workspaceId, sessionId],
  )
  const sessionPeers = useAsyncData(
    async () => (api ? api.getSessionPeers(workspaceId, sessionId) : null),
    [api, workspaceId, sessionId],
  )

  const visibleMessages =
    messages.data && peerFilter.length > 0
      ? messages.data.items.filter((message) => message.peer_id === peerFilter)
      : (messages.data?.items ?? [])

  return (
    <section aria-label="Messages">
      {summaries.data?.short_summary ? (
        <div className="mb-5 rounded-md border border-line bg-panel p-4">
          <h3 className="mb-1 text-xs tracking-widest text-fog">SUMMARY</h3>
          <p className="text-sm leading-relaxed text-mist">{summaries.data.short_summary.content}</p>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold uppercase tracking-widest text-mist">{sessionId}</span>
        <select
          value={peerFilter}
          onChange={(event) => setPeerFilter(event.target.value)}
          className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-mist outline-none"
          aria-label="Filter messages by peer"
        >
          <option value="">All Peers</option>
          {(sessionPeers.data ?? []).map((peer) => (
            <option key={peer.uid} value={peer.id}>
              {peer.id}
            </option>
          ))}
        </select>
        {messages.data ? <CountBadge count={messages.data.total} /> : null}
        <RefreshButton onRefresh={messages.reload} spinning={messages.loading} />
        <div className="ml-auto">
          {messages.data ? (
            <PaginationControls page={messages.data.page} pages={messages.data.pages} onChange={setPage} />
          ) : null}
        </div>
      </div>

      {messages.error ? <ErrorBox message={messages.error} /> : null}
      {messages.loading && !messages.data ? <Spinner label="Loading messages…" /> : null}
      {messages.data ? (
        <MessageList
          messages={visibleMessages}
          emptyText={
            peerFilter.length > 0
              ? `No messages from ${peerFilter} on this page.`
              : 'No messages in this session yet.'
          }
        />
      ) : null}
    </section>
  )
}

function SessionSearchTab({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
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
      setResults(await api.searchSession(workspaceId, sessionId, query.trim()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed')
    }
    setSearching(false)
  }

  return (
    <section aria-label="Search">
      <p className="mb-3 text-sm text-fog">Advanced search across this session&apos;s messages.</p>
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
          placeholder="Search this session…"
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
          <MessageList messages={results} emptyText="No messages matched your search." />
        </div>
      ) : null}
    </section>
  )
}

function SessionContextTab({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { api } = useConnection()
  const [tokens, setTokens] = useState(2000)
  const [context, setContext] = useState<SessionContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadContext() {
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      setContext(await api.getSessionContext(workspaceId, sessionId, tokens))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load context')
    }
    setLoading(false)
  }

  return (
    <section aria-label="Get Context">
      <p className="mb-3 text-sm text-fog">
        Get Context generates the LLM-ready context for this session, with a customizable token
        limit — the same utility as the cloud session page.
      </p>
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-xs tracking-widest text-fog" htmlFor="context-tokens">
            TOKEN LIMIT
          </label>
          <input
            id="context-tokens"
            type="number"
            min={100}
            max={100000}
            value={tokens}
            onChange={(event) => setTokens(Number(event.target.value))}
            className="mt-1.5 w-36 rounded-md border border-line bg-panel px-3 py-2.5 text-sm text-mist outline-none focus:border-fog"
          />
        </div>
        <button
          type="button"
          onClick={loadContext}
          className="rounded-md bg-badge px-4 py-2.5 text-sm font-semibold text-badge-ink hover:brightness-110"
        >
          Get Context
        </button>
      </div>

      {loading ? <Spinner label="Building context…" /> : null}
      {error ? (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      ) : null}

      {context && !loading ? (
        <div className="mt-6 flex flex-col gap-5">
          {context.summary ? (
            <div className="rounded-md border border-line bg-panel p-4">
              <h3 className="mb-1 text-xs tracking-widest text-fog">SUMMARY</h3>
              <p className="text-sm leading-relaxed text-mist">{context.summary.content}</p>
            </div>
          ) : null}
          {context.peer_representation ? (
            <div className="rounded-md border border-line bg-panel p-4">
              <h3 className="mb-1 text-xs tracking-widest text-fog">PEER REPRESENTATION</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-mist">
                {context.peer_representation}
              </p>
            </div>
          ) : null}
          <div>
            <h3 className="mb-2 text-xs tracking-widest text-fog">
              MESSAGES IN CONTEXT ({context.messages.length})
            </h3>
            <MessageList messages={context.messages} emptyText="Context contained no messages." />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SessionPeersTab({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { api } = useConnection()
  const { data, error, loading } = useAsyncData(
    async () => (api ? api.getSessionPeers(workspaceId, sessionId) : null),
    [api, workspaceId, sessionId],
  )

  if (loading && !data) return <Spinner label="Loading peers…" />
  if (error) return <ErrorBox message={error} />
  if (!data || data.length === 0) return <EmptyState>No peers in this session.</EmptyState>

  return (
    <section aria-label="Peers">
      <table className="w-full border-collapse text-sm">
        <TableHead columns={['PEER ID', 'CREATED']} />
        <tbody>
          {data.map((peer) => (
            <tr
              key={peer.uid}
              className="cursor-pointer border-b border-line hover:bg-panel"
              onClick={() =>
                navigate({ name: 'peer', workspaceId, peerId: peer.id, tab: 'search' })
              }
            >
              <td className="px-3 py-3 text-mist">{peer.id}</td>
              <td className="px-3 py-3 text-fog">{formatDateTime(peer.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-fog">
        Adding/removing peers is a write operation — not part of this read-only local v1.
      </p>
    </section>
  )
}
