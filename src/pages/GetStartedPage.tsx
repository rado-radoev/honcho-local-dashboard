import { Layers, Rocket, Server } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { navigate } from '../lib/routing'
import { formatDateTime } from '../lib/format'
import { ErrorBox, PageHeader, Spinner } from '../components/ui'
import { CountUp, GrowthChart, Heatmap } from '../components/charts'
import { buildGrowthSeries, buildHeatmap } from '../lib/charts'
import {
  ACCENT_GRADIENT,
  CONCLUSION_LEVELS,
  LEVEL_COLORS,
  cappedLabel,
} from '../lib/conclusions'
import type { Conclusion, ConclusionLevel } from '../types'

// Get Started = the Overview hub (Round 3): instance-wide stat tiles,
// memory growth + activity charts from the capped conclusions set, a
// Recent Memories feed, and the connection summary. Counts come from
// size=1 Page.total calls — there is deliberately NO global message
// total (no honest cheap source for one).

interface OverviewData {
  workspaces: number
  peers: number
  sessions: number
  conclusions: number
  byLevel: Record<ConclusionLevel, number>
  capped: { items: Conclusion[]; total: number; capped: boolean }
  recent: Array<{ conclusion: Conclusion; workspaceId: string }>
  queuePending: number
  queueInProgress: number
  version: string | null
}

export function GetStartedPage() {
  const { api, mode, baseUrl, health, healthError } = useConnection()

  const overview = useAsyncData<OverviewData | null>(async () => {
    if (!api) return null
    const workspacePage = await api.listWorkspaces(1, 50)
    const byLevel = {
      explicit: 0,
      deductive: 0,
      inductive: 0,
      contradiction: 0,
    } as Record<ConclusionLevel, number>
    let peers = 0
    let sessions = 0
    let conclusions = 0
    const cappedItems: Conclusion[] = []
    const recent: Array<{ conclusion: Conclusion; workspaceId: string }> = []
    let cappedTotal = 0
    let anyCapped = false
    for (const workspace of workspacePage.items) {
      const counts = await api.getWorkspaceCounts(workspace.id)
      peers += counts.peers
      sessions += counts.sessions
      conclusions += counts.conclusions
      for (const level of CONCLUSION_LEVELS) byLevel[level] += counts.byLevel[level]
      const capped = await api.fetchConclusionsCapped(workspace.id)
      cappedItems.push(...capped.items)
      cappedTotal += capped.total
      if (capped.capped) anyCapped = true
      for (const conclusion of capped.items) {
        recent.push({ conclusion, workspaceId: workspace.id })
      }
    }
    recent.sort((a, b) => b.conclusion.created_at.localeCompare(a.conclusion.created_at))
    let queuePending = 0
    let queueInProgress = 0
    const first = workspacePage.items[0]
    if (first) {
      try {
        const queue = await api.getQueueStatus(first.id)
        queuePending = queue.pending_work_units
        queueInProgress = queue.in_progress_work_units
      } catch {
        queuePending = 0
        queueInProgress = 0
      }
    }
    const version = await api.serverVersion()
    return {
      workspaces: workspacePage.total,
      peers,
      sessions,
      conclusions,
      byLevel,
      capped: { items: cappedItems, total: cappedTotal, capped: anyCapped },
      recent: recent.slice(0, 8),
      queuePending,
      queueInProgress,
      version,
    }
  }, [api])

  let statusText = 'Checking…'
  if (health === 'connected') statusText = 'Connected'
  if (health === 'failed') statusText = 'Connection failed'
  const data = overview.data

  return (
    <div>
      <PageHeader
        icon={<Rocket className="h-6 w-6" />}
        title="Get Started"
        subtitle="Overview of this Honcho instance"
      />

      {health === 'failed' && healthError ? (
        <div className="mb-6">
          <ErrorBox message={healthError} />
        </div>
      ) : null}

      {/* Hero: one of only two blueprint-grid surfaces (the other is the
          memory-map canvas), with the accent gradient as its top rule. */}
      <section className="blueprint-bg relative mb-6 overflow-hidden rounded-[10px] border border-line bg-panel p-5">
        <div
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: ACCENT_GRADIENT }}
          aria-hidden="true"
        />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="flex items-center gap-2 text-mist">
            <span
              className={`h-2 w-2 rounded-full ${health === 'connected' ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-yellow-500'}`}
            />
            {statusText}
          </span>
          <span className="text-fog">
            Server{' '}
            <span className="text-mist">{mode === 'demo' ? 'Demo data (no server)' : baseUrl}</span>
          </span>
          <span className="text-fog">
            Honcho version <span className="text-mist">{data?.version ?? '—'}</span>
          </span>
          <span className="text-fog">
            Deriver queue{' '}
            <span className="text-mist">
              {data ? `${data.queuePending} pending · ${data.queueInProgress} in progress` : '—'}
            </span>
          </span>
        </div>
      </section>

      {overview.loading && !data ? <Spinner label="Loading overview…" /> : null}
      {overview.error ? (
        <div className="mb-6">
          <ErrorBox message={overview.error} />
        </div>
      ) : null}

      {data ? (
        <>
          <section
            className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Instance totals"
          >
            <StatTile label="WORKSPACES" value={data.workspaces} />
            <StatTile label="PEERS" value={data.peers} />
            <StatTile label="SESSIONS" value={data.sessions} />
            <div className="card-shell p-4">
              <div className="text-[11px] tracking-widest text-fog">CONCLUSIONS</div>
              <div className="mt-1 text-3xl font-semibold text-mist">
                <CountUp value={data.conclusions} />
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-fog">
                {CONCLUSION_LEVELS.map((level) => (
                  <li key={level} className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: LEVEL_COLORS[level] }}
                    />
                    <span className="capitalize">{level}</span>
                    <span className="ml-auto tabular-nums text-mist">{data.byLevel[level]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="mb-6 grid items-start gap-4 xl:grid-cols-2">
            <div className="card-shell p-5">
              <h2 className="mb-3 text-sm tracking-widest text-fog">MEMORY GROWTH</h2>
              <GrowthChart points={buildGrowthSeries(data.capped.items)} />
              {data.capped.capped ? (
                <p className="mt-2 text-xs text-fog">
                  Chart uses the {cappedLabel(data.capped)} conclusions.
                </p>
              ) : null}
            </div>
            <div className="card-shell p-5">
              <h2 className="mb-3 text-sm tracking-widest text-fog">
                MEMORY ACTIVITY — LAST 26 WEEKS
              </h2>
              <Heatmap data={buildHeatmap(data.capped.items)} />
            </div>
          </section>

          <section className="mb-8" aria-label="Recent memories">
            <h2 className="mb-3 text-sm tracking-widest text-fog">RECENT MEMORIES</h2>
            <div className="flex flex-col gap-2">
              {data.recent.map(({ conclusion, workspaceId }) => (
                <button
                  key={conclusion.id}
                  type="button"
                  onClick={() =>
                    navigate({
                      name: 'peer',
                      workspaceId,
                      peerId: conclusion.observed_id,
                      tab: 'conclusions',
                    })
                  }
                  className="card-shell flex items-start gap-3 px-4 py-3 text-left hover:bg-panel-raise"
                >
                  <span
                    className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: LEVEL_COLORS[conclusion.level] }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-mist">{conclusion.content}</span>
                    <span className="mt-0.5 block text-xs text-fog">
                      {conclusion.level} · about {conclusion.observed_id} · in{' '}
                      {conclusion.session_id ?? 'no session'} ·{' '}
                      {formatDateTime(conclusion.created_at)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-fog">
              Click a memory to open its peer; session pages are under Explore.
            </p>
          </section>
        </>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate({ name: 'explore' })}
          className="card-shell p-5 text-left hover:bg-panel-raise"
        >
          <h3 className="flex items-center gap-2 text-base font-semibold text-mist">
            <Layers className="h-5 w-5" /> Explore your memory
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-fog">
            Browse workspaces, then drill into peers and sessions: peer cards, representations,
            conclusions, message history, search, and chat.
          </p>
        </button>

        <div className="card-shell p-5">
          <h3 className="flex items-center gap-2 text-base font-semibold text-mist">
            <Server className="h-5 w-5" /> Point Hermes at this instance
          </h3>
          <pre className="mt-3 overflow-x-auto rounded bg-ink p-3 text-xs leading-relaxed text-mist">
            {`hermes plugins install honcho\nhermes memory setup honcho   # choose "local"\nhermes honcho status`}
          </pre>
        </div>
      </section>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-shell p-4">
      <div className="text-[11px] tracking-widest text-fog">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-mist">
        <CountUp value={value} />
      </div>
    </div>
  )
}
