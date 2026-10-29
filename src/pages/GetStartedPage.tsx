import { Layers, Rocket, Server } from 'lucide-react'
import { useConnection } from '../state/connection'
import { navigate } from '../lib/routing'
import { ErrorBox, PageHeader } from '../components/ui'

// "Get Started" — the local counterpart of the cloud Welcome page:
// connection summary, what this dashboard can do, and the first steps.
export function GetStartedPage() {
  const { mode, baseUrl, routeDescription, health, healthError } = useConnection()

  let statusText = 'Checking…'
  if (health === 'connected') statusText = 'Connected'
  if (health === 'failed') statusText = 'Connection failed'

  return (
    <div>
      <PageHeader
        icon={<Rocket className="h-6 w-6" />}
        title="Get Started"
        subtitle="Welcome to your local Honcho dashboard"
      />

      {health === 'failed' && healthError ? (
        <div className="mb-6">
          <ErrorBox message={healthError} />
        </div>
      ) : null}

      <section className="mb-8 rounded-md border border-line bg-panel p-5">
        <h2 className="flex items-center gap-2 text-sm tracking-widest text-fog">
          <Server className="h-4 w-4" /> CONNECTION
        </h2>
        <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
          <dt className="text-fog">Server</dt>
          <dd className="text-mist">{mode === 'demo' ? 'Demo data (no server)' : baseUrl}</dd>
          {routeDescription ? (
            <>
              <dt className="text-fog">Route</dt>
              <dd className="text-mist">{routeDescription}</dd>
            </>
          ) : null}
          <dt className="text-fog">Status</dt>
          <dd className="text-mist">{statusText}</dd>
          <dt className="text-fog">Mode</dt>
          <dd className="text-mist">Read-only — this dashboard never writes to Honcho</dd>
        </dl>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate({ name: 'explore' })}
          className="rounded-md border border-line bg-panel p-5 text-left hover:bg-panel-raise"
        >
          <h3 className="flex items-center gap-2 text-base font-semibold text-mist">
            <Layers className="h-5 w-5" /> Explore your memory
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-fog">
            Browse workspaces, then drill into peers and sessions: peer cards, representations,
            conclusions, message history, search, and chat — the same flow as the cloud
            dashboard&apos;s Explore pages.
          </p>
        </button>

        <div className="rounded-md border border-line bg-panel p-5">
          <h3 className="text-base font-semibold text-mist">Point Hermes at this instance</h3>
          <p className="mt-2 text-sm leading-relaxed text-fog">
            On the machine running Hermes Agent:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-ink p-3 text-xs leading-relaxed text-mist">
            {`hermes plugins install honcho
hermes memory setup honcho   # choose "local"
hermes honcho status`}
          </pre>
        </div>
      </section>
    </div>
  )
}
