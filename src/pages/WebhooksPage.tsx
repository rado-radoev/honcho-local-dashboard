import { useEffect, useState } from 'react'
import { Plus, Trash2, Webhook } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { formatDateTime } from '../lib/format'
import { EmptyState, ErrorBox, PageHeader, RefreshButton, Spinner, TableHead } from '../components/ui'
import { dialogInputClass, primaryButtonClass } from '../components/Dialog'

// Webhooks — real local page: pick a workspace, list its webhook
// endpoints (GET /v3/workspaces/{id}/webhooks), create (POST {url}) and
// delete (DELETE .../webhooks/{endpointId}, with confirmation).
export function WebhooksPage() {
  const { api } = useConnection()
  const workspaces = useAsyncData(
    async () => (api ? api.listWorkspaces(1, 50) : null),
    [api],
  )
  const [workspaceId, setWorkspaceId] = useState<string>('')

  useEffect(() => {
    const first = workspaces.data?.items[0]?.id
    if (!workspaceId && first) setWorkspaceId(first)
  }, [workspaces.data, workspaceId])

  const webhooks = useAsyncData(
    async () => {
      if (!api || !workspaceId) return null
      return api.listWebhooks(workspaceId)
    },
    [api, workspaceId],
  )

  const [newUrl, setNewUrl] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function createWebhook() {
    if (!api || !workspaceId || newUrl.trim().length === 0) return
    setCreating(true)
    setActionError(null)
    try {
      await api.createWebhook(workspaceId, newUrl.trim())
      setNewUrl('')
      webhooks.reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Create failed')
    }
    setCreating(false)
  }

  async function deleteWebhook(endpointId: string) {
    if (!api || !workspaceId) return
    const confirmed = window.confirm(`Delete webhook endpoint ${endpointId}?`)
    if (!confirmed) return
    setActionError(null)
    try {
      await api.deleteWebhook(workspaceId, endpointId)
      webhooks.reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Delete failed')
    }
  }

  return (
    <div>
      <PageHeader
        icon={<Webhook className="h-6 w-6" />}
        title="Webhooks"
        subtitle="Manage your webhook endpoints. Each webhook is scoped to a specific workspace."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="text-xs tracking-widest text-fog" htmlFor="webhook-workspace">
          WORKSPACE
        </label>
        <select
          id="webhook-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-mist outline-none"
        >
          {(workspaces.data?.items ?? []).map((workspace) => (
            <option key={workspace.uid} value={workspace.id}>
              {workspace.id}
            </option>
          ))}
        </select>
        <RefreshButton onRefresh={webhooks.reload} spinning={webhooks.loading} />
      </div>

      <form
        className="mb-6 flex max-w-xl gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void createWebhook()
        }}
      >
        <input
          value={newUrl}
          onChange={(event) => setNewUrl(event.target.value)}
          placeholder="https://example.com/honcho-hook"
          aria-label="New webhook URL"
          className={dialogInputClass}
        />
        <button type="submit" disabled={creating} className={`${primaryButtonClass} shrink-0`}>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Plus className="h-4 w-4" /> {creating ? 'Creating…' : 'New Webhook'}
          </span>
        </button>
      </form>

      {workspaces.error ? <ErrorBox message={workspaces.error} /> : null}
      {webhooks.error ? <ErrorBox message={webhooks.error} /> : null}
      {actionError ? (
        <div className="mb-4">
          <ErrorBox message={actionError} />
        </div>
      ) : null}
      {webhooks.loading && !webhooks.data ? <Spinner label="Loading webhooks…" /> : null}

      {webhooks.data ? (
        webhooks.data.items.length === 0 ? (
          <EmptyState>
            No webhooks configured. Create your first webhook to begin receiving events from Honcho.
          </EmptyState>
        ) : (
          <table className="w-full border-collapse text-sm">
            <TableHead columns={['ID', 'URL', 'CREATED AT', 'ACTIONS']} />
            <tbody>
              {webhooks.data.items.map((endpoint) => (
                <tr key={endpoint.id} className="border-b border-line">
                  <td className="px-3 py-3 text-mist">{endpoint.id}</td>
                  <td className="px-3 py-3 text-fog">{endpoint.url}</td>
                  <td className="px-3 py-3 text-fog">{formatDateTime(endpoint.created_at)}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      title={`Delete webhook ${endpoint.id}`}
                      onClick={() => void deleteWebhook(endpoint.id)}
                      className="rounded-md p-1.5 text-fog hover:bg-panel-raise hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  )
}
