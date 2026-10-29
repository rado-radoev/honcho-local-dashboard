import { LogOut, Settings } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { PageHeader } from '../components/ui'

// Settings — deliberately only what is real locally: the current
// connection (server, route requests actually take, mode), the server
// version from /openapi.json, and Disconnect. Auth state is reported
// honestly: the dashboard knows whether IT sends a token, but cannot
// know whether the server requires one, so that is stated, not invented.
export function SettingsPage() {
  const { api, mode, baseUrl, routeDescription, health, disconnect } = useConnection()
  const version = useAsyncData(async () => (api ? api.serverVersion() : null), [api])

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Mode', value: mode === 'demo' ? 'Demo (bundled fixtures, no server)' : 'Live server' },
    { label: 'Server URL', value: mode === 'demo' ? '— (demo)' : baseUrl },
    { label: 'Request route', value: routeDescription ?? '—' },
    { label: 'Health', value: health },
    { label: 'Server version (from /openapi.json)', value: version.data ?? 'unknown' },
    {
      label: 'Authentication',
      value:
        'This dashboard sends a Bearer token only if one was entered on the connect screen. Whether the server requires auth (AUTH_USE_AUTH) cannot be detected from the API — check your server configuration.',
    },
  ]

  return (
    <div>
      <PageHeader
        icon={<Settings className="h-6 w-6" />}
        title="Settings"
        subtitle="Connection details for this dashboard"
      />
      <div className="max-w-2xl rounded-md border border-line bg-panel p-5">
        <dl className="flex flex-col gap-4">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs tracking-widest text-fog">{row.label.toUpperCase()}</dt>
              <dd className="mt-1 break-words text-sm text-mist">{row.value}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={disconnect}
          className="mt-6 flex items-center gap-2 rounded-md border border-line px-4 py-2.5 text-sm text-mist hover:bg-panel-raise"
        >
          <LogOut className="h-4 w-4" /> {mode === 'demo' ? 'Exit Demo' : 'Disconnect'}
        </button>
      </div>
    </div>
  )
}
