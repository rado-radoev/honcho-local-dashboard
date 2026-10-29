import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, List, Map as MapIcon, Network, Pause, Play, RefreshCw, Sparkles, X } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import { navigate } from '../lib/routing'
import { formatDateTime } from '../lib/format'
import { ErrorBox, PageHeader, Spinner } from '../components/ui'
import {
  ConstellationSvg,
  NetworkSvg,
  type ConstellationColorMode,
} from '../components/MemoryMapCanvas'
import { TimelineSvg } from '../components/TimelineCanvas'
import { FaultLinesPanel } from '../components/FaultLines'
import { maxCreatedAtMs } from '../lib/ageStyle'
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
import { traceChain, type TraceChainResult } from '../lib/traceChain'
import { BIRTH_RING_MS, diffConclusionIds } from '../lib/newMemories'
import type { CappedConclusions, Conclusion, ConclusionLevel } from '../types'

// How long the derivation-trace pulse dwells on each hop before
// travelling to the next ancestor.
const TRACE_STEP_MS = 550
// The capped conclusions cache lives 60s (lib/conclusions.ts), so a
// poll just past that interval is the earliest a refresh can actually
// return new memories — it drives the new-memory pulse (Phase A2).
const REFRESH_POLL_MS = 65_000

const EMPTY_ID_SET: ReadonlySet<string> = new Set()

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

  const [mode, setMode] = useState<'constellation' | 'network' | 'timeline' | 'fault'>('constellation')
  // Dusk overlay (Phase C2): constellation colour mode — level
  // colours, or age fading relative to the reference "now" below.
  const [colorMode, setColorMode] = useState<ConstellationColorMode>('level')
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
  // Hub focus mode (A3): the peer whose cluster is scaled up while the
  // others dim, or null when focus is off.
  const [focusedPeer, setFocusedPeer] = useState<string | null>(null)
  // Derivation trace (A1): the walked source chain of the traced
  // conclusion plus the hop the travelling pulse currently sits on.
  const [trace, setTrace] = useState<{ rootId: string; result: TraceChainResult } | null>(null)
  const [pulseStep, setPulseStep] = useState(0)
  // New-memory pulse (A2): ids born in the latest refresh (their dots
  // get a one-shot birth ring) and the dataset the "new memories"
  // chip was dismissed for.
  const [bornIds, setBornIds] = useState<ReadonlySet<string>>(EMPTY_ID_SET)
  const [dismissedData, setDismissedData] = useState<CappedConclusions | null>(null)

  const all = useMemo(() => capped.data?.items ?? [], [capped.data])

  // Dusk reference "now": live mode uses the real clock (snapshotted
  // once at mount — age is day-grained, so a mount-time "now" is the
  // stable reference for the whole view); still (demo/screenshot)
  // mode uses the dataset's max created_at so Age renders are
  // deterministic and baselines stay byte-stable.
  const [mountNowMs] = useState(() => Date.now())
  const datasetMaxMs = maxCreatedAtMs(all)
  let referenceNowMs = mountNowMs
  if (still && datasetMaxMs !== null) referenceNowMs = datasetMaxMs

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

  // New-memory tracking (A2), same adjust-during-render pattern as the
  // stable layout above: whenever a fresh capped dataset lands, diff
  // its ids against the previous dataset's. Two guards keep the pulse
  // honest — first loads NEVER pulse (prevIds is null until a real
  // baseline is recorded), and a workspace switch NEVER pulses: if
  // the dataset on screen at switch time is the previous workspace's
  // (same identity as last recorded) it is marked stale and only the
  // NEXT dataset becomes the new workspace's baseline.
  const [seen, setSeen] = useState<{
    workspace: string | null
    dataset: Conclusion[] | null
    prevIds: ReadonlySet<string> | null
    freshIds: string[]
    stale: Conclusion[] | null
  }>(() => ({
    workspace: activeWorkspace,
    dataset: null,
    prevIds: null,
    freshIds: [],
    stale: null,
  }))
  if (capped.data && (seen.workspace !== activeWorkspace || seen.dataset !== all)) {
    const nextIds = all.map((item) => item.id)
    if (seen.workspace !== activeWorkspace) {
      const datasetIsStale = seen.dataset === all
      setSeen({
        workspace: activeWorkspace,
        dataset: all,
        prevIds: datasetIsStale ? null : new Set(nextIds),
        freshIds: [],
        stale: datasetIsStale ? all : null,
      })
    } else if (all === seen.stale) {
      setSeen({ ...seen, dataset: all })
    } else {
      const freshIds = diffConclusionIds(seen.prevIds, nextIds)
      setSeen({
        workspace: activeWorkspace,
        dataset: all,
        prevIds: new Set(nextIds),
        freshIds,
        stale: null,
      })
      if (freshIds.length > 0) setBornIds(new Set(freshIds))
    }
  }
  const showNewChip =
    seen.freshIds.length > 0 && dismissedData !== capped.data && capped.data !== null

  // Focus / trace / selection describe one workspace's dots — reset
  // them when the workspace changes so a stale trace can never dim a
  // different workspace's map.
  const [viewWorkspace, setViewWorkspace] = useState(activeWorkspace)
  if (viewWorkspace !== activeWorkspace) {
    setViewWorkspace(activeWorkspace)
    setFocusedPeer(null)
    setTrace(null)
    setPulseStep(0)
    setSelected(null)
    setHover(null)
  }
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

  // Thread-Timeline inputs (Phase B): in still mode the timeline
  // always renders the FULL static range (no scrubber cut, no
  // playhead); live, it consumes the same scrubbed `visible` set as
  // the other modes, so the time scrubber + Play drive its birth
  // replay — dots appear exactly at their created_at moment.
  const timelineItems = useMemo(() => {
    if (!still) return visible
    return all.filter((item) => levels.has(item.level) && !hiddenPeers.has(item.observed_id))
  }, [still, visible, all, levels, hiddenPeers])
  let playheadAt: string | null = null
  if (!still && scrub !== null && sortedByTime.length > 0) {
    playheadAt = sortedByTime[Math.min(scrub, sortedByTime.length - 1)].created_at
  }

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

  // Derivation trace timing: the pulse advances one hop per
  // TRACE_STEP_MS until it reaches the oldest ancestor, then holds.
  // Under ?still=1 there is no timing at all — the canvas renders the
  // final traced state (every hop lit) so baselines stay stable.
  const traceLastStep = trace ? trace.result.steps.length - 1 : 0
  let activeTraceStep = 0
  if (trace) {
    activeTraceStep = still ? traceLastStep : Math.min(pulseStep, traceLastStep)
  }

  useEffect(() => {
    if (!trace || still) return
    if (pulseStep >= trace.result.steps.length - 1) return
    const timer = window.setInterval(() => {
      setPulseStep((current) => Math.min(current + 1, trace.result.steps.length - 1))
    }, TRACE_STEP_MS)
    return () => window.clearInterval(timer)
  }, [trace, still, pulseStep])

  // Birth rings are one-shot: clear the born set once the animation
  // window has passed so later re-renders never replay it.
  useEffect(() => {
    if (bornIds.size === 0) return
    const timer = window.setTimeout(() => setBornIds(EMPTY_ID_SET), BIRTH_RING_MS)
    return () => window.clearTimeout(timer)
  }, [bornIds])

  // Refresh poll aligned with the 60s conclusions cache (see
  // REFRESH_POLL_MS): the earliest moment a reload can surface new
  // memories for the pulse + chip. (useAsyncData's reload is a stable
  // useCallback, so it can be an effect dep directly.)
  const cappedReload = capped.reload
  useEffect(() => {
    const timer = window.setInterval(() => cappedReload(), REFRESH_POLL_MS)
    return () => window.clearInterval(timer)
  }, [cappedReload])

  // Esc exits hub focus first, then clears an active trace.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (focusedPeer) {
        setFocusedPeer(null)
        return
      }
      if (trace) {
        setTrace(null)
        setPulseStep(0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedPeer, trace])

  function handleTrace() {
    if (!selected) return
    const byId = new Map(all.map((item) => [item.id, item]))
    setTrace({ rootId: selected.id, result: traceChain(selected, byId) })
    setPulseStep(0)
  }

  function clearTrace() {
    setTrace(null)
    setPulseStep(0)
  }

  function handleHubClick(peerId: string) {
    setFocusedPeer((current) => (current === peerId ? null : peerId))
  }

  function handleBackgroundClick() {
    if (focusedPeer) setFocusedPeer(null)
  }

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

  // The map-mode canvas, picked with statements (never nested
  // ternaries): Constellation, Network, Thread-Timeline, or the
  // Fault Lines contradictions view (Phase C1 — a fourth mode over
  // the SAME capped dataset this page already fetched, unfiltered:
  // every contradiction in the fetched set, not just visible dots).
  let mapCanvas
  if (mode === 'fault') {
    mapCanvas = (
      <FaultLinesPanel
        conclusions={all}
        onOpenInExplorer={(ids) => {
          if (activeWorkspace) {
            navigate({
              name: 'conclusions',
              workspaceId: activeWorkspace,
              filters: { observer: '', observed: '', level: '', sessionId: '', ids },
            })
          }
        }}
      />
    )
  } else if (mode === 'timeline') {
    mapCanvas = (
      <TimelineSvg
        conclusions={timelineItems}
        peerIds={visiblePeerIds}
        selected={selected}
        search={search}
        playheadAt={playheadAt}
        still={still}
        onSelect={setSelected}
      />
    )
  } else if (mode === 'network') {
    mapCanvas = (
      <NetworkSvg
        conclusions={visible}
        peerIds={peerIds}
        onEdgeClick={(observer, observed) => {
          if (activeWorkspace) {
            navigate({
              name: 'conclusions',
              workspaceId: activeWorkspace,
              filters: { observer, observed, level: '', sessionId: '', ids: [] },
            })
          }
        }}
      />
    )
  } else {
    mapCanvas = (
      <ConstellationSvg
        conclusions={visible}
        peerIds={visiblePeerIds}
        selected={selected}
        search={search}
        motion={motion}
        slots={stableSlots}
        focusedPeer={focusedPeer}
        trace={trace ? trace.result : null}
        activeTraceStep={activeTraceStep}
        still={still}
        bornIds={bornIds}
        colorMode={colorMode}
        referenceNowMs={referenceNowMs}
        onSelect={setSelected}
        onHover={setHover}
        onHubClick={handleHubClick}
        onBackgroundClick={handleBackgroundClick}
      />
    )
  }

  let detailHint =
    'Click a dot to inspect a conclusion. Dot color = level, size = times derived, oldest conclusions sit closest to their peer hub.'
  if (mode === 'timeline') {
    detailHint =
      'Click a dot to inspect a conclusion. Lane = observed peer, position = when it was created, color = level, size = times derived; arcs trace what each conclusion was derived from.'
  }
  if (mode === 'network') {
    detailHint =
      'Arrows aggregate observer → observed conclusions between peers. Click an arrow to open those conclusions in the Explorer.'
  }
  if (mode === 'fault') {
    detailHint =
      'Fault Lines groups every contradiction in the fetched set by source linkage — cross-references, shared source conclusions, shared source messages. Anything with no discoverable link is listed as Unlinked, never force-matched.'
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
        <button
          type="button"
          onClick={() => capped.reload()}
          className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-mist hover:bg-panel"
          title="Refresh conclusions (new memories pulse on the map)"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        {showNewChip ? (
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-panel-raise py-1 pl-3 pr-1.5 text-xs text-mist">
            <Sparkles className="h-3.5 w-3.5" />
            {seen.freshIds.length} new {seen.freshIds.length === 1 ? 'memory' : 'memories'}
            <button
              type="button"
              aria-label="Dismiss new memories notice"
              onClick={() => setDismissedData(capped.data)}
              className="rounded-full p-0.5 text-fog hover:text-mist"
            >
              <X className="h-3.5 w-3.5" />
            </button>
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
          <button
            type="button"
            onClick={() => setMode('timeline')}
            className={mode === 'timeline' ? 'bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'px-3 py-1.5 text-sm text-fog'}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setMode('fault')}
            className={mode === 'fault' ? 'bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'px-3 py-1.5 text-sm text-fog'}
          >
            Fault Lines
          </button>
        </div>
        {mode === 'constellation' ? (
          <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Constellation colour mode">
            <button
              type="button"
              onClick={() => setColorMode('level')}
              aria-pressed={colorMode === 'level'}
              className={colorMode === 'level' ? 'bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'px-3 py-1.5 text-sm text-fog'}
            >
              Level
            </button>
            <button
              type="button"
              onClick={() => setColorMode('age')}
              aria-pressed={colorMode === 'age'}
              className={colorMode === 'age' ? 'bg-panel-raise px-3 py-1.5 text-sm text-mist' : 'px-3 py-1.5 text-sm text-fog'}
            >
              Age
            </button>
          </div>
        ) : null}
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
            mapCanvas
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
              {selected.source_ids.length > 0 ? (
                <button
                  type="button"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-mist hover:bg-panel-raise"
                  onClick={handleTrace}
                >
                  <GitBranch className="h-4 w-4" /> Trace derivation
                </button>
              ) : null}
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
                      filters: { observer: '', observed: selected.observed_id, level: '', sessionId: '', ids: [] },
                    })
                  }
                >
                  Open in Conclusions Explorer
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-fog">{detailHint}</p>
          )}
          {trace ? (
            <div className="mt-5 border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm tracking-widest text-fog">DERIVATION TRACE</h2>
                <button
                  type="button"
                  onClick={clearTrace}
                  className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-mist hover:bg-panel-raise"
                >
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              </div>
              <ol className="flex flex-col gap-1.5">
                {trace.result.steps.map((step, index) => {
                  const isLit = index <= activeTraceStep
                  let rowClass = 'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left'
                  if (index === activeTraceStep) rowClass += ' bg-panel-raise ring-1 ring-[#B79CFF]'
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        disabled={!step.conclusion}
                        onClick={() => {
                          if (step.conclusion) setSelected(step.conclusion)
                        }}
                        className={rowClass}
                      >
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] tabular-nums text-fog">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          {step.conclusion ? (
                            <span
                              className={
                                isLit
                                  ? 'block text-xs leading-relaxed text-mist line-clamp-2'
                                  : 'block text-xs leading-relaxed text-fog line-clamp-2'
                              }
                            >
                              {step.conclusion.content}
                            </span>
                          ) : (
                            <span className="block text-xs text-fog">
                              {step.id} (not in capped set)
                            </span>
                          )}
                          <span className="mt-0.5 block text-[10px] tracking-widest text-fog">
                            {step.depth === 0 ? 'THIS CONCLUSION' : `SOURCE · HOP ${step.depth}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {trace.result.truncated ? (
                <p className="mt-2 text-[11px] text-fog">chain truncated at depth 5</p>
              ) : null}
            </div>
          ) : null}
          {mode === 'constellation' && colorMode === 'age' ? (
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-fog">
              Legend (Age): dots fade with age — newest at full strength and full level colour,
              oldest floored at 25% opacity, desaturated toward fog #9FB0CC. Hub labels show when
              each peer was last learned about; a fog dot on a hub ring means that peer has been
              quiet for over 30 days (advisory only).
            </p>
          ) : (
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-fog">
              Legend: colors — explicit #BCD6FF · deductive #6EA8FF · inductive #B79CFF ·
              contradiction #FF7A7A. Dot radius = √(times derived).
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
