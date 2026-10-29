import { useEffect, useRef, type RefObject } from 'react'
import type { Conclusion } from '../types'
import { LEVEL_COLORS } from '../lib/conclusions'
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  layoutConstellation,
  layoutNetwork,
  type DotLayout,
  type HubLayout,
} from '../lib/memoryGraph'
import { orbitBandForDistance, orbitRotationDeg } from '../lib/orbit'
import type { StableSlot } from '../lib/stableLayout'

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
): OrbitGroup[] {
  const hubByPeer = new Map(hubs.map((hub) => [hub.peerId, hub]))
  const groups = new Map<string, OrbitGroup>()
  for (const dot of dots) {
    const hub = hubByPeer.get(dot.peerId)
    if (!hub) continue
    const band = orbitBandForDistance(Math.hypot(dot.x - hub.x, dot.y - hub.y))
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

export function ConstellationSvg({
  conclusions,
  peerIds,
  selected,
  search,
  motion,
  slots,
  onSelect,
  onHover,
}: {
  conclusions: Conclusion[]
  peerIds: string[]
  selected: Conclusion | null
  search: string
  motion: boolean
  slots?: ReadonlyMap<string, StableSlot>
  onSelect: (conclusion: Conclusion) => void
  onHover: (dot: DotLayout | null) => void
}) {
  const layout = layoutConstellation(conclusions, peerIds, MAP_WIDTH, MAP_HEIGHT)
  const dots = applyStableSlots(layout.dots, layout.hubs, slots)
  const dotById = new Map(dots.map((dot) => [dot.conclusion.id, dot]))
  const needle = search.trim().toLowerCase()
  const selectedDot = selected ? dotById.get(selected.id) : undefined
  const groups = buildOrbitGroups(dots, layout.hubs)
  const groupRefs = useRef(new Map<string, GroupHandle>())

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

      {/* Derivation edges stay at base angles (the simpler correct
          option): they are drawn from the deterministic layout, not
          from the rotating groups, so a selected dot's orbit does not
          drag its source chain around. */}
      {selectedDot
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
            <g key={cell.peerId}>
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

      {groups.map((group) => (
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
            return (
              <circle
                key={dot.conclusion.id}
                data-testid="map-dot"
                cx={dot.x}
                cy={dot.y}
                r={isSelected ? dot.r + 2 : dot.r}
                fill={dot.color}
                opacity={matches ? 0.9 : 0.13}
                stroke={isSelected ? '#FFFFFF' : 'transparent'}
                strokeWidth={isSelected ? 1.5 : 7}
                style={
                  isSelected
                    ? { filter: 'drop-shadow(0 0 6px rgba(183,156,255,0.9))', cursor: 'pointer' }
                    : { cursor: 'pointer' }
                }
                onMouseEnter={() => onHover(dot)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelect(dot.conclusion)}
              >
                <title>{dot.conclusion.content}</title>
              </circle>
            )
          })}
        </g>
      ))}

      {layout.hubs.map((hub) => (
        <g key={hub.peerId}>
          <circle cx={hub.x} cy={hub.y} r={13} fill="#10141F" stroke="url(#hub-ring)" strokeWidth={2} />
          <text x={hub.x} y={hub.y + 28} textAnchor="middle" fill="#DBE4F5" fontSize={12}>
            {hub.peerId}
          </text>
        </g>
      ))}
    </svg>
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
