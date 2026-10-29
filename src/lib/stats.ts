// Performance stats measured from THIS dashboard's own API traffic.
// The self-hosted Honcho API exposes no server-side metrics endpoint, so
// HonchoClient records every request it makes here and the Performance
// page aggregates those records. Shared module (not a component) so both
// the live client and the demo client can feed / read the same shape.

export interface PerfRecord {
  method: string
  // Label like "GET session" / "POST workspace" (method + singular noun).
  label: string
  status: number
  durationMs: number
}

export interface EndpointStat {
  label: string
  lastStatus: number
  calls: number
}

export interface PerformanceStats {
  totalCalls: number
  averageMs: number
  endpoints: EndpointStat[]
}

const RESOURCE_NOUNS: Record<string, string> = {
  workspaces: 'workspace',
  peers: 'peer',
  sessions: 'session',
  messages: 'message',
  conclusions: 'conclusion',
  webhooks: 'webhook',
  keys: 'key',
  scopes: 'scope',
  health: 'health',
}

// Derive the cloud-style endpoint label ("GET session", "POST message")
// from a request path: the LAST known resource segment wins, so
// /v3/workspaces/{id}/sessions/{id}/messages/list -> "message", and
// /health -> "health". Trailing verbs (list/status/...) are not resources.
export function endpointLabel(method: string, path: string): string {
  const clean = path.split('?')[0]
  const segments = clean.split('/').filter((segment) => segment.length > 0)
  let noun = 'request'
  for (const segment of segments) {
    const found = RESOURCE_NOUNS[segment]
    if (found) noun = found
  }
  if (segments.includes('health')) noun = 'health'
  if (segments.includes('openapi.json')) noun = 'openapi'
  if (segments.includes('queue')) noun = 'queue'
  return `${method.toUpperCase()} ${noun}`
}

export function aggregateStats(records: PerfRecord[]): PerformanceStats {
  const totalCalls = records.length
  let totalMs = 0
  const byLabel = new Map<string, EndpointStat>()
  for (const record of records) {
    totalMs += record.durationMs
    const existing = byLabel.get(record.label)
    if (existing) {
      existing.calls += 1
      existing.lastStatus = record.status
    } else {
      byLabel.set(record.label, { label: record.label, lastStatus: record.status, calls: 1 })
    }
  }
  const endpoints = [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label))
  return {
    totalCalls,
    averageMs: totalCalls === 0 ? 0 : totalMs / totalCalls,
    endpoints,
  }
}

export class StatsCollector {
  private records: PerfRecord[] = []

  record(method: string, path: string, status: number, durationMs: number): void {
    this.records.push({ method, label: endpointLabel(method, path), status, durationMs })
  }

  recordLabel(label: string, status: number, durationMs: number): void {
    const method = label.split(' ')[0] ?? 'GET'
    this.records.push({ method, label, status, durationMs })
  }

  snapshot(): PerformanceStats {
    return aggregateStats(this.records)
  }

  clear(): void {
    this.records = []
  }
}

// Demo seed matching the cloud Performance screenshot shape: 41 calls,
// 541.51 ms average, five endpoint rows. Every seeded call uses exactly
// the average duration so the aggregate average is exactly 541.51.
export function seedDemoStats(collector: StatsCollector): void {
  const rows: Array<{ label: string; calls: number }> = [
    { label: 'GET session', calls: 4 },
    { label: 'POST message', calls: 6 },
    { label: 'POST peer', calls: 9 },
    { label: 'POST session', calls: 14 },
    { label: 'POST workspace', calls: 8 },
  ]
  for (const row of rows) {
    for (let index = 0; index < row.calls; index += 1) {
      collector.recordLabel(row.label, 200, 541.51)
    }
  }
}
