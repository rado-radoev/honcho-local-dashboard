import type { Conclusion } from '../types'
import { LEVEL_COLORS } from '../lib/conclusions'
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  layoutConstellation,
  layoutNetwork,
  type DotLayout,
} from '../lib/memoryGraph'

// SVG rendering for the Memory Map (no canvas, no animation library).
// Constellation: peer hubs with gradient-ring strokes + conclusion dots.
// Network: aggregated directed edges between peer hubs. All coordinates
// come from the deterministic lib — this component only draws.

export function ConstellationSvg({
  conclusions,
  peerIds,
  selected,
  search,
  onSelect,
  onHover,
}: {
  conclusions: Conclusion[]
  peerIds: string[]
  selected: Conclusion | null
  search: string
  onSelect: (conclusion: Conclusion) => void
  onHover: (dot: DotLayout | null) => void
}) {
  const layout = layoutConstellation(conclusions, peerIds, MAP_WIDTH, MAP_HEIGHT)
  const dotById = new Map(layout.dots.map((dot) => [dot.conclusion.id, dot]))
  const needle = search.trim().toLowerCase()
  const selectedDot = selected ? dotById.get(selected.id) : undefined

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

      {layout.dots.map((dot) => {
        const matches = needle.length === 0 || dot.conclusion.content.toLowerCase().includes(needle)
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
            stroke={isSelected ? '#FFFFFF' : 'none'}
            strokeWidth={isSelected ? 1.5 : 0}
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
        <marker id="edge-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
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
