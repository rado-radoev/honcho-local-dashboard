import { useEffect, useState } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'
import { useConnection } from '../state/connection'
import { PageHeader, TableHead } from '../components/ui'
import type { PerformanceStats } from '../lib/stats'

// Performance — mirrors the cloud page's tables, but honestly sourced:
// the self-hosted API exposes no metrics endpoint, so these numbers are
// measured from this dashboard's own API requests since connect
// (HonchoClient's stats collector; the demo client seeds the cloud
// screenshot's shape). Polls its snapshot every ~2s while open.
export function PerformancePage() {
  const { api } = useConnection()
  const [stats, setStats] = useState<PerformanceStats | null>(null)

  useEffect(() => {
    if (!api) return
    function snapshot() {
      if (api) setStats(api.getPerformanceStats())
    }
    snapshot()
    const timer = setInterval(snapshot, 2000)
    return () => clearInterval(timer)
  }, [api])

  const total = stats?.totalCalls ?? 0
  const average = stats?.averageMs ?? 0

  return (
    <div>
      <PageHeader
        icon={<BarChart3 className="h-6 w-6" />}
        title="Performance"
        subtitle="Monitor your API performance metrics and usage analytics"
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="rounded bg-badge px-2.5 py-1 text-sm font-semibold text-badge-ink">Live</span>
        <span className="text-sm text-fog">metrics</span>
        <span className="rounded-md border border-line px-2.5 py-1 text-sm text-mist">
          {total} calls
        </span>
        <span className="rounded-md border border-line px-2.5 py-1 text-sm text-mist">
          {average.toFixed(2)} ms avg
        </span>
        <button
          type="button"
          onClick={() => {
            if (api) setStats(api.getPerformanceStats())
          }}
          className="ml-auto flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm text-mist hover:bg-panel-raise"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      <p className="mb-8 text-xs text-fog">
        Measured from this dashboard&apos;s own requests since connect — the self-hosted API
        exposes no server-side metrics.
      </p>

      <section aria-label="Request Volume" className="mb-10">
        <h2 className="font-display mb-3 text-base font-bold text-mist">Request Volume</h2>
        <table className="w-full border-collapse text-sm">
          <TableHead columns={['METRIC', 'VALUE']} />
          <tbody>
            <tr className="border-b border-line">
              <td className="px-3 py-3 text-mist">Total API Calls</td>
              <td className="px-3 py-3 text-fog">{total}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-label="Response Time" className="mb-10">
        <h2 className="font-display mb-3 text-base font-bold text-mist">Response Time</h2>
        <table className="w-full border-collapse text-sm">
          <TableHead columns={['METRIC', 'VALUE']} />
          <tbody>
            <tr className="border-b border-line">
              <td className="px-3 py-3 text-mist">Average Response Time</td>
              <td className="px-3 py-3 text-fog">{average.toFixed(2)} ms</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-label="Endpoint Usage">
        <h2 className="font-display mb-3 text-base font-bold text-mist">Endpoint Usage</h2>
        <table className="w-full border-collapse text-sm">
          <TableHead columns={['ENDPOINT', 'STATUS', 'CALLS']} />
          <tbody>
            {(stats?.endpoints ?? []).map((endpoint) => (
              <tr key={endpoint.label} className="border-b border-line">
                <td className="px-3 py-3 text-mist">{endpoint.label}</td>
                <td className="px-3 py-3">
                  <span
                    className={
                      endpoint.lastStatus >= 200 && endpoint.lastStatus < 300
                        ? 'rounded border border-green-800 bg-green-950 px-2 py-0.5 text-xs text-green-300'
                        : 'rounded border border-red-900 bg-red-950 px-2 py-0.5 text-xs text-red-300'
                    }
                  >
                    {endpoint.lastStatus}
                  </span>
                </td>
                <td className="px-3 py-3 text-fog">{endpoint.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats && stats.endpoints.length === 0 ? (
          <p className="mt-3 text-sm text-fog">No API calls measured yet in this session.</p>
        ) : null}
      </section>
    </div>
  )
}
