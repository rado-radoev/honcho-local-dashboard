import { useMemo, useState } from 'react'
import { AlertTriangle, ScrollText, Search, Trash2, X } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { navigate, type ConclusionsRouteParams } from '../lib/routing'
import { formatDateTime } from '../lib/format'
import { EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui'
import { Dialog } from '../components/Dialog'
import { LEVEL_COLORS, cappedLabel } from '../lib/conclusions'
import { traceChain } from '../lib/traceChain'
import type { Conclusion, ConclusionFilters } from '../types'

// Conclusions Explorer: filter / sort / semantically query the capped
// conclusions set of one workspace, inspect source chains, and delete a
// conclusion behind a confirm dialog (an explicit write — same pattern
// as the Playground's writes).

const selectClass =
  'rounded-md border border-line bg-panel px-2.5 py-2 text-sm text-mist outline-none focus:border-fog'

export function ConclusionsPage({
  workspaceId,
  initialFilters,
}: {
  workspaceId: string | null
  initialFilters: ConclusionsRouteParams
}) {
  const { api } = useConnection()
  const workspaces = useAsyncData(async () => (api ? api.listWorkspaces(1, 50) : null), [api])
  const activeWorkspace = workspaceId ?? workspaces.data?.items[0]?.id ?? null

  // Explicit id allow-list from the route (Fault Lines jump link).
  // Applied client-side over the capped set; cleared by its banner.
  const [ids, setIds] = useState<string[]>(initialFilters.ids)
  const [level, setLevel] = useState(initialFilters.level)
  const [observer, setObserver] = useState(initialFilters.observer)
  const [observed, setObserved] = useState(initialFilters.observed)
  const [sessionId, setSessionId] = useState(initialFilters.sessionId)
  const [sort, setSort] = useState<'recent' | 'derived'>('recent')
  const [query, setQuery] = useState('')
  const [queryResults, setQueryResults] = useState<Conclusion[] | null>(null)
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Conclusion | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const serverFilters: ConclusionFilters = {}
  if (level) serverFilters.level = level as ConclusionFilters['level']
  if (observer) serverFilters.observer_id = observer
  if (observed) serverFilters.observed_id = observed
  if (sessionId) serverFilters.session_id = sessionId

  const capped = useAsyncData(
    async () =>
      api && activeWorkspace ? api.fetchConclusionsCapped(activeWorkspace, serverFilters) : null,
    [api, activeWorkspace, level, observer, observed, sessionId],
  )
  const peers = useAsyncData(
    async () => (api && activeWorkspace ? api.listPeers(activeWorkspace, 1, 50) : null),
    [api, activeWorkspace],
  )
  const sessions = useAsyncData(
    async () => (api && activeWorkspace ? api.listSessions(activeWorkspace, 1, 50) : null),
    [api, activeWorkspace],
  )

  const items = useMemo(() => {
    let base = queryResults ?? capped.data?.items ?? []
    if (ids.length > 0) {
      const idSet = new Set(ids)
      base = base.filter((item) => idSet.has(item.id))
    }
    const sorted = [...base]
    if (sort === 'recent') sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
    else {
      sorted.sort((a, b) => {
        if (b.times_derived !== a.times_derived) return b.times_derived - a.times_derived
        return b.created_at.localeCompare(a.created_at)
      })
    }
    return sorted
  }, [queryResults, capped.data, sort, ids])

  async function runQuery() {
    if (!api || !activeWorkspace || query.trim().length === 0) return
    setQuerying(true)
    setQueryError(null)
    try {
      setQueryResults(await api.queryConclusions(activeWorkspace, query.trim(), 30, serverFilters))
    } catch (caught) {
      setQueryError(caught instanceof Error ? caught.message : 'Query failed')
    }
    setQuerying(false)
  }

  async function runDelete() {
    if (!api || !activeWorkspace || !selected) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteConclusion(activeWorkspace, selected.id)
      setConfirmDelete(false)
      setSelected(null)
      setQueryResults(null)
      capped.reload()
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'Delete failed')
    }
    setDeleting(false)
  }

  return (
    <div>
      <PageHeader
        icon={<ScrollText className="h-6 w-6" />}
        title="Conclusions"
        subtitle="Every memory this instance has derived — filter, query, trace, delete"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Workspace">
        {(workspaces.data?.items ?? []).map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() =>
              navigate({
                name: 'conclusions',
                workspaceId: workspace.id,
                filters: { observer, observed, level, sessionId, ids: [] },
              })
            }
            className={
              workspace.id === activeWorkspace
                ? 'rounded-md bg-badge px-3 py-1.5 text-sm font-semibold text-badge-ink'
                : 'rounded-md border border-line px-3 py-1.5 text-sm text-fog hover:text-mist'
            }
          >
            {workspace.id}
          </button>
        ))}
        {capped.data ? (
          <span className="ml-2 text-xs text-fog">{cappedLabel(capped.data)}</span>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs tracking-widest text-fog">
          LEVEL
          <select value={level} onChange={(event) => setLevel(event.target.value)} className={selectClass}>
            <option value="">All levels</option>
            <option value="explicit">explicit</option>
            <option value="deductive">deductive</option>
            <option value="inductive">inductive</option>
            <option value="contradiction">contradiction</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs tracking-widest text-fog">
          OBSERVER
          <select value={observer} onChange={(event) => setObserver(event.target.value)} className={selectClass}>
            <option value="">All observers</option>
            {(peers.data?.items ?? []).map((peer) => (
              <option key={peer.id} value={peer.id}>{peer.id}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs tracking-widest text-fog">
          OBSERVED
          <select value={observed} onChange={(event) => setObserved(event.target.value)} className={selectClass}>
            <option value="">All observed</option>
            {(peers.data?.items ?? []).map((peer) => (
              <option key={peer.id} value={peer.id}>{peer.id}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs tracking-widest text-fog">
          SESSION
          <select value={sessionId} onChange={(event) => setSessionId(event.target.value)} className={selectClass}>
            <option value="">All sessions</option>
            {(sessions.data?.items ?? []).map((session) => (
              <option key={session.id} value={session.id}>{session.id}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs tracking-widest text-fog">
          SORT
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as 'recent' | 'derived')}
            className={selectClass}
          >
            <option value="recent">Most recent</option>
            <option value="derived">Most derived</option>
          </select>
        </label>
        <form
          className="ml-auto flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void runQuery()
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Semantic query…"
            className="w-56 rounded-md border border-line bg-panel px-3 py-2 text-sm text-mist outline-none focus:border-fog"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-md bg-badge px-3 py-2 text-sm font-semibold text-badge-ink hover:brightness-110"
          >
            <Search className="h-4 w-4" /> Query
          </button>
          {queryResults ? (
            <button
              type="button"
              onClick={() => setQueryResults(null)}
              className="rounded-md border border-line px-3 py-2 text-sm text-mist hover:bg-panel"
            >
              Clear
            </button>
          ) : null}
        </form>
      </div>

      {ids.length > 0 ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm text-mist"
          data-testid="ids-filter-banner"
        >
          <span>
            Showing only the {ids.length} conclusion{ids.length === 1 ? '' : 's'} linked from
            Fault Lines.
          </span>
          <button
            type="button"
            onClick={() => setIds([])}
            className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-mist hover:bg-panel-raise"
          >
            <X className="h-3.5 w-3.5" /> Clear id filter
          </button>
        </div>
      ) : null}
      {queryError ? (
        <div className="mb-4"><ErrorBox message={queryError} /></div>
      ) : null}
      {capped.error ? (
        <div className="mb-4"><ErrorBox message={capped.error} /></div>
      ) : null}
      {querying ? <Spinner label="Querying conclusions…" /> : null}
      {capped.loading && !capped.data ? <Spinner label="Loading conclusions…" /> : null}

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {items.length === 0 && capped.data ? (
            <EmptyState>No conclusions match these filters.</EmptyState>
          ) : null}
          <div className="flex flex-col gap-2">
            {items.map((conclusion) => (
              <button
                key={conclusion.id}
                type="button"
                onClick={() => setSelected(conclusion)}
                className={
                  selected?.id === conclusion.id
                    ? 'card-shell flex items-start gap-3 px-4 py-3 text-left ring-1 ring-[#B79CFF]'
                    : 'card-shell flex items-start gap-3 px-4 py-3 text-left hover:bg-panel-raise'
                }
              >
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: LEVEL_COLORS[conclusion.level] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-mist">{conclusion.content}</span>
                  <span className="mt-0.5 block text-xs text-fog">
                    {conclusion.observer_id} → {conclusion.observed_id} ·{' '}
                    {conclusion.session_id ?? 'no session'} · derived ×{conclusion.times_derived} ·{' '}
                    {formatDateTime(conclusion.created_at)}
                  </span>
                </span>
                {conclusion.level === 'contradiction' ? (
                  <span className="flex shrink-0 items-center gap-1 rounded border border-red-900 bg-red-950/40 px-1.5 py-0.5 text-[10px] tracking-widest text-[#FF7A7A]">
                    <AlertTriangle className="h-3 w-3" /> CONTRADICTION
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {selected && activeWorkspace ? (
          <aside className="card-shell w-[340px] shrink-0 p-4" aria-label="Conclusion detail">
            <h2 className="mb-2 text-sm tracking-widest text-fog">SOURCE CHAIN</h2>
            <p className="text-sm leading-relaxed text-mist">{selected.content}</p>
            <p className="mt-2 text-xs text-fog">
              {selected.level} · {selected.observer_id} → {selected.observed_id} ·{' '}
              {formatDateTime(selected.created_at)}
            </p>
            <SourceChain
              workspaceId={activeWorkspace}
              conclusion={selected}
              pool={capped.data?.items ?? []}
            />
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-red-900 px-3 py-2 text-sm text-[#FF7A7A] hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" /> Delete conclusion
            </button>
            {deleteError ? (
              <div className="mt-3"><ErrorBox message={deleteError} /></div>
            ) : null}
          </aside>
        ) : null}
      </div>

      {confirmDelete && selected ? (
        <Dialog title="Delete conclusion" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm leading-relaxed text-fog">
            Permanently delete this conclusion from workspace{' '}
            <span className="text-mist">{activeWorkspace}</span>? This is a write to the Honcho
            server and cannot be undone from here.
          </p>
          <p className="mt-3 rounded-md bg-ink px-3 py-2 text-sm text-mist">{selected.content}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md border border-line px-4 py-2 text-sm text-mist hover:bg-panel-raise"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void runDelete()}
              className="rounded-md bg-red-900 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-800 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}

// Source chain: follows source_ids up to depth 5 via the shared pure
// traceChain() walk (lib/traceChain.ts — the same traversal the Memory
// Map's derivation trace uses), resolving ids from the already-fetched
// capped pool first and the API second. Also lists the
// source_message_ids each conclusion was derived from.
function SourceChain({
  workspaceId,
  conclusion,
  pool,
}: {
  workspaceId: string
  conclusion: Conclusion
  pool: Conclusion[]
}) {
  const { api } = useConnection()
  const [extra, setExtra] = useState<Record<string, Conclusion>>({})
  const byId = useMemo(() => {
    const map = new Map<string, Conclusion>()
    for (const item of pool) map.set(item.id, item)
    for (const item of Object.values(extra)) map.set(item.id, item)
    return map
  }, [pool, extra])

  const trace = useMemo(() => traceChain(conclusion, byId), [conclusion, byId])

  // Fetch every unresolved id in the walked chain (not just the
  // root's direct sources) so deeper ancestors can resolve too.
  const missing = trace.steps
    .filter((step) => step.missing && step.id !== conclusion.id)
    .map((step) => step.id)
  const missingKey = missing.join(',')
  const [requested, setRequested] = useState('')
  if (missing.length > 0 && requested !== missingKey && api) {
    setRequested(missingKey)
    void (async () => {
      const fetched: Record<string, Conclusion> = {}
      for (const id of missing) {
        try {
          fetched[id] = await api.getConclusion(workspaceId, id)
        } catch {
          // A dangling source id renders as an unresolved row.
        }
      }
      if (Object.keys(fetched).length > 0) setExtra((current) => ({ ...current, ...fetched }))
    })()
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      {trace.steps.map((step) => {
        if (step.depth === 0) {
          const root = step.conclusion
          if (!root) return null
          if (!root.source_message_ids || root.source_message_ids.length === 0) return null
          return (
            <p key={step.id} className="text-[11px] text-fog">
              from messages: {root.source_message_ids.join(', ')}
            </p>
          )
        }
        if (step.missing || !step.conclusion) {
          return (
            <p
              key={step.id}
              className="mt-2 border-l border-line pl-3 text-[11px] text-fog"
              style={{ marginLeft: (step.depth - 1) * 12 }}
            >
              {step.id} (not in capped set)
            </p>
          )
        }
        const item = step.conclusion
        return (
          <div
            key={step.id}
            className="mt-2 border-l border-line pl-3"
            style={{ marginLeft: (step.depth - 1) * 12 }}
          >
            <p className="text-xs leading-relaxed text-mist">{item.content}</p>
            {item.source_message_ids && item.source_message_ids.length > 0 ? (
              <p className="mt-1 text-[11px] text-fog">
                from messages: {item.source_message_ids.join(', ')}
              </p>
            ) : null}
          </div>
        )
      })}
      {trace.truncated ? (
        <p className="mt-1 text-[11px] text-fog">chain truncated at depth 5</p>
      ) : null}
    </div>
  )
}
