import { useState } from 'react'
import { Loader2, LogOut, Save, Settings } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { navigate } from '../lib/routing'
import { ErrorBox, PageHeader } from '../components/ui'

// Settings — deliberately only what is real locally: an editable
// connection (server URL + token, validated against the NEW server
// before anything switches), the current connection details (route
// requests actually take, mode, server version from /openapi.json), and
// Disconnect. Auth state is reported honestly: the dashboard knows
// whether IT sends a token, but cannot know whether the server requires
// one, so that is stated, not invented.

// Editable Honcho server URL + API token. Saving health-checks the new
// server first (through the same proxy/direct machinery as every other
// request): on failure the error — including the tried route — is shown
// here and the current connection stays exactly as it was; on success
// the provider has already persisted and swapped, and we land on the
// Overview page in the new connected state. In demo mode the fields are
// disabled: demo runs on bundled fixtures, there is no server to point
// at (exit demo via Disconnect to connect to a real one).
function ConnectionForm() {
  const { mode, baseUrl, token, updateConnection } = useConnection()
  const isDemo = mode === 'demo'
  const [url, setUrl] = useState(isDemo ? '' : baseUrl)
  const [tokenInput, setTokenInput] = useState(isDemo ? '' : token)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const result = await updateConnection(url, tokenInput)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate({ name: 'get-started' })
  }

  const saveDisabled = isDemo || saving || url.trim().length === 0

  let saveLabel = 'Save & Connect'
  if (saving) saveLabel = 'Checking new server…'

  return (
    <div className="max-w-2xl rounded-md border border-line bg-panel p-5">
      <div className="text-xs tracking-widest text-fog">HONCHO SERVER URL</div>
      <input
        id="settings-base-url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="http://localhost:8000"
        disabled={isDemo}
        className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-mist outline-none focus:border-fog disabled:opacity-50"
      />

      <div className="mt-4 text-xs tracking-widest text-fog">API TOKEN (OPTIONAL)</div>
      <input
        id="settings-token"
        type="password"
        value={tokenInput}
        onChange={(event) => setTokenInput(event.target.value)}
        placeholder="Only needed when AUTH_USE_AUTH=true"
        disabled={isDemo}
        className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-mist outline-none focus:border-fog disabled:opacity-50"
      />

      {isDemo ? (
        <p className="mt-3 text-sm text-fog">
          Demo mode uses bundled fixture data — there is no server to change. Disconnect to exit
          demo and connect to a real server.
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorBox message={`New server not saved — the current connection is unchanged. ${error}`} />
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={saveDisabled}
        className="mt-5 flex items-center gap-2 rounded-md bg-badge px-4 py-2.5 text-sm font-semibold text-badge-ink hover:brightness-110 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saveLabel}
      </button>
    </div>
  )
}

export function SettingsPage() {
  const { api, mode, routeDescription, health, disconnect } = useConnection()
  const version = useAsyncData(async () => (api ? api.serverVersion() : null), [api])

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Mode', value: mode === 'demo' ? 'Demo (bundled fixtures, no server)' : 'Live server' },
    { label: 'Request route', value: routeDescription ?? '—' },
    { label: 'Health', value: health },
    { label: 'Server version (from /openapi.json)', value: version.data ?? 'unknown' },
    {
      label: 'Authentication',
      value:
        'This dashboard sends a Bearer token only if one was entered in the connection form above (or on the connect screen). Whether the server requires auth (AUTH_USE_AUTH) cannot be detected from the API — check your server configuration.',
    },
  ]

  return (
    <div>
      <PageHeader
        icon={<Settings className="h-6 w-6" />}
        title="Settings"
        subtitle="Connection details for this dashboard"
      />
      <ConnectionForm />
      <div className="mt-6 max-w-2xl rounded-md border border-line bg-panel p-5">
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
