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
  // When this collector started recording (epoch ms; 0 for pure aggregates).
  startedAt: number
  // True once the ring buffer has wrapped and old records were dropped.
  ringCapped: boolean
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
    startedAt: 0,
    ringCapped: false,
  }
}

// Ring cap: the collector keeps at most this many records so a long-lived
// dashboard session cannot grow memory without bound.
export const STATS_RING_CAP = 1000

export class StatsCollector {
  private records: PerfRecord[] = []
  private readonly startedAt: number
  private dropped = 0

  constructor(startedAt: number = Date.now()) {
    this.startedAt = startedAt
  }

  private push(record: PerfRecord): void {
    this.records.push(record)
    if (this.records.length > STATS_RING_CAP) {
      this.records.splice(0, this.records.length - STATS_RING_CAP)
      this.dropped += 1
    }
  }

  record(method: string, path: string, status: number, durationMs: number): void {
    this.push({ method, label: endpointLabel(method, path), status, durationMs })
  }

  recordLabel(label: string, status: number, durationMs: number): void {
    const method = label.split(' ')[0] ?? 'GET'
    this.push({ method, label, status, durationMs })
  }

  snapshot(): PerformanceStats {
    return {
      ...aggregateStats(this.records),
      startedAt: this.startedAt,
      ringCapped: this.dropped > 0,
    }
  }

  clear(): void {
    this.records = []
    this.dropped = 0
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
