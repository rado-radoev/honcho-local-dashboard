import { useEffect, useMemo, useRef, useState } from 'react'
import { List, Map as MapIcon, Network, Pause, Play } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { navigate } from '../lib/routing'
import { formatDateTime } from '../lib/format'
import { ErrorBox, PageHeader, Spinner } from '../components/ui'
import { ConstellationSvg, NetworkSvg } from '../components/MemoryMapCanvas'
import { GrowthChart } from '../components/charts'
import { buildGrowthSeries } from '../lib/charts'
import { CONCLUSION_LEVELS, LEVEL_COLORS, cappedLabel } from '../lib/conclusions'
import { MAP_HEIGHT, MAP_WIDTH, type DotLayout } from '../lib/memoryGraph'
import { isStillSearch } from '../lib/orbit'
import {
  EMPTY_STABLE_LAYOUT,
  advanceStableLayout,
  type StableLayoutState,
} from '../lib/stableLayout'
import type { Conclusion, ConclusionLevel } from '../types'

// Memory Map: per-workspace visual browser over the capped conclusions
// set. Constellation (default) rings conclusion dots around their
// observed peer; Network aggregates observer→observed edges. Layout is
// the deterministic lib — no force simulation. In Constellation mode
// the dots gently orbit their peer's hub (see lib/orbit.ts + the
// canvas rAF loop); the time scrubber only moves when the user drags
// it or presses Play.

function initialMotionEnabled(): boolean {
  if (typeof window === 'undefined') return true
  if (isStillSearch(window.location.search)) return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isStillMode(): boolean {
  if (typeof window === 'undefined') return false
  return isStillSearch(window.location.search)
}

export function MemoryMapPage({ workspaceId }: { workspaceId: string | null }) {
  const { api } = useConnection()
  const workspaces = useAsyncData(
    async () => (api ? api.listWorkspaces(1, 50) : null),
    [api],
  )
  const activeWorkspace = workspaceId ?? workspaces.data?.items[0]?.id ?? null

  const peers = useAsyncData(
    async () => (api && activeWorkspace ? api.listPeers(activeWorkspace, 1, 50) : null),
    [api, activeWorkspace],
  )
  const capped = useAsyncData(
    async () => (api && activeWorkspace ? api.fetchConclusionsCapped(activeWorkspace) : null),
    [api, activeWorkspace],
  )

  const [mode, setMode] = useState<'constellation' | 'network'>('constellation')
  const [view, setView] = useState<'map' | 'list'>('map')
  const [levels, setLevels] = useState<Set<ConclusionLevel>>(new Set(CONCLUSION_LEVELS))
  const [hiddenPeers, setHiddenPeers] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Conclusion | null>(null)
  const [hover, setHover] = useState<DotLayout | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  // Constellation orbit motion: in-memory only (never persisted), ON by
  // default unless prefers-reduced-motion or still mode (?still=1).
  const [still] = useState(isStillMode)
  const [motionOn, setMotionOn] = useState(initialMotionEnabled)
  const motion = motionOn && !still
  const playRef = useRef<number | null>(null)

  const all = useMemo(() => capped.data?.items ?? [], [capped.data])

  // Append-stable dot slots: advanced (purely) whenever the full
  // dataset changes, so a cache refresh that adds/removes conclusions
  // never renumbers the dots already on screen. Reset per workspace.
  // React's adjust-state-during-render pattern: when the dataset or
  // workspace changes, advance the stable layout before commit, so
  // the canvas never paints a renumbered frame.
  const [stable, setStable] = useState<{
    workspace: string | null
    dataset: Conclusion[] | null
    layout: StableLayoutState
  }>({ workspace: null, dataset: null, layout: EMPTY_STABLE_LAYOUT })
  if (stable.workspace !== activeWorkspace || stable.dataset !== all) {
    const base = stable.workspace === activeWorkspace ? stable.layout : EMPTY_STABLE_LAYOUT
    setStable({
      workspace: activeWorkspace,
      dataset: all,
      layout: advanceStableLayout(base, all),
    })
  }
  const stableSlots =
    stable.workspace === activeWorkspace ? stable.layout.slots : EMPTY_STABLE_LAYOUT.slots
  const sortedByTime = useMemo(
    () => [...all].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [all],
  )
  const visible = useMemo(() => {
    let items = all.filter(
      (item) => levels.has(item.level) && !hiddenPeers.has(item.observed_id),
    )
    if (scrub !== null && sortedByTime.length > 0) {
      const boundary = sortedByTime[Math.min(scrub, sortedByTime.length - 1)].created_at
      items = items.filter((item) => item.created_at <= boundary)
    }
    return items
  }, [all, levels, hiddenPeers, scrub, sortedByTime])

  useEffect(() => {
    if (!playing) return
    playRef.current = window.setInterval(() => {
      setScrub((current) => {
        const next = (current ?? 0) + 2
        if (next >= sortedByTime.length - 1) {
          setPlaying(false)
          return sortedByTime.length - 1
        }
        return next
      })
    }, 150)
    return () => {
      if (playRef.current) window.clearInterval(playRef.current)
    }
  }, [playing, sortedByTime.length])

  const peerIds = (peers.data?.items ?? []).map((peer) => peer.id)
  const visiblePeerIds = peerIds.filter((peerId) => !hiddenPeers.has(peerId))

  function toggleLevel(level: ConclusionLevel) {
    setLevels((current) => {
      const next = new Set(current)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  function togglePeer(peerId: string) {
    setHiddenPeers((current) => {
      const next = new Set(current)
      if (next.has(peerId)) next.delete(peerId)
      else next.add(peerId)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        icon={<Network className="h-6 w-6" />}
        title="Memory Map"
        subtitle="Visual map of conclusions, grouped by the peer they describe"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Workspace">
        {(workspaces.data?.items ?? []).map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => navigate({ name: 'memory-map', workspaceId: workspace.id })}
            className={
              workspace.id === activeWorkspace
                ? 'rounded-md bg-badge px-3 py-1.5 text-sm font-semibold text-badge-ink'
                : 'rounded-md border border-line px-3 py-1.5 text-sm text-fog hover:text-mist'
            }
          >
            {workspace.id}
          </button>
        ))}
        {capped.data ? (
          <span className="ml-2 text-xs text-fog">
            showing {visible.length} · {cappedLabel(capped.data)}
          </span>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CONCLUSION_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => toggleLevel(level)}
            aria-pressed={levels.has(level)}
            className={
              levels.has(level)
                ? 'flex items-center gap-1.5 rounded-full border border-line bg-panel-raise px-3 py-1 text-xs capitalize text-mist'
                : 'flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs capitalize text-fog opacity-50'
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ background: LEVEL_COLORS[level] }} />
            {level}
          </button>
        ))}
        {peerIds.map((peerId) => (
          <button
            key={peerId}
            type="button"
            onClick={() => togglePeer(peerId)}
            aria-pressed={!hiddenPeers.has(peerId)}
            className={
              hiddenPeers.has(peerId)
                ? 'rounded-full border border-line px-3 py-1 text-xs text-fog opacity-50'
                : 'rounded-full border border-line bg-panel px-3 py-1 text-xs text-mist'
            }
          >
            {peerId}
          </button>
        ))}
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Highlight conclusions containing…"
          className="ml-auto w-64 rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-mist outline-none focus:border-fog"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Map mode">
          <button
            type="button"
            onClick={() => setMode('constellation')}
            className={mode === 'constellation' ? 'bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'px-3 py-1.5 text-sm text-fog'}
          >
            Constellation
          </button>
          <button
            type="button"
            onClick={() => setMode('network')}
            className={mode === 'network' ? 'bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'px-3 py-1.5 text-sm text-fog'}
          >
            Network
          </button>
        </div>
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="View">
          <button
            type="button"
            onClick={() => setView('map')}
            className={view === 'map' ? 'flex items-center gap-1 bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'flex items-center gap-1 px-3 py-1.5 text-sm text-fog'}
          >
            <MapIcon className="h-4 w-4" /> Map
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={view === 'list' ? 'flex items-center gap-1 bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'flex items-center gap-1 px-3 py-1.5 text-sm text-fog'}
          >
            <List className="h-4 w-4" /> List
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMotionOn((current) => !current)}
          disabled={still}
          aria-pressed={motion}
          aria-label={motion ? 'Pause constellation motion' : 'Play constellation motion'}
          title={still ? 'Motion off in still mode' : 'Toggle constellation motion'}
          className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-sm text-mist hover:bg-panel disabled:opacity-50"
        >
          {motion ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          Motion
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-fog">
          <button
            type="button"
            onClick={() => {
              if (scrub === null) setScrub(0)
              setPlaying((current) => !current)
            }}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-mist hover:bg-panel"
            aria-label={playing ? 'Pause time scrubber' : 'Play time scrubber'}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <span>time</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, sortedByTime.length - 1)}
            value={scrub ?? Math.max(0, sortedByTime.length - 1)}
            onChange={(event) => setScrub(Number(event.target.value))}
            className="w-44"
            aria-label="Time scrubber over conclusion creation dates"
          />
          <button
            type="button"
            onClick={() => setScrub(null)}
            className="rounded-md border border-line px-2 py-1 text-mist hover:bg-panel"
          >
            All time
          </button>
          <span className="tabular-nums">
            {scrub !== null && sortedByTime.length > 0
              ? formatDateTime(sortedByTime[Math.min(scrub, sortedByTime.length - 1)].created_at)
              : 'all dates'}
          </span>
        </div>
      </div>

      {capped.error ? <ErrorBox message={capped.error} /> : null}
      {capped.loading && !capped.data ? <Spinner label="Loading memory map…" /> : null}

      <div className="flex items-start gap-4">
        <div className="blueprint-bg relative min-w-0 flex-1 rounded-[10px] border border-line bg-panel">
          {view === 'map' ? (
            mode === 'constellation' ? (
              <ConstellationSvg
                conclusions={visible}
                peerIds={visiblePeerIds}
                selected={selected}
                search={search}
                motion={motion}
                slots={stableSlots}
                onSelect={setSelected}
                onHover={setHover}
              />
            ) : (
              <NetworkSvg
                conclusions={visible}
                peerIds={peerIds}
                onEdgeClick={(observer, observed) => {
                  if (activeWorkspace) {
                    navigate({
                      name: 'conclusions',
                      workspaceId: activeWorkspace,
                      filters: { observer, observed, level: '', sessionId: '' },
                    })
                  }
                }}
              />
            )
          ) : (
            <div className="max-h-[560px] overflow-y-auto p-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs tracking-widest text-fog">
                    <th className="px-2 py-2">CONCLUSION</th>
                    <th className="px-2 py-2">LEVEL</th>
                    <th className="px-2 py-2">ABOUT</th>
                    <th className="px-2 py-2">CREATED</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((conclusion) => (
                    <tr
                      key={conclusion.id}
                      className="cursor-pointer border-b border-line hover:bg-panel-raise"
                      onClick={() => setSelected(conclusion)}
                    >
                      <td className="max-w-[380px] truncate px-2 py-2 text-mist">{conclusion.content}</td>
                      <td className="px-2 py-2 capitalize" style={{ color: LEVEL_COLORS[conclusion.level] }}>
                        {conclusion.level}
                      </td>
                      <td className="px-2 py-2 text-fog">{conclusion.observed_id}</td>
                      <td className="px-2 py-2 text-fog">{formatDateTime(conclusion.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hover && view === 'map' && mode === 'constellation' ? (
            <div
              className="pointer-events-none absolute z-10 max-w-[280px] rounded-md border border-line bg-ink px-3 py-2 text-xs text-mist"
              style={{
                left: `${(hover.x / MAP_WIDTH) * 100}%`,
                top: `${(hover.y / MAP_HEIGHT) * 100}%`,
                transform: 'translate(12px, 12px)',
              }}
            >
              {hover.conclusion.content}
              <span className="mt-1 block text-fog">
                {hover.conclusion.level} · derived ×{hover.conclusion.times_derived}
              </span>
            </div>
          ) : null}
          {capped.data && capped.data.items.length > 5000 ? (
            <p className="border-t border-line px-4 py-2 text-xs text-fog">
              Over 5,000 conclusions — showing per-peer density cells instead of individual dots.
            </p>
          ) : null}
        </div>

        <aside className="card-shell w-[320px] shrink-0 p-4" aria-label="Map detail rail">
          <h2 className="mb-2 text-sm tracking-widest text-fog">GROWTH</h2>
          <GrowthChart points={buildGrowthSeries(all)} height={90} />
          <h2 className="mb-2 mt-5 text-sm tracking-widest text-fog">DETAIL</h2>
          {selected ? (
            <div className="text-sm">
              <p className="leading-relaxed text-mist">{selected.content}</p>
              <dl className="mt-3 flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-fog">Level</dt>
                  <dd className="capitalize" style={{ color: LEVEL_COLORS[selected.level] }}>
                    {selected.level}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fog">Observer → observed</dt>
                  <dd className="text-mist">
                    {selected.observer_id} → {selected.observed_id}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fog">Times derived</dt>
                  <dd className="tabular-nums text-mist">{selected.times_derived}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fog">Created</dt>
                  <dd className="text-mist">{formatDateTime(selected.created_at)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fog">Derived from</dt>
                  <dd className="text-mist">
                    {selected.source_ids.length > 0 ? `${selected.source_ids.length} conclusion(s)` : 'messages'}
                  </dd>
                </div>
              </dl>
              {selected.session_id && activeWorkspace ? (
                <button
                  type="button"
                  className="mt-4 w-full rounded-md border border-line px-3 py-2 text-sm text-mist hover:bg-panel-raise"
                  onClick={() =>
                    navigate({
                      name: 'session',
                      workspaceId: activeWorkspace,
                      sessionId: selected.session_id!,
                      tab: 'messages',
                    })
                  }
                >
                  Open session {selected.session_id}
                </button>
              ) : null}
              {activeWorkspace ? (
                <button
                  type="button"
                  className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm text-mist hover:bg-panel-raise"
                  onClick={() =>
                    navigate({
                      name: 'conclusions',
                      workspaceId: activeWorkspace,
                      filters: { observer: '', observed: selected.observed_id, level: '', sessionId: '' },
                    })
                  }
                >
                  Open in Conclusions Explorer
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-fog">
              Click a dot to inspect a conclusion. Dot color = level, size = times derived,
              oldest conclusions sit closest to their peer hub.
            </p>
          )}
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-fog">
            Legend: colors — explicit #BCD6FF · deductive #6EA8FF · inductive #B79CFF ·
            contradiction #FF7A7A. Dot radius = √(times derived).
          </p>
        </aside>
      </div>
    </div>
  )
}
