import type { Conclusion } from '../types'
import { MAP_HEIGHT, MAP_WIDTH } from '../lib/memoryGraph'
import { densityFill, layoutThreadTimeline, type TimelineDot } from '../lib/threadTimeline'

// SVG rendering for the Memory Map's Thread-Timeline mode (Phase B):
// one horizontal lane per OBSERVED peer, x = created_at, derivation
// arcs bowing back to a conclusion's in-set sources. All geometry
// comes from the deterministic lib (threadTimeline.ts) — this
// component only draws. Past 500 visible conclusions the lib bins
// into day × lane density cells and only the selected + top-decile
// arcs survive (the lib enforces both).

const tickFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const tickYearFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: '2-digit',
  timeZone: 'UTC',
})

function tickLabel(atMs: number, spanMs: number): string {
  if (spanMs > 400 * 24 * 60 * 60 * 1000) return tickYearFormatter.format(new Date(atMs))
  return tickFormatter.format(new Date(atMs))
}

export function TimelineSvg({
  conclusions,
  peerIds,
  selected,
  search,
  playheadAt,
  still,
  onSelect,
}: {
  conclusions: Conclusion[]
  peerIds: string[]
  selected: Conclusion | null
  search: string
  // Birth-replay playhead (ISO created_at boundary from the page's
  // time scrubber), or null for the full range. Never drawn in still
  // mode, which renders the complete static timeline.
  playheadAt: string | null
  still: boolean
  onSelect: (conclusion: Conclusion) => void
}) {
  const layout = layoutThreadTimeline(conclusions, peerIds, selected?.id ?? null)
  const needle = search.trim().toLowerCase()
  const spanMs =
    layout.domainStartMs !== null && layout.domainEndMs !== null
      ? layout.domainEndMs - layout.domainStartMs
      : 0
  let playheadX: number | null = null
  if (playheadAt && !still && layout.domainStartMs !== null && layout.domainEndMs !== null) {
    const atMs = new Date(playheadAt).getTime()
    if (!Number.isNaN(atMs)) {
      const fraction = (atMs - layout.domainStartMs) / spanMs
      playheadX = layout.plotLeft + fraction * (layout.plotRight - layout.plotLeft)
    }
  }

  function renderDot(dot: TimelineDot, pinned: boolean) {
    const matches =
      needle.length === 0 || dot.conclusion.content.toLowerCase().includes(needle)
    const isSelected = selected?.id === dot.conclusion.id
    let opacity = matches ? 0.92 : 0.13
    if (pinned) opacity = 1
    return (
      <circle
        key={dot.conclusion.id}
        data-testid="timeline-dot"
        data-conclusion-id={dot.conclusion.id}
        cx={dot.x}
        cy={dot.y}
        r={isSelected ? dot.r + 2 : dot.r}
        fill={dot.color}
        opacity={opacity}
        stroke={isSelected ? '#FFFFFF' : 'transparent'}
        strokeWidth={isSelected ? 1.5 : 7}
        style={
          isSelected
            ? { filter: 'drop-shadow(0 0 6px rgba(183,156,255,0.9))', cursor: 'pointer' }
            : { cursor: 'pointer' }
        }
        onClick={(event) => {
          event.stopPropagation()
          onSelect(dot.conclusion)
        }}
      >
        <title>{dot.conclusion.content}</title>
      </circle>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="Memory thread timeline"
      data-testid="timeline-svg"
    >
      {/* Lane bands + labels (lane = observed peer). */}
      {layout.lanes.map((lane) => (
        <g key={lane.peerId}>
          {lane.index % 2 === 0 ? (
            <rect
              x={0}
              y={lane.y - lane.height / 2}
              width={MAP_WIDTH}
              height={lane.height}
              fill="rgba(219,228,245,0.03)"
            />
          ) : null}
          <line
            x1={layout.plotLeft}
            y1={lane.y + lane.height / 2}
            x2={layout.plotRight}
            y2={lane.y + lane.height / 2}
            stroke="#2A3350"
            strokeWidth={0.6}
          />
          <text
            x={layout.plotLeft - 8}
            y={lane.y + 4}
            textAnchor="end"
            fill="#DBE4F5"
            fontSize={12}
          >
            {lane.peerId}
          </text>
        </g>
      ))}

      {/* Time axis ticks. */}
      {layout.ticks.map((tick) => (
        <g key={tick.atMs}>
          <line
            x1={tick.x}
            y1={layout.plotTop - 6}
            x2={tick.x}
            y2={layout.plotBottom}
            stroke="#2A3350"
            strokeWidth={0.5}
            strokeDasharray="2 4"
          />
          <text x={tick.x} y={layout.plotTop - 12} textAnchor="middle" fill="#8EA3C7" fontSize={11}>
            {tickLabel(tick.atMs, spanMs)}
          </text>
        </g>
      ))}

      {/* Derivation arcs: subtle by default, the selected dot's arcs
          emphasized. A dashed arc flags a forward-in-time anomaly
          (source dated after its conclusion — see the lib). */}
      {layout.arcs.map((arc) => {
        let opacity = 0.16
        let strokeWidth = 1
        if (arc.emphasized) {
          opacity = 0.9
          strokeWidth = 1.6
        }
        return (
          <path
            key={`${arc.fromId}->${arc.toId}`}
            data-testid="timeline-arc"
            data-from={arc.fromId}
            data-to={arc.toId}
            d={arc.path}
            fill="none"
            stroke="#B79CFF"
            strokeWidth={strokeWidth}
            opacity={opacity}
            strokeDasharray={arc.forwardAnomaly ? '2 3' : undefined}
            pointerEvents="none"
          />
        )
      })}

      {/* Density cells (binned mode, > 500 visible). */}
      {layout.binned
        ? layout.cells.map((cell) => (
            <rect
              key={`${cell.laneIndex}:${cell.dayStartMs}`}
              data-testid="timeline-cell"
              x={cell.x}
              y={cell.y}
              width={cell.width}
              height={cell.height}
              rx={2}
              fill={densityFill(cell.count, layout.maxCellCount)}
              stroke={densityFill(cell.count, layout.maxCellCount)}
            >
              <title>{`${cell.peerId} · ${cell.count} conclusion(s) · mostly ${cell.dominantLevel}`}</title>
            </rect>
          ))
        : null}

      {/* Birth-replay playhead, driven by the page's time scrubber. */}
      {playheadX !== null ? (
        <g data-testid="timeline-playhead">
          <line
            x1={playheadX}
            y1={layout.plotTop - 6}
            x2={playheadX}
            y2={layout.plotBottom}
            stroke="#B79CFF"
            strokeWidth={1.4}
          />
          <circle cx={playheadX} cy={layout.plotTop - 6} r={3} fill="#B79CFF" />
        </g>
      ) : null}

      {layout.binned ? null : layout.dots.map((dot) => renderDot(dot, false))}
      {layout.binned && layout.selectedDot ? renderDot(layout.selectedDot, true) : null}

      {layout.total === 0 ? (
        <text
          x={MAP_WIDTH / 2}
          y={MAP_HEIGHT / 2}
          textAnchor="middle"
          fill="#8EA3C7"
          fontSize={14}
        >
          No conclusions in the current filters
        </text>
      ) : null}
      {layout.binned ? (
        <text x={layout.plotLeft} y={MAP_HEIGHT - 4} fill="#8EA3C7" fontSize={11}>
          {`Density view — ${layout.total} conclusions binned by day × peer; arcs shown for the selected + most-derived conclusions`}
        </text>
      ) : null}
    </svg>
  )
}
