import { useState } from 'react'
import { FolderSearch } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime } from '../lib/format'
import { EmptyState, ErrorBox, Spinner } from '../components/ui'
import type { Scope } from '../types'

// Scopes browser (read-only): list the workspace's scopes, their member
// sessions, and per-session backfill status. No writes — the dashboard
// only reads scope state.

export function WorkspaceScopesTab({ workspaceId }: { workspaceId: string }) {
  const { api } = useConnection()
  const [selectedScope, setSelectedScope] = useState<string | null>(null)

  const scopes = useAsyncData(
    async () => (api ? api.listScopes(workspaceId, 1, 50) : null),
    [api, workspaceId],
  )

  return (
    <section aria-label="Scopes">
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-mist">
        <FolderSearch className="h-5 w-5" /> Scopes
      </h3>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-fog">
        Scopes group sessions for scoped recall. This view is read-only: member sessions and
        backfill status per scope.
      </p>
      {scopes.error ? <ErrorBox message={scopes.error} /> : null}
      {scopes.loading && !scopes.data ? <Spinner label="Loading scopes…" /> : null}
      {scopes.data && scopes.data.items.length === 0 ? (
        <EmptyState>No scopes in this workspace yet.</EmptyState>
      ) : null}
      <div className="flex flex-col gap-2">
        {(scopes.data?.items ?? []).map((scope) => (
          <ScopeRow
            key={scope.id}
            workspaceId={workspaceId}
            scope={scope}
            expanded={selectedScope === scope.id}
            onToggle={() => setSelectedScope(selectedScope === scope.id ? null : scope.id)}
          />
        ))}
      </div>
    </section>
  )
}

function ScopeRow({
  workspaceId,
  scope,
  expanded,
  onToggle,
}: {
  workspaceId: string
  scope: Scope
  expanded: boolean
  onToggle: () => void
}) {
  const { api } = useConnection()
  const sessions = useAsyncData(
    async () => (api && expanded ? api.listScopeSessions(workspaceId, scope.id, 1, 50) : null),
    [api, workspaceId, scope.id, expanded],
  )
  const status = useAsyncData(
    async () => (api && expanded ? api.getScopeStatus(workspaceId, scope.id) : null),
    [api, workspaceId, scope.id, expanded],
  )

  return (
    <div className="card-shell px-4 py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span className="text-sm font-semibold text-mist">{scope.id}</span>
        <span className="text-xs text-fog">created {formatDateTime(scope.created_at)}</span>
        <span className="ml-auto text-xs text-fog">{expanded ? 'hide' : 'members + backfill'}</span>
      </button>
      {expanded ? (
        <div className="mt-3 border-t border-line pt-3">
          {sessions.loading ? <Spinner label="Loading member sessions…" /> : null}
          {sessions.error ? <ErrorBox message={sessions.error} /> : null}
          {sessions.data ? (
            <p className="mb-2 text-xs text-fog">
              Member sessions ({sessions.data.total}):{' '}
              <span className="text-mist">
                {sessions.data.items.map((session) => session.id).join(', ') || 'none'}
              </span>
            </p>
          ) : null}
          {status.data ? (
            Object.keys(status.data.backfill_status).length > 0 ? (
              <table className="w-full text-xs" aria-label={`Backfill status for scope ${scope.id}`}>
                <thead>
                  <tr className="text-left tracking-widest text-fog">
                    <th className="py-1 pr-3 font-medium">SESSION</th>
                    <th className="py-1 pr-3 font-medium">STATE</th>
                    <th className="py-1 pr-3 font-medium">DOCS COPIED</th>
                    <th className="py-1 font-medium">UPDATED</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(status.data.backfill_status).map(([sessionId, entry]) => (
                    <tr key={sessionId} className="border-t border-line">
                      <td className="py-1.5 pr-3 text-mist">{sessionId}</td>
                      <td className="py-1.5 pr-3">{entry.state}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{entry.docs_copied ?? '—'}</td>
                      <td className="py-1.5">{entry.updated_at ? formatDateTime(entry.updated_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-fog">No backfill has been enqueued for this scope.</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
