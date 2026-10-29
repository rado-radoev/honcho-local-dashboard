import { useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime, formatJsonCell } from '../lib/format'
import { navigate } from '../lib/routing'
import {
  Breadcrumbs,
  CountBadge,
  EmptyState,
  ErrorBox,
  PageHeader,
  PaginationControls,
  RefreshButton,
  Spinner,
  TableHead,
} from '../components/ui'

// Full sessions table, mirroring the cloud session dashboard: breadcrumb
// "Workspaces > {id} > Sessions", count badge, SESSION ID / CREATED /
// ACTIVE / METADATA / CONFIG columns. Clicking a row opens the session
// utilities page.
export function SessionsPage({ workspaceId }: { workspaceId: string }) {
  const { api } = useConnection()
  const [page, setPage] = useState(1)

  const { data, error, loading, reload } = useAsyncData(
    async () => (api ? api.listSessions(workspaceId, page, 50) : null),
    [api, workspaceId, page],
  )

  return (
    <div>
      <PageHeader
        icon={<Layers className="h-6 w-6" />}
        title="Explore"
        subtitle="Browse all sessions in this workspace"
        backRoute={{ name: 'workspace', workspaceId }}
      />
      <Breadcrumbs
        parts={[
          { label: 'Workspaces', route: { name: 'explore' } },
          { label: workspaceId, route: { name: 'workspace', workspaceId } },
          { label: 'Sessions' },
        ]}
      />

      {error ? <ErrorBox message={error} /> : null}
      {loading && !data ? <Spinner label="Loading sessions…" /> : null}

      {data ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <CountBadge count={data.total} />
            <span className="text-sm text-fog">sessions</span>
            <button
              type="button"
              disabled
              title="Creating sessions is not part of the read-only local v1"
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fog opacity-50"
            >
              <Plus className="h-4 w-4" /> Create
            </button>
            <RefreshButton onRefresh={reload} spinning={loading} />
            <div className="ml-auto">
              <PaginationControls page={data.page} pages={data.pages} onChange={setPage} />
            </div>
          </div>

          {data.items.length === 0 ? (
            <EmptyState>No sessions in this workspace yet.</EmptyState>
          ) : (
            <table className="w-full border-collapse text-sm">
              <TableHead columns={['SESSION ID', 'CREATED', 'ACTIVE', 'METADATA', 'CONFIG']} />
              <tbody>
                {data.items.map((session) => (
                  <tr
                    key={session.uid}
                    className="cursor-pointer border-b border-line hover:bg-panel"
                    onClick={() =>
                      navigate({
                        name: 'session',
                        workspaceId,
                        sessionId: session.id,
                        tab: 'messages',
                      })
                    }
                  >
                    <td className="px-3 py-3 text-mist">{session.id}</td>
                    <td className="px-3 py-3 text-fog">{formatDateTime(session.created_at)}</td>
                    <td className="px-3 py-3 text-fog">{session.is_active ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-3 text-fog">{formatJsonCell(session.metadata)}</td>
                    <td className="px-3 py-3 text-fog">{formatJsonCell(session.configuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  )
}
