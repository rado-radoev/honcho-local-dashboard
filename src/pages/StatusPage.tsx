import { CheckCircle2, RefreshCw, Server, XCircle } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { PageHeader } from '../components/ui'

// Instance Status, mirroring the cloud page of the same name ("Monitor your
// system status"): green checks for the API machine and the deriver
// machine, the Honcho version, and — the locally available extra — the
// deriver queue per workspace. There is no dedicated deriver health
// endpoint locally, so the Deriver Machine row is derived from the
// verified queue/status endpoint: if it responds for a workspace, the
// deriver side of the instance is answering, so the row reads Active.
export function StatusPage() {
  const { api, health, refreshHealth } = useConnection()

  const version = useAsyncData(
    async () => (api ? api.serverVersion() : null),
    [api],
  )

  const workspaces = useAsyncData(
    async () => (api ? api.listWorkspaces(1, 50) : null),
    [api],
  )

  const apiActive = health === 'connected'

  return (
    <div>
      <PageHeader
        icon={<Server className="h-6 w-6" />}
        title="Instance Status"
        subtitle="Monitor your system status"
      />

      <div className="flex flex-col gap-4 text-base">
        <div className="flex items-center gap-3">
          {apiActive ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          <span className="text-mist">API Machine</span>
          <span className={apiActive ? 'font-semibold text-green-500' : 'font-semibold text-red-500'}>
            {apiActive ? 'Active' : 'Unreachable'}
          </span>
        </div>

        <DeriverMachineRow
          firstWorkspaceId={workspaces.data?.items[0]?.id ?? null}
          workspacesLoaded={workspaces.data !== null}
        />

        {version.data ? (
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-blue-400" />
            <span className="text-mist">Honcho Version</span>
            <span className="font-semibold text-blue-400">{version.data}</span>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void refreshHealth()}
        className="mt-5 flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm text-mist hover:bg-panel-raise"
      >
        <RefreshCw className="h-4 w-4" /> Refresh
      </button>

      {workspaces.data && workspaces.data.items.length > 0 ? (
        <section className="mt-10" aria-label="Deriver queue">
          <h2 className="mb-3 text-sm tracking-widest text-fog">DERIVER QUEUE BY WORKSPACE</h2>
          <div className="flex flex-col gap-3">
            {workspaces.data.items.map((workspace) => (
              <QueueRow key={workspace.uid} workspaceId={workspace.id} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

// The cloud status page's "Deriver Machine" row. Locally the honest signal
// is the queue/status endpoint (it reports the deriver's work units): a
// successful response for the first workspace means Active; an error means
// Unreachable; while the probe is in flight the row reads Checking.
function DeriverMachineRow({
  firstWorkspaceId,
  workspacesLoaded,
}: {
  firstWorkspaceId: string | null
  workspacesLoaded: boolean
}) {
  const { api } = useConnection()
  const { data, error, loading } = useAsyncData(
    async () => {
      if (!api || !firstWorkspaceId) return null
      return api.getQueueStatus(firstWorkspaceId)
    },
    [api, firstWorkspaceId],
  )

  let label = 'Checking…'
  let labelClass = 'font-semibold text-fog'
  let icon = <Server className="h-5 w-5 text-fog" />
  if (data) {
    label = 'Active'
    labelClass = 'font-semibold text-green-500'
    icon = <CheckCircle2 className="h-5 w-5 text-green-500" />
  } else if (error || (workspacesLoaded && !loading && !firstWorkspaceId)) {
    label = 'Unreachable'
    labelClass = 'font-semibold text-red-500'
    icon = <XCircle className="h-5 w-5 text-red-500" />
  }

  return (
    <div className="flex items-center gap-3">
      {icon}
      <span className="text-mist">Deriver Machine</span>
      <span className={labelClass}>{label}</span>
    </div>
  )
}

function QueueRow({ workspaceId }: { workspaceId: string }) {
  const { api } = useConnection()
  const { data, error } = useAsyncData(
    async () => (api ? api.getQueueStatus(workspaceId) : null),
    [api, workspaceId],
  )

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-line bg-panel px-4 py-3 text-sm">
      <span className="font-semibold text-mist">{workspaceId}</span>
      {error ? <span className="text-red-300">queue unavailable</span> : null}
      {data ? (
        <>
          <span className="text-fog">
            total <span className="text-mist">{data.total_work_units}</span>
          </span>
          <span className="text-fog">
            completed <span className="text-mist">{data.completed_work_units}</span>
          </span>
          <span className="text-fog">
            in progress <span className="text-mist">{data.in_progress_work_units}</span>
          </span>
          <span className="text-fog">
            pending <span className="text-mist">{data.pending_work_units}</span>
          </span>
        </>
      ) : null}
    </div>
  )
}
