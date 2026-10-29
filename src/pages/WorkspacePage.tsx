import { useState } from 'react'
import { ArrowRight, Layers, Maximize2, MessageSquare, Pencil, Plus, Search, Users } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime } from '../lib/format'
import { navigate } from '../lib/routing'
import { Breadcrumbs, CountBadge, ErrorBox, PageHeader, RefreshButton, Spinner } from '../components/ui'
import { MessageList } from '../components/MessageList'
import { Dialog, darkButtonClass, dialogInputClass, dialogLabelClass, primaryButtonClass } from '../components/Dialog'
import type { Message } from '../types'

// Workspace overview, mirroring the cloud workspace dashboard
// (workspace-dash.png): breadcrumb "Workspaces > {id}", "Workspace: {id}"
// with Edit Config, then a two-column Peers | arrow | Sessions layout.
// Peers carry checkboxes; clicking a session while peers are checked adds
// those peers to the session instead of navigating.

type CreateKind = 'peer' | 'session' | null

export function WorkspacePage({ workspaceId }: { workspaceId: string }) {
  const { api } = useConnection()

  const peers = useAsyncData(
    async () => (api ? api.listPeers(workspaceId, 1, 50) : null),
    [api, workspaceId],
  )
  const sessions = useAsyncData(
    async () => (api ? api.listSessions(workspaceId, 1, 50) : null),
    [api, workspaceId],
  )
  const workspace = useAsyncData(
    async () => (api ? api.getWorkspace(workspaceId) : null),
    [api, workspaceId],
  )

  const [selectedPeers, setSelectedPeers] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeError, setNoticeError] = useState<string | null>(null)

  const [createKind, setCreateKind] = useState<CreateKind>(null)
  const [newId, setNewId] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [showEdit, setShowEdit] = useState(false)
  const [metaText, setMetaText] = useState('')
  const [configText, setConfigText] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  function togglePeer(peerId: string) {
    setSelectedPeers((current) => {
      const next = new Set(current)
      if (next.has(peerId)) next.delete(peerId)
      else next.add(peerId)
      return next
    })
  }

  async function onSessionClick(sessionId: string) {
    if (selectedPeers.size === 0) {
      navigate({ name: 'session', workspaceId, sessionId, tab: 'messages' })
      return
    }
    if (!api) return
    setNotice(null)
    setNoticeError(null)
    try {
      await api.addPeersToSession(workspaceId, sessionId, [...selectedPeers])
      setNotice(`Added ${selectedPeers.size} peer(s) to session ${sessionId}.`)
      setSelectedPeers(new Set())
    } catch (caught) {
      setNoticeError(caught instanceof Error ? caught.message : 'Adding peers failed')
    }
  }

  async function createEntry() {
    if (!api || !createKind) return
    const id = newId.trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 512) {
      setCreateError('Id must match ^[a-zA-Z0-9_-]+$ (max 512 characters).')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      if (createKind === 'peer') await api.createPeer(workspaceId, id)
      else await api.createSession(workspaceId, id)
      setCreateKind(null)
      setNewId('')
      peers.reload()
      sessions.reload()
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'Create failed')
    }
    setCreating(false)
  }

  function openEdit() {
    const current = workspace.data
    setMetaText(JSON.stringify(current?.metadata ?? {}, null, 2))
    setConfigText(JSON.stringify(current?.configuration ?? {}, null, 2))
    setEditError(null)
    setShowEdit(true)
  }

  async function saveEdit() {
    if (!api) return
    let metadata: Record<string, unknown>
    let configuration: Record<string, unknown>
    try {
      metadata = JSON.parse(metaText) as Record<string, unknown>
      configuration = JSON.parse(configText) as Record<string, unknown>
    } catch {
      setEditError('Metadata and configuration must be valid JSON objects.')
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      await api.updateWorkspace(workspaceId, { metadata, configuration })
      setShowEdit(false)
      workspace.reload()
      setNotice('Workspace configuration updated.')
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : 'Save failed')
    }
    setSaving(false)
  }

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

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-bold text-mist">Workspace: {workspaceId}</h2>
        <button type="button" onClick={openEdit} className={darkButtonClass}>
          <Pencil className="h-4 w-4" /> Edit Config
        </button>
      </div>
      <p className="mb-6 mt-2 text-sm text-fog">
        Create peers and sessions, add peers to sessions. Click on a peer or session for more details.
      </p>

      {notice ? (
        <div className="mb-4 rounded-md border border-green-900 bg-green-950/40 px-4 py-3 text-sm text-green-200">
          {notice}
        </div>
      ) : null}
      {noticeError ? (
        <div className="mb-4">
          <ErrorBox message={noticeError} />
        </div>
      ) : null}
      {selectedPeers.size > 0 ? (
        <p className="mb-4 text-sm text-badge">
          {selectedPeers.size} peer(s) selected — click a session to add them to it.
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <section aria-label="Peers">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-mist">
              <Users className="h-5 w-5" /> Peers
            </h3>
            {peers.data ? <CountBadge count={peers.data.total} /> : null}
            <button type="button" onClick={() => setCreateKind('peer')} className={darkButtonClass}>
              <Plus className="h-4 w-4" /> Create
            </button>
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
                  <th className="px-3 py-2" aria-label="Select" />
                </tr>
              </thead>
              <tbody>
                {peers.data.items.map((peer) => (
                  <tr key={peer.uid} className="border-b border-line hover:bg-panel">
                    <td
                      className="cursor-pointer px-3 py-3 text-mist"
                      onClick={() =>
                        navigate({ name: 'peer', workspaceId, peerId: peer.id, tab: 'search' })
                      }
                    >
                      {peer.id}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <input
                        type="checkbox"
                        aria-label={`Select peer ${peer.id}`}
                        checked={selectedPeers.has(peer.id)}
                        onChange={() => togglePeer(peer.id)}
                        className="h-4 w-4 accent-[#bcd6ff]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        <div className="hidden pt-24 text-fog lg:block" aria-hidden="true">
          <ArrowRight className="h-5 w-5" />
        </div>

        <section aria-label="Sessions">
          <div className="mb-3 flex items-center gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-mist">
              <MessageSquare className="h-5 w-5" /> Sessions
            </h3>
            {sessions.data ? <CountBadge count={sessions.data.total} /> : null}
            <button type="button" onClick={() => setCreateKind('session')} className={darkButtonClass}>
              <Plus className="h-4 w-4" /> Create
            </button>
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
            <>
              <div className="border-b border-line px-3 py-2 text-xs tracking-widest text-fog">
                SESSION ID
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {sessions.data.items.map((session) => (
                  <button
                    key={session.uid}
                    type="button"
                    className="flex items-center justify-between rounded-md border border-line px-4 py-3 text-left hover:bg-panel"
                    onClick={() => void onSessionClick(session.id)}
                  >
                    <span className="text-sm font-semibold text-mist">{session.id}</span>
                    <span className="text-xs text-fog">{formatDateTime(session.created_at)}</span>
                  </button>
                ))}
              </div>
            </>
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

      {createKind ? (
        <Dialog
          title={createKind === 'peer' ? 'Create Peer' : 'Create Session'}
          onClose={() => setCreateKind(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void createEntry()
            }}
          >
            <label className={dialogLabelClass} htmlFor="new-entry-id">
              {createKind === 'peer' ? 'PEER ID' : 'SESSION ID'}
            </label>
            <input
              id="new-entry-id"
              value={newId}
              onChange={(event) => setNewId(event.target.value)}
              className={dialogInputClass}
              autoFocus
            />
            {createError ? (
              <div className="mt-3">
                <ErrorBox message={createError} />
              </div>
            ) : null}
            <div className="mt-4 flex justify-end">
              <button type="submit" disabled={creating} className={primaryButtonClass}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {showEdit ? (
        <Dialog title="Edit Config" onClose={() => setShowEdit(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveEdit()
            }}
          >
            <label className={dialogLabelClass} htmlFor="ws-metadata">
              METADATA (JSON)
            </label>
            <textarea
              id="ws-metadata"
              value={metaText}
              onChange={(event) => setMetaText(event.target.value)}
              rows={4}
              className={dialogInputClass}
            />
            <label className={`${dialogLabelClass} mt-4`} htmlFor="ws-config">
              CONFIGURATION (JSON — replaces entirely)
            </label>
            <textarea
              id="ws-config"
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              rows={6}
              className={dialogInputClass}
            />
            {editError ? (
              <div className="mt-3">
                <ErrorBox message={editError} />
              </div>
            ) : null}
            <div className="mt-4 flex justify-end">
              <button type="submit" disabled={saving} className={primaryButtonClass}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  )
}
