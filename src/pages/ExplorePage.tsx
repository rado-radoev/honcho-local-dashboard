import { useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime, formatJsonCell, formatMetadataCell } from '../lib/format'
import { navigate } from '../lib/routing'
import {
  CountBadge,
  EmptyState,
  ErrorBox,
  PageHeader,
  RefreshButton,
  Spinner,
  TableHead,
} from '../components/ui'
import { Dialog, darkButtonClass, dialogInputClass, dialogLabelClass, primaryButtonClass } from '../components/Dialog'

// Explore — the workspace table, mirroring the cloud Explore page:
// "Browse and manage your workspaces", a count badge, an enabled Create
// button, an icon-only refresh, and a table with WORKSPACE ID /
// CREATED AT / METADATA / CONFIGURATION columns (empty metadata renders
// "None", empty configuration "{}" — as in the cloud screenshot).
export function ExplorePage() {
  const { api } = useConnection()
  const { data, error, loading, reload } = useAsyncData(
    async () => {
      if (!api) return null
      return api.listWorkspaces()
    },
    [api],
  )

  const [showCreate, setShowCreate] = useState(false)
  const [newId, setNewId] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function createWorkspace() {
    if (!api) return
    const id = newId.trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 512) {
      setCreateError('Workspace id must match ^[a-zA-Z0-9_-]+$ (max 512 characters).')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      await api.createWorkspace(id)
      setShowCreate(false)
      setNewId('')
      reload()
      navigate({ name: 'workspace', workspaceId: id })
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'Create failed')
    }
    setCreating(false)
  }

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
            <button type="button" onClick={() => setShowCreate(true)} className={darkButtonClass}>
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
                    <td className="px-3 py-3 text-fog">{formatMetadataCell(workspace.metadata)}</td>
                    <td className="px-3 py-3 text-fog">{formatJsonCell(workspace.configuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}

      {showCreate ? (
        <Dialog title="Create Workspace" onClose={() => setShowCreate(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void createWorkspace()
            }}
          >
            <label className={dialogLabelClass} htmlFor="new-workspace-id">
              WORKSPACE ID
            </label>
            <input
              id="new-workspace-id"
              value={newId}
              onChange={(event) => setNewId(event.target.value)}
              placeholder="my_workspace"
              className={dialogInputClass}
              autoFocus
            />
            {createError ? (
              <div className="mt-3">
                <ErrorBox message={createError} />
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="submit" disabled={creating} className={primaryButtonClass}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  )
}
