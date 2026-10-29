import { useState } from 'react'
import { FlaskConical, Loader2, Server } from 'lucide-react'
import { DEFAULT_BASE_URL, useConnection } from '../state/connection'
import { ErrorBox } from './ui'

// First screen when no connection is saved: point the dashboard at a
// self-hosted Honcho server (base URL + optional token), or explore with
// bundled demo data. The health check result shows immediately — a green
// state once GET /health answers {"status":"ok"}.
export function ConnectScreen() {
  const { connect, startDemo, health, healthError } = useConnection()
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [token, setToken] = useState('')
  const [attempted, setAttempted] = useState(false)

  async function handleConnect() {
    setAttempted(true)
    await connect(baseUrl, token)
  }

  const showStatus = attempted && health !== 'unknown'

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel p-8">
        <div className="text-2xl font-bold tracking-widest text-mist">HONCHO</div>
        <div className="mt-0.5 text-[11px] tracking-widest text-fog">LOCAL DASHBOARD</div>

        <p className="mt-5 text-sm leading-relaxed text-fog">
          Connect to your self-hosted Honcho instance to browse workspaces, peers, sessions,
          conclusions, and memory — the local counterpart of the cloud dashboard.
        </p>

        <label className="mt-6 block text-xs tracking-widest text-fog" htmlFor="base-url">
          HONCHO SERVER URL
        </label>
        <input
          id="base-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://localhost:8000"
          className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-mist outline-none focus:border-fog"
        />

        <label className="mt-4 block text-xs tracking-widest text-fog" htmlFor="token">
          API TOKEN / JWT (OPTIONAL)
        </label>
        <input
          id="token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Only needed when AUTH_USE_AUTH=true"
          className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-mist outline-none focus:border-fog"
        />

        {showStatus && health === 'checking' ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-fog">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking {baseUrl} …
          </div>
        ) : null}
        {showStatus && health === 'failed' && healthError ? (
          <div className="mt-4">
            <ErrorBox message={healthError} />
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleConnect}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-badge px-4 py-2.5 text-sm font-semibold text-badge-ink hover:brightness-110"
        >
          <Server className="h-4 w-4" /> Connect
        </button>

        <div className="my-5 flex items-center gap-3 text-[11px] tracking-widest text-fog">
          <span className="h-px flex-1 bg-line" /> OR <span className="h-px flex-1 bg-line" />
        </div>

        <button
          type="button"
          onClick={startDemo}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-line px-4 py-2.5 text-sm text-mist hover:bg-panel-raise"
        >
          <FlaskConical className="h-4 w-4" /> Explore demo data
        </button>
        <p className="mt-2 text-center text-xs text-fog">
          No server needed — bundled sample workspaces, peers, and sessions.
        </p>
      </div>
    </div>
  )
}
