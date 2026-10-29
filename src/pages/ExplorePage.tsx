import { Layers, Plus } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime, formatJsonCell } from '../lib/format'
import { navigate } from '../lib/routing'
import { CountBadge, EmptyState, ErrorBox, PageHeader, RefreshButton, Spinner, TableHead } from '../components/ui'

// Explore — the workspace table, mirroring the cloud Explore page:
// "Browse and manage your workspaces", a count badge, and a table with
// WORKSPACE ID / CREATED AT / METADATA / CONFIGURATION columns.
// (Create is shown disabled: this local dashboard is read-only in v1.)
export function ExplorePage() {
  const { api } = useConnection()
  const { data, error, loading, reload } = useAsyncData(
    async () => {
      if (!api) return null
      return api.listWorkspaces()
    },
    [api],
  )

  return (
    <div>
      <PageHeader
        icon={<Layers className="h-6 w-6" />}
        title="Explore"
        subtitle="Browse and manage your workspaces"
      />

      {error ? <ErrorBox message={error} /> : null}
      {loading && !data ? <Spinner label="Loading workspaces…" /> : null}

      {data ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <CountBadge count={data.total} />
            <span className="text-sm text-fog">workspaces</span>
            <button
              type="button"
              disabled
              title="Creating workspaces is not part of the read-only local v1"
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fog opacity-50"
            >
              <Plus className="h-4 w-4" /> Create
            </button>
            <RefreshButton onRefresh={reload} spinning={loading} />
          </div>

          {data.items.length === 0 ? (
            <EmptyState>No workspaces on this server yet.</EmptyState>
          ) : (
            <table className="w-full border-collapse text-sm">
              <TableHead columns={['WORKSPACE ID', 'CREATED AT', 'METADATA', 'CONFIGURATION']} />
              <tbody>
                {data.items.map((workspace) => (
                  <tr
                    key={workspace.uid}
                    className="cursor-pointer border-b border-line hover:bg-panel"
                    onClick={() => navigate({ name: 'workspace', workspaceId: workspace.id })}
                  >
                    <td className="px-3 py-3 text-mist">{workspace.id}</td>
                    <td className="px-3 py-3 text-fog">{formatDateTime(workspace.created_at)}</td>
                    <td className="px-3 py-3 text-fog">{formatJsonCell(workspace.metadata)}</td>
                    <td className="px-3 py-3 text-fog">{formatJsonCell(workspace.configuration)}</td>
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
