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

// Full peers table, mirroring the cloud peer dashboard: breadcrumb
// "Workspaces > {id} > Peers", count badge, PEER ID / CREATED / METADATA /
// CONFIG columns. Clicking a row opens the peer utilities page.
export function PeersPage({ workspaceId }: { workspaceId: string }) {
  const { api } = useConnection()
  const [page, setPage] = useState(1)

  const { data, error, loading, reload } = useAsyncData(
    async () => (api ? api.listPeers(workspaceId, page, 50) : null),
    [api, workspaceId, page],
  )

  return (
    <div>
      <PageHeader
        icon={<Layers className="h-6 w-6" />}
        title="Explore"
        subtitle="Browse all peers in this workspace"
        backRoute={{ name: 'workspace', workspaceId }}
      />
      <Breadcrumbs
        parts={[
          { label: 'Workspaces', route: { name: 'explore' } },
          { label: workspaceId, route: { name: 'workspace', workspaceId } },
          { label: 'Peers' },
        ]}
      />

      {error ? <ErrorBox message={error} /> : null}
      {loading && !data ? <Spinner label="Loading peers…" /> : null}

      {data ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <CountBadge count={data.total} />
            <span className="text-sm text-fog">peers</span>
            <button
              type="button"
              disabled
              title="Creating peers is not part of the read-only local v1"
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
            <EmptyState>No peers in this workspace yet.</EmptyState>
          ) : (
            <table className="w-full border-collapse text-sm">
              <TableHead columns={['PEER ID', 'CREATED', 'METADATA', 'CONFIG']} />
              <tbody>
                {data.items.map((peer) => (
                  <tr
                    key={peer.uid}
                    className="cursor-pointer border-b border-line hover:bg-panel"
                    onClick={() =>
                      navigate({ name: 'peer', workspaceId, peerId: peer.id, tab: 'search' })
                    }
                  >
                    <td className="px-3 py-3 text-mist">{peer.id}</td>
                    <td className="px-3 py-3 text-fog">{formatDateTime(peer.created_at)}</td>
                    <td className="px-3 py-3 text-fog">{formatJsonCell(peer.metadata)}</td>
                    <td className="px-3 py-3 text-fog">{formatJsonCell(peer.configuration)}</td>
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
