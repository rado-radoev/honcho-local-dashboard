import { useEffect, useRef, type RefObject } from 'react'
import type { Conclusion } from '../types'
import { LEVEL_COLORS } from '../lib/conclusions'
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  layoutConstellation,
  layoutConstellationRadius,
  layoutNetwork,
  radiusBandCenter,
  type DotLayout,
  type HubLayout,
  type RadiusDotLayout,
} from '../lib/memoryGraph'
import { orbitBandForDistance, orbitRotationDeg } from '../lib/orbit'
import type { RadiusSlot, StableSlot } from '../lib/stableLayout'
import { RADIUS_BAND_LABELS, monthTicksForPeer } from '../lib/derivationDepth'
import { focusOpacity, focusScale, focusTransform } from '../lib/hubFocus'
import type { TraceChainResult } from '../lib/traceChain'
import {
  AGE_FOG_COLOR,
  ageFill,
  ageOpacity,
  buildAgeContext,
  isQuietPeer,
  lastLearnedByPeer,
  lastLearnedLabel,
} from '../lib/ageStyle'

export type ConstellationColorMode = 'level' | 'age'

// SVG rendering for the Memory Map (no canvas, no animation library).
// Constellation: peer hubs with gradient-ring strokes + conclusion dots.
// Network: aggregated directed edges between peer hubs. All base
// coordinates come from the deterministic lib — this component only draws.
//
// Constellation motion: dots are grouped per peer + ring band into <g>
// elements, and a single rAF loop rotates each group around its hub by
// writing the transform attribute directly on the DOM node (no React
// state per frame). A band's dots + their hub tether lines live in the
// same group, so tethers follow the dots exactly and the hub endpoint
// (the rotation centre) never moves. At 120 dots that is ~9 transforms
// per frame (3 peers × ~3 bands); at the 2,000-dot cap ~50 — the dot
// count never changes the per-frame transform count.

interface OrbitGroup {
  key: string
  band: number
  hub: HubLayout
  dots: DotLayout[]
}

function buildOrbitGroups(
  dots: DotLayout[],
  hubs: HubLayout[],
  bandOf?: (dot: DotLayout) => number,
): OrbitGroup[] {
  const hubByPeer = new Map(hubs.map((hub) => [hub.peerId, hub]))
  const groups = new Map<string, OrbitGroup>()
  for (const dot of dots) {
    const hub = hubByPeer.get(dot.peerId)
    if (!hub) continue
    let band = orbitBandForDistance(Math.hypot(dot.x - hub.x, dot.y - hub.y))
    if (bandOf) band = bandOf(dot)
    const key = `${dot.peerId}:${band}`
    let group = groups.get(key)
    if (!group) {
      group = { key, band, hub, dots: [] }
      groups.set(key, group)
    }
    group.dots.push(dot)
  }
  return [...groups.values()]
}

interface GroupHandle {
  el: SVGGElement
  band: number
  hubX: number
  hubY: number
}

function clampToMap(value: number, max: number): number {
  return Math.min(max - 8, Math.max(8, value))
}

// Apply append-stable slots (lib/stableLayout.ts) over the rank-based
// layout: a dot with a slot renders at the slot's angle/radius around
// its hub, not at its current spiral rank, so dataset refreshes never
// move existing dots. Dots without a slot keep their layout position.
function applyStableSlots(
  dots: DotLayout[],
  hubs: HubLayout[],
  slots: ReadonlyMap<string, StableSlot> | undefined,
): DotLayout[] {
  if (!slots) return dots
  const hubByPeer = new Map(hubs.map((hub) => [hub.peerId, hub]))
  return dots.map((dot) => {
    const slot = slots.get(dot.conclusion.id)
    if (!slot || slot.peerId !== dot.peerId) return dot
    const hub = hubByPeer.get(dot.peerId)
    if (!hub) return dot
    return {
      ...dot,
      x: clampToMap(hub.x + slot.radius * Math.cos(slot.angle), MAP_WIDTH),
      y: clampToMap(hub.y + slot.radius * Math.sin(slot.angle), MAP_HEIGHT),
    }
  })
}

// Apply append-stable radius slots (lib/stableLayout.ts) over the
// rank-based radius layout: a dot with a slot renders at the slot's
// angle + sub-ring offset inside its band, so dataset refreshes never
// move existing dots within their (peer, band) group.
function applyRadiusStableSlots(
  dots: RadiusDotLayout[],
  hubs: HubLayout[],
  slots: ReadonlyMap<string, RadiusSlot> | undefined,
): RadiusDotLayout[] {
  if (!slots) return dots
  const hubByPeer = new Map(hubs.map((hub) => [hub.peerId, hub]))
  return dots.map((dot) => {
    const slot = slots.get(dot.conclusion.id)
    if (!slot || slot.peerId !== dot.peerId || slot.band !== dot.band) return dot
    const hub = hubByPeer.get(dot.peerId)
    if (!hub) return dot
    const distance = radiusBandCenter(dot.band) + slot.subRadius
    return {
      ...dot,
      x: clampToMap(hub.x + distance * Math.cos(slot.angle), MAP_WIDTH),
      y: clampToMap(hub.y + distance * Math.sin(slot.angle), MAP_HEIGHT),
    }
  })
}

function ConstellationMotion({
  motion,
  groupRefs,
}: {
  motion: boolean
  groupRefs: RefObject<Map<string, GroupHandle>>
}) {
  const elapsedRef = useRef(0)

  useEffect(() => {
    if (!motion) {
      for (const handle of groupRefs.current.values()) {
        handle.el.removeAttribute('transform')
      }
      return
    }
    let frame = 0
    let last = -1
    function tick(now: number) {
      if (last < 0) last = now
      const delta = now - last
      last = now
      // Cap the counted delta per frame: when the tab is hidden rAF
      // stops entirely, and the first frame back must not jump the
      // orbit forward by the hidden duration.
      elapsedRef.current += Math.min(delta, 50)
      for (const handle of groupRefs.current.values()) {
        const deg = orbitRotationDeg(elapsedRef.current, handle.band)
        handle.el.setAttribute(
          'transform',
          `rotate(${deg.toFixed(3)} ${handle.hubX} ${handle.hubY})`,
        )
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [motion, groupRefs])

  return null
}

// How one dot relates to the active derivation trace: lit hops are
// at or before the travelling pulse, `current` is the hop the pulse
// sits on, `pending` hops wait their turn, `dim` dots are not in the
// chain at all, and `none` means no trace is active.
type TraceDotState = 'none' | 'lit' | 'current' | 'pending' | 'dim'

function traceDotState(
  id: string,
  trace: TraceChainResult | null,
  activeStep: number,
): TraceDotState {
  if (!trace) return 'none'
  const index = trace.orderById.get(id)
  if (index === undefined) return 'dim'
  if (index === activeStep) return 'current'
  if (index < activeStep) return 'lit'
  return 'pending'
}

export type ConstellationLayoutVariant = 'spiral' | 'radius'

export function ConstellationSvg({
  conclusions,
  peerIds,
  selected,
  search,
  motion,
  slots,
  layoutVariant = 'spiral',
  radiusSlots,
  depthById,
  focusedPeer,
  trace,
  activeTraceStep,
  still,
  bornIds,
  colorMode = 'level',
  referenceNowMs,
  onSelect,
  onHover,
  onHubClick,
  onBackgroundClick,
}: {
  conclusions: Conclusion[]
  peerIds: string[]
  selected: Conclusion | null
  search: string
  motion: boolean
  slots?: ReadonlyMap<string, StableSlot>
  // Reasoning Radius (Phase E): 'radius' swaps the spiral placement
  // for derivation-depth rings. Depth is computed by the PAGE over
  // the full fetched set (not this filtered `conclusions` list) and
  // passed in, so filtering/scrubbing can never change a dot's ring.
  layoutVariant?: ConstellationLayoutVariant
  radiusSlots?: ReadonlyMap<string, RadiusSlot>
  depthById?: ReadonlyMap<string, number>
  // Hub focus mode (lib/hubFocus.ts): the peer whose cluster stays
  // opaque + scales up, or null when focus is off.
  focusedPeer: string | null
  // Derivation trace (lib/traceChain.ts): the walked source chain of
  // the traced conclusion, keyed by conclusion id so highlighting
  // survives orbiting dots.
  trace: TraceChainResult | null
  activeTraceStep: number
  still: boolean
  // Conclusions born in the latest refresh (lib/newMemories.ts): each
  // gets a one-shot expanding birth ring (never under still mode).
  bornIds: ReadonlySet<string>
  // Dusk overlay (lib/ageStyle.ts): 'age' fades dot fill/opacity by
  // created_at age instead of showing pure level colours. A pure
  // per-dot styling layer — orbit groups, trace, focus and tooltips
  // are computed exactly as in Level mode.
  colorMode?: ConstellationColorMode
  // Reference "now" for age math. Live callers pass the real clock;
  // demo/screenshot callers pass the dataset's max created_at so the
  // render is deterministic. Defaults to that dataset max.
  referenceNowMs?: number
  onSelect: (conclusion: Conclusion) => void
  onHover: (dot: DotLayout | null) => void
  onHubClick: (peerId: string) => void
  onBackgroundClick: () => void
}) {
  const isRadius = layoutVariant === 'radius'
  const layout = layoutConstellation(conclusions, peerIds, MAP_WIDTH, MAP_HEIGHT)
  let dots: DotLayout[] = applyStableSlots(layout.dots, layout.hubs, slots)
  if (isRadius) {
    const radiusLayout = layoutConstellationRadius(
      conclusions,
      peerIds,
      depthById ?? new Map(),
      MAP_WIDTH,
      MAP_HEIGHT,
    )
    dots = applyRadiusStableSlots(radiusLayout.dots, radiusLayout.hubs, radiusSlots)
  }
  const dotById = new Map(dots.map((dot) => [dot.conclusion.id, dot]))
  const hubByPeer = new Map(layout.hubs.map((hub) => [hub.peerId, hub]))
  const needle = search.trim().toLowerCase()
  const selectedDot = selected ? dotById.get(selected.id) : undefined
  // In Radius mode the orbit bands ARE the depth rings: a band group
  // rotates by its ring index, not by a distance-derived shell.
  let radiusBandOf: ((dot: DotLayout) => number) | undefined
  if (isRadius) {
    radiusBandOf = (dot) => (dot as RadiusDotLayout).band ?? 0
  }
  const groups = buildOrbitGroups(dots, layout.hubs, radiusBandOf)
  const groupsByPeer = new Map<string, OrbitGroup[]>()
  for (const group of groups) {
    const list = groupsByPeer.get(group.hub.peerId) ?? []
    list.push(group)
    groupsByPeer.set(group.hub.peerId, list)
  }
  const peerScale = focusScale(peerIds.length)
  const groupRefs = useRef(new Map<string, GroupHandle>())
  // Dusk context: resolved "now" (prop, else the dataset's own max
  // created_at) + per-peer last-learned instants for the hub labels.
  let resolvedNowMs = referenceNowMs
  if (resolvedNowMs === undefined) {
    let max = 0
    for (const item of conclusions) {
      const ms = Date.parse(item.created_at)
      if (!Number.isNaN(ms) && ms > max) max = ms
    }
    resolvedNowMs = max
  }
  const ageContext = buildAgeContext(conclusions, resolvedNowMs)
  const lastLearned = lastLearnedByPeer(conclusions)

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="Memory constellation map"
      data-testid="constellation-svg"
    >
      <defs>
        <linearGradient id="hub-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6EA8FF" />
          <stop offset="100%" stopColor="#B79CFF" />
        </linearGradient>
      </defs>

      <ConstellationMotion motion={motion} groupRefs={groupRefs} />

      {/* Background click target (hub focus exit). Behind everything;
          dot and hub handlers stopPropagation so only true empty-space
          clicks reach it. */}
      <rect
        x={0}
        y={0}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        fill="transparent"
        data-testid="map-background"
        onClick={onBackgroundClick}
      />

      {/* Reasoning Radius guides (Radius mode only): one faint ring
          per depth band around each hub, labelled on the upper-right
          diagonal. Purely presentational — dots, tethers and orbit
          groups are computed from the same band centres. */}
      {isRadius && !layout.aggregated
        ? layout.hubs.map((hub) => (
            <g key={`rings-${hub.peerId}`} pointerEvents="none">
              {RADIUS_BAND_LABELS.map((label, band) => {
                const centre = radiusBandCenter(band)
                const labelX = hub.x + centre * Math.SQRT1_2
                const labelY = hub.y - centre * Math.SQRT1_2
                return (
                  <g key={label}>
                    <circle
                      data-testid="radius-ring"
                      data-peer={hub.peerId}
                      data-band={band}
                      cx={hub.x}
                      cy={hub.y}
                      r={centre}
                      fill="none"
                      stroke="#8EA3C7"
                      strokeWidth={0.7}
                      strokeDasharray="3 4"
                      opacity={0.35}
                    />
                    <text
                      data-testid="radius-ring-label"
                      data-peer={hub.peerId}
                      data-band={band}
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      fill="#9FB0CC"
                      fontSize={8.5}
                      opacity={0.85}
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
            </g>
          ))
        : null}

      {/* Derivation edges stay at base angles (the simpler correct
          option): they are drawn from the deterministic layout, not
          from the rotating groups, so a selected dot's orbit does not
          drag its source chain around. With a trace active, the whole
          walked chain is drawn and edges light as the pulse passes. */}
      {trace
        ? trace.edges.map((edge) => {
            const from = dotById.get(edge.from)
            const to = dotById.get(edge.to)
            if (!from || !to) return null
            const targetStep = trace.orderById.get(edge.to) ?? 0
            const lit = targetStep <= activeTraceStep
            return (
              <line
                key={`${edge.from}->${edge.to}`}
                data-testid="trace-edge"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#B79CFF"
                strokeWidth={1.2}
                strokeDasharray="4 3"
                opacity={lit ? 0.9 : 0.25}
              />
            )
          })
        : null}
      {!trace && selectedDot
        ? selectedDot.conclusion.source_ids.map((sourceId) => {
            const target = dotById.get(sourceId)
            if (!target) return null
            return (
              <line
                key={sourceId}
                x1={selectedDot.x}
                y1={selectedDot.y}
                x2={target.x}
                y2={target.y}
                stroke="#B79CFF"
                strokeWidth={1.2}
                strokeDasharray="4 3"
              />
            )
          })
        : null}

      {layout.aggregated
        ? layout.cells.map((cell) => (
            <g key={cell.peerId} opacity={focusOpacity(focusedPeer, cell.peerId)}>
              <rect
                x={cell.x - 26}
                y={cell.y - 26}
                width={52}
                height={52}
                rx={10}
                fill={LEVEL_COLORS[cell.dominantLevel]}
                opacity={0.25}
                stroke={LEVEL_COLORS[cell.dominantLevel]}
              />
              <text x={cell.x} y={cell.y + 4} textAnchor="middle" fill="#DBE4F5" fontSize={13}>
                {cell.count}
              </text>
            </g>
          ))
        : null}

      {/* One wrapper group per peer carries the focus opacity + scale
          transform; the orbit band groups inside keep their own rAF
          rotation transform, so orbit, tooltips, and dot clicks all
          keep working inside focus mode. */}
      {layout.hubs.map((hub) => {
        const peerGroups = groupsByPeer.get(hub.peerId) ?? []
        if (peerGroups.length === 0) return null
        const scale = focusedPeer === hub.peerId ? peerScale : 1
        return (
          <g
            key={hub.peerId}
            data-testid="peer-group"
            data-peer={hub.peerId}
            opacity={focusOpacity(focusedPeer, hub.peerId)}
            transform={focusTransform(hub, scale)}
          >
            {peerGroups.map((group) => (
              <g
                key={group.key}
                ref={(el) => {
                  if (el) {
                    groupRefs.current.set(group.key, {
                      el,
                      band: group.band,
                      hubX: group.hub.x,
                      hubY: group.hub.y,
                    })
                  } else {
                    groupRefs.current.delete(group.key)
                  }
                }}
              >
                {group.dots.map((dot) => (
                  <line
                    key={`tether-${dot.conclusion.id}`}
                    data-testid="map-tether"
                    x1={group.hub.x}
                    y1={group.hub.y}
                    x2={dot.x}
                    y2={dot.y}
                    stroke="#8EA3C7"
                    strokeWidth={0.6}
                    opacity={0.14}
                    pointerEvents="none"
                  />
                ))}
                {group.dots.map((dot) => {
                  const matches =
                    needle.length === 0 || dot.conclusion.content.toLowerCase().includes(needle)
                  const isSelected = selected?.id === dot.conclusion.id
                  const tState = traceDotState(dot.conclusion.id, trace, activeTraceStep)
                  let opacity = matches ? 0.9 : 0.13
                  if (tState === 'dim') opacity = 0.12
                  if (tState === 'pending') opacity = 0.4
                  if (tState === 'lit' || tState === 'current') opacity = 1
                  let stroke = 'transparent'
                  let strokeWidth = 7
                  if (tState === 'lit') {
                    stroke = 'rgba(255,255,255,0.85)'
                    strokeWidth = 1
                  }
                  if (tState === 'current') {
                    stroke = '#FFFFFF'
                    strokeWidth = 1.5
                  }
                  if (isSelected) {
                    stroke = '#FFFFFF'
                    strokeWidth = 1.5
                  }
                  // Dusk: in Age mode the dot's fill desaturates
                  // toward fog and its opacity scales by age (floor
                  // ~25%) ON TOP of the trace/search opacity above —
                  // selection, trace and hover behaviour are unchanged.
                  let fill = dot.color
                  if (colorMode === 'age') {
                    opacity = opacity * ageOpacity(dot.conclusion.created_at, ageContext)
                    fill = ageFill(dot.color, dot.conclusion.created_at, ageContext)
                  }
                  const glowing = isSelected || tState === 'current'
                  const showBirthRing = bornIds.has(dot.conclusion.id) && !still
                  const showTracePulse = tState === 'current' && !still && trace !== null
                  return (
                    <g key={dot.conclusion.id}>
                      <circle
                        data-testid="map-dot"
                        data-conclusion-id={dot.conclusion.id}
                        data-depth={(dot as RadiusDotLayout).depth}
                        data-band={(dot as RadiusDotLayout).band}
                        cx={dot.x}
                        cy={dot.y}
                        r={isSelected ? dot.r + 2 : dot.r}
                        fill={fill}
                        opacity={opacity}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        style={
                          glowing
                            ? { filter: 'drop-shadow(0 0 6px rgba(183,156,255,0.9))', cursor: 'pointer' }
                            : { cursor: 'pointer' }
                        }
                        onMouseEnter={() => {
                          if (focusedPeer === dot.peerId) {
                            const focusHub = hubByPeer.get(dot.peerId)
                            if (focusHub) {
                              onHover({
                                ...dot,
                                x: focusHub.x + (dot.x - focusHub.x) * peerScale,
                                y: focusHub.y + (dot.y - focusHub.y) * peerScale,
                              })
                              return
                            }
                          }
                          onHover(dot)
                        }}
                        onMouseLeave={() => onHover(null)}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelect(dot.conclusion)
                        }}
                      >
                        <title>{dot.conclusion.content}</title>
                      </circle>
                      {showBirthRing ? (
                        <circle
                          data-testid="birth-ring"
                          cx={dot.x}
                          cy={dot.y}
                          r={dot.r + 2}
                          fill="none"
                          stroke={dot.color}
                          strokeWidth={1.5}
                          opacity={0.9}
                          pointerEvents="none"
                        >
                          <animate
                            attributeName="r"
                            from={dot.r + 2}
                            to={dot.r + 13}
                            dur="1.6s"
                            repeatCount="1"
                            fill="freeze"
                          />
                          <animate
                            attributeName="opacity"
                            from={0.9}
                            to={0}
                            dur="1.6s"
                            repeatCount="1"
                            fill="freeze"
                          />
                        </circle>
                      ) : null}
                      {showTracePulse ? (
                        <circle
                          data-testid="trace-pulse"
                          cx={dot.x}
                          cy={dot.y}
                          r={dot.r + 3}
                          fill="none"
                          stroke="#B79CFF"
                          strokeWidth={1.5}
                          opacity={0.9}
                          pointerEvents="none"
                        >
                          <animate
                            attributeName="r"
                            from={dot.r + 3}
                            to={dot.r + 10}
                            dur="0.9s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            from={0.9}
                            to={0}
                            dur="0.9s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      ) : null}
                    </g>
                  )
                })}
              </g>
            ))}
          </g>
        )
      })}

      {layout.hubs.map((hub) => (
        <g
          key={hub.peerId}
          data-testid="map-hub"
          data-peer={hub.peerId}
          opacity={focusOpacity(focusedPeer, hub.peerId)}
          style={{ cursor: 'pointer' }}
          onClick={(event) => {
            event.stopPropagation()
            onHubClick(hub.peerId)
          }}
        >
          <title>
            {focusedPeer === hub.peerId ? `Unfocus ${hub.peerId}` : `Focus on ${hub.peerId}`}
          </title>
          <circle cx={hub.x} cy={hub.y} r={20} fill="transparent" />
          <circle cx={hub.x} cy={hub.y} r={13} fill="#10141F" stroke="url(#hub-ring)" strokeWidth={2} />
          {isRadius ? renderMonthTicks(hub, conclusions) : null}
          <text x={hub.x} y={hub.y + 28} textAnchor="middle" fill="#DBE4F5" fontSize={12}>
            {hub.peerId}
          </text>
          {colorMode === 'age' ? renderHubAge(hub, lastLearned.get(hub.peerId), resolvedNowMs) : null}
        </g>
      ))}
    </svg>
  )
}

// Strata borrow (Radius mode only): faint month rim ticks around a
// hub — one tick per month present in that peer's data, spread evenly
// from the top of the hub ring in chronological order, each labelled
// with its short month name just outside the tick. Subtle by design
// (fog colour, low opacity); the page legend explains them.
function renderMonthTicks(hub: HubLayout, conclusions: Conclusion[]) {
  const ticks = monthTicksForPeer(conclusions, hub.peerId)
  return ticks.map((tick) => {
    const cos = Math.cos(tick.angle)
    const sin = Math.sin(tick.angle)
    return (
      <g key={tick.key} pointerEvents="none" opacity={0.55}>
        <line
          data-testid="month-rim-tick"
          data-peer={hub.peerId}
          data-month={tick.key}
          x1={hub.x + 15.5 * cos}
          y1={hub.y + 15.5 * sin}
          x2={hub.x + 19.5 * cos}
          y2={hub.y + 19.5 * sin}
          stroke="#9FB0CC"
          strokeWidth={1.2}
        />
        <text
          data-testid="month-rim-tick-label"
          data-peer={hub.peerId}
          data-month={tick.key}
          x={hub.x + 26 * cos}
          y={hub.y + 26 * sin + 2.5}
          textAnchor="middle"
          fill="#9FB0CC"
          fontSize={7.5}
        >
          {tick.label}
        </text>
      </g>
    )
  })
}

// Dusk hub extras (Age mode only): a "last learned Xd ago" line under
// the peer name, plus — for a peer quiet beyond the threshold — a
// soft FOG marker dot on the hub ring. Advisory only: fog, never red
// (red stays reserved for contradictions/errors).
function renderHubAge(
  hub: HubLayout,
  lastMs: number | undefined,
  nowMs: number,
) {
  if (lastMs === undefined) return null
  const quiet = isQuietPeer(lastMs, nowMs)
  return (
    <>
      <text
        x={hub.x}
        y={hub.y + 42}
        textAnchor="middle"
        fill={AGE_FOG_COLOR}
        fontSize={10}
        data-testid="hub-last-learned"
        data-peer={hub.peerId}
      >
        {lastLearnedLabel(lastMs, nowMs)}
      </text>
      {quiet ? (
        <circle
          cx={hub.x + 13}
          cy={hub.y - 13}
          r={3.5}
          fill={AGE_FOG_COLOR}
          data-testid="hub-quiet-marker"
          data-peer={hub.peerId}
        >
          <title>{`No new conclusions about ${hub.peerId} for over 30 days`}</title>
        </circle>
      ) : null}
    </>
  )
}

export function NetworkSvg({
  conclusions,
  peerIds,
  onEdgeClick,
}: {
  conclusions: Conclusion[]
  peerIds: string[]
  onEdgeClick: (observer: string, observed: string) => void
}) {
  const layout = layoutNetwork(conclusions, peerIds, MAP_WIDTH, MAP_HEIGHT)
  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="Peer network map"
      data-testid="network-svg"
    >
      <defs>
        <marker id="edge-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={9} markerHeight={9} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9FB0CC" />
        </marker>
        <linearGradient id="hub-ring-net" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6EA8FF" />
          <stop offset="100%" stopColor="#B79CFF" />
        </linearGradient>
      </defs>
      {layout.edges.map((entry) => {
        const key = `${entry.edge.observer}->${entry.edge.observed}`
        if (entry.edge.observer === entry.edge.observed) {
          return (
            <g key={key}>
              <circle cx={entry.x1} cy={entry.y1 - 22} r={12} fill="none" stroke={entry.color} strokeWidth={entry.width} />
              <text x={entry.x1 + 16} y={entry.y1 - 24} fill="#9FB0CC" fontSize={11}>
                self ×{entry.edge.count}
              </text>
            </g>
          )
        }
        return (
          <g key={key}>
            <line
              x1={entry.x1}
              y1={entry.y1}
              x2={entry.x2}
              y2={entry.y2}
              stroke="transparent"
              strokeWidth={14}
              style={{ cursor: 'pointer' }}
              onClick={() => onEdgeClick(entry.edge.observer, entry.edge.observed)}
            >
              <title>{`${entry.edge.observer} → ${entry.edge.observed}: ${entry.edge.count} conclusions`}</title>
            </line>
            <line
              x1={entry.x1}
              y1={entry.y1}
              x2={entry.x2}
              y2={entry.y2}
              stroke={entry.color}
              strokeWidth={entry.width}
              markerEnd="url(#edge-arrow)"
              pointerEvents="none"
            />
            <text
              x={(entry.x1 + entry.x2) / 2}
              y={(entry.y1 + entry.y2) / 2 - 6}
              textAnchor="middle"
              fill="#9FB0CC"
              fontSize={11}
              pointerEvents="none"
            >
              {entry.edge.count}
            </text>
          </g>
        )
      })}
      {layout.hubs.map((hub) => (
        <g key={hub.peerId}>
          <circle cx={hub.x} cy={hub.y} r={13} fill="#10141F" stroke="url(#hub-ring-net)" strokeWidth={2} />
          <text x={hub.x} y={hub.y + 28} textAnchor="middle" fill="#DBE4F5" fontSize={12}>
            {hub.peerId}
          </text>
        </g>
      ))}
    </svg>
  )
}
