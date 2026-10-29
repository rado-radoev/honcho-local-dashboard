import { useState } from 'react'
import { Layers, Maximize2, MessageSquare, Search, Users } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime } from '../lib/format'
import { navigate } from '../lib/routing'
import { Breadcrumbs, CountBadge, ErrorBox, PageHeader, RefreshButton, Spinner } from '../components/ui'
import { MessageList } from '../components/MessageList'
import type { Message } from '../types'

// Workspace overview, mirroring the cloud workspace dashboard: breadcrumb
// "Workspaces > {id}", a Peers panel and a Sessions panel side by side,
// each with a count badge, refresh, and an expand icon that opens the full
// table. A workspace-wide message search sits below the panels (the API
// supports it; in the cloud UI search lives on the peer/session pages).
export function WorkspacePage({ workspaceId }: { workspaceId: string }) {
  const { api } = useConnection()

  const peers = useAsyncData(
    async () => (api ? api.listPeers(workspaceId, 1, 5) : null),
    [api, workspaceId],
  )
  const sessions = useAsyncData(
    async () => (api ? api.listSessions(workspaceId, 1, 5) : null),
    [api, workspaceId],
  )

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function runSearch() {
    if (!api || query.trim().length === 0) return
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await api.searchWorkspace(workspaceId, query.trim()))
    } catch (caught) {
      setSearchError(caught instanceof Error ? caught.message : 'Search failed')
    }
    setSearching(false)
  }

  return (
    <div>
      <PageHeader
        icon={<Layers className="h-6 w-6" />}
        title="Explore"
        subtitle="Explore peers and sessions"
        backRoute={{ name: 'explore' }}
      />
      <Breadcrumbs
        parts={[
          { label: 'Workspaces', route: { name: 'explore' } },
          { label: workspaceId },
        ]}
      />

      <h2 className="text-xl font-bold text-mist">Workspace: {workspaceId}</h2>
      <p className="mb-6 mt-1 text-sm text-fog">
        Click on a peer or session for more details.
      </p>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-label="Peers">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-mist">
              <Users className="h-5 w-5" /> Peers
            </h3>
            {peers.data ? <CountBadge count={peers.data.total} /> : null}
            <RefreshButton onRefresh={peers.reload} spinning={peers.loading} />
            <button
              type="button"
              title="Open the full peers table"
              className="ml-auto rounded-md p-2 text-fog hover:bg-panel-raise hover:text-mist"
              onClick={() => navigate({ name: 'peers', workspaceId })}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          {peers.error ? <ErrorBox message={peers.error} /> : null}
          {peers.loading && !peers.data ? <Spinner /> : null}
          {peers.data ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs tracking-widest text-fog">
                  <th className="px-3 py-2 font-medium">PEER ID</th>
                </tr>
              </thead>
              <tbody>
                {peers.data.items.map((peer) => (
                  <tr
                    key={peer.uid}
                    className="cursor-pointer border-b border-line hover:bg-panel"
                    onClick={() =>
                      navigate({ name: 'peer', workspaceId, peerId: peer.id, tab: 'search' })
                    }
                  >
                    <td className="px-3 py-3 text-mist">{peer.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        <section aria-label="Sessions">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-mist">
              <MessageSquare className="h-5 w-5" /> Sessions
            </h3>
            {sessions.data ? <CountBadge count={sessions.data.total} /> : null}
            <RefreshButton onRefresh={sessions.reload} spinning={sessions.loading} />
            <button
              type="button"
              title="Open the full sessions table"
              className="ml-auto rounded-md p-2 text-fog hover:bg-panel-raise hover:text-mist"
              onClick={() => navigate({ name: 'sessions', workspaceId })}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          {sessions.error ? <ErrorBox message={sessions.error} /> : null}
          {sessions.loading && !sessions.data ? <Spinner /> : null}
          {sessions.data ? (
            <div className="flex flex-col gap-3">
              {sessions.data.items.map((session) => (
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
          ) : null}
        </section>
      </div>

      <section className="mt-10" aria-label="Workspace search">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-mist">
          <Search className="h-5 w-5" /> Workspace Search
        </h3>
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
            placeholder="Search messages across this workspace…"
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
        {searchError ? (
          <div className="mt-4">
            <ErrorBox message={searchError} />
          </div>
        ) : null}
        {results !== null && !searching ? (
          <div className="mt-4">
            <MessageList messages={results} showSession emptyText="No messages matched your search." />
          </div>
        ) : null}
      </section>
    </div>
  )
}
