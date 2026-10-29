import { useMemo } from 'react'
import { AlertTriangle, ArrowRight, ShieldCheck, Unlink } from 'lucide-react'
import type { Conclusion } from '../types'
import { LEVEL_COLORS } from '../lib/conclusions'
import { formatDateTime } from '../lib/format'
import { clusterFaultLines, type FaultCluster, type FaultLink } from '../lib/faultLines'

// Fault Lines (Phase C1): every level=contradiction conclusion in
// the fetched set, clustered by discoverable source linkage (see
// lib/faultLines.ts). Cluster members render SIDE BY SIDE so the
// conflicting statements can be read against each other; each
// cluster (and the Unlinked group) can jump to the Conclusions
// Explorer filtered to exactly those ids. Contradictions with no
// linkage are shown honestly as Unlinked — never force-matched.

function signalLabel(link: FaultLink): string {
  const parts: string[] = []
  if (link.signals.includes('direct-reference')) parts.push('one derives from the other')
  if (link.signals.includes('shared-source')) parts.push('shared source conclusion')
  if (link.signals.includes('shared-message')) parts.push('shared source message')
  let label = parts.join(' · ')
  if (link.sharedIds.length > 0) label += `: ${link.sharedIds.join(', ')}`
  return label
}

function ConclusionCard({ conclusion }: { conclusion: Conclusion }) {
  return (
    <div
      className="min-w-0 flex-1 rounded-md border border-line bg-panel-raise px-3 py-2.5"
      data-testid="fault-card"
      data-conclusion-id={conclusion.id}
    >
      <p className="text-sm leading-relaxed text-mist">{conclusion.content}</p>
      <p className="mt-2 text-xs text-fog">
        {conclusion.observer_id} → {conclusion.observed_id} ·{' '}
        {formatDateTime(conclusion.created_at)}
      </p>
      <p className="mt-0.5 text-[11px] text-fog">
        <span style={{ color: LEVEL_COLORS[conclusion.level] }}>contradiction</span>
        {' · derived ×'}
        {conclusion.times_derived}
        {conclusion.session_id ? ` · ${conclusion.session_id}` : ''}
      </p>
    </div>
  )
}

function ExplorerJump({
  ids,
  label,
  onOpenInExplorer,
}: {
  ids: string[]
  label: string
  onOpenInExplorer: (ids: string[]) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenInExplorer(ids)}
      className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-mist hover:bg-panel-raise"
    >
      {label} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  )
}

function ClusterBlock({
  cluster,
  onOpenInExplorer,
}: {
  cluster: FaultCluster
  onOpenInExplorer: (ids: string[]) => void
}) {
  const memberIds = cluster.members.map((member) => member.id)
  return (
    <section
      className="rounded-md border border-red-900/60 bg-red-950/10 p-3"
      data-testid="fault-cluster"
      data-cluster-id={cluster.id}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#FF7A7A]">
          <AlertTriangle className="h-4 w-4" /> Linked contradictions · {cluster.members.length}
        </h3>
        <span className="text-[11px] text-fog">
          {cluster.links.map((link) => signalLabel(link)).join(' | ')}
        </span>
        <span className="ml-auto">
          <ExplorerJump
            ids={memberIds}
            label="Open in Conclusions Explorer"
            onOpenInExplorer={onOpenInExplorer}
          />
        </span>
      </div>
      {/* Side by side: the conflicting statements in one row (wrapping
          to a column only on narrow widths). */}
      <div className="flex flex-wrap gap-2">
        {cluster.members.map((member) => (
          <ConclusionCard key={member.id} conclusion={member} />
        ))}
      </div>
    </section>
  )
}

export function FaultLinesPanel({
  conclusions,
  onOpenInExplorer,
}: {
  conclusions: Conclusion[]
  onOpenInExplorer: (ids: string[]) => void
}) {
  const result = useMemo(() => clusterFaultLines(conclusions), [conclusions])

  if (result.contradictions.length === 0) {
    return (
      <div className="p-6" data-testid="fault-lines">
        <div
          className="flex items-start gap-3 rounded-md border border-line bg-panel px-4 py-4"
          data-testid="fault-lines-empty"
        >
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fog" />
          <div>
            <p className="text-sm font-semibold text-mist">Memory is coherent</p>
            <p className="mt-1 text-sm leading-relaxed text-fog">
              No contradictions in this workspace&apos;s fetched conclusions — nothing here
              currently disagrees with itself.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-h-[560px] overflow-y-auto p-4" data-testid="fault-lines">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm tracking-widest text-fog">FAULT LINES</h2>
        <span className="text-xs text-fog">
          {result.contradictions.length} contradiction
          {result.contradictions.length === 1 ? '' : 's'} · {result.clusters.length} linked
          cluster{result.clusters.length === 1 ? '' : 's'} · {result.unlinked.length} unlinked
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {result.clusters.map((cluster) => (
          <ClusterBlock key={cluster.id} cluster={cluster} onOpenInExplorer={onOpenInExplorer} />
        ))}
      </div>

      {result.unlinked.length > 0 ? (
        <section className="mt-3 rounded-md border border-line p-3" data-testid="fault-unlinked">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-mist">
              <Unlink className="h-4 w-4 text-fog" /> Unlinked · {result.unlinked.length}
            </h3>
            <span className="text-[11px] text-fog">
              no shared sources or cross-references found — listed honestly, not force-matched
            </span>
            <span className="ml-auto">
              <ExplorerJump
                ids={result.unlinked.map((item) => item.id)}
                label="Open in Conclusions Explorer"
                onOpenInExplorer={onOpenInExplorer}
              />
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {result.unlinked.map((item) => (
              <ConclusionCard key={item.id} conclusion={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
