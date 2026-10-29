// Pure orbit math for the Memory Map constellation animation.
//
// Dots keep the radius and base angle the deterministic layout
// (memoryGraph.ts) gave them; this module only answers "how far has a
// ring band rotated after elapsedMs". No randomness, no Date.now, no
// DOM — the component feeds it elapsed time from its rAF loop and
// applies the result as an SVG group transform.

export const TAU = Math.PI * 2

// Ring bands are concentric shells around a hub, this wide in layout
// pixels. Dots in the same band share a period + direction, so a whole
// band is one rotating <g> (a handful of transforms per frame, never
// per-dot work).
export const ORBIT_BAND_WIDTH_PX = 28

// Full revolution per band: 2–5 minutes, cycling by band index so
// neighbouring bands visibly differ, direction alternating per band.
export const ORBIT_MIN_PERIOD_MS = 120_000
export const ORBIT_PERIOD_STEP_MS = 60_000
export const ORBIT_PERIOD_VARIANTS = 4

function normalizeAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU
}

// Angle of a dot at `elapsedMs` into its orbit: base angle advanced by
// the elapsed fraction of one period, wrapped into [0, 2π). Pure and
// deterministic — same inputs, same angle, including negative elapsed.
export function angleAt(baseAngle: number, elapsedMs: number, periodMs: number): number {
  if (!(periodMs > 0)) return normalizeAngle(baseAngle)
  return normalizeAngle(baseAngle + (elapsedMs / periodMs) * TAU)
}

export function orbitBandForDistance(distancePx: number): number {
  if (!(distancePx > 0)) return 0
  return Math.floor(distancePx / ORBIT_BAND_WIDTH_PX)
}

export function orbitPeriodMs(band: number): number {
  const index = Math.abs(Math.trunc(band)) % ORBIT_PERIOD_VARIANTS
  return ORBIT_MIN_PERIOD_MS + index * ORBIT_PERIOD_STEP_MS
}

export function orbitDirection(band: number): 1 | -1 {
  return Math.abs(Math.trunc(band)) % 2 === 0 ? 1 : -1
}

// Rotation (degrees, in (-360, 360)) for a whole band group at
// `elapsedMs`, ready for an SVG `rotate(deg cx cy)` transform.
export function orbitRotationDeg(elapsedMs: number, band: number): number {
  const period = orbitPeriodMs(band)
  const fraction = (((elapsedMs % period) + period) % period) / period
  const deg = orbitDirection(band) * fraction * 360
  return deg === 0 ? 0 : deg
}

// Still mode (`?still=1`, used by the screenshot script alongside
// `?demo=1`): forces constellation motion off so captures render dots
// at their base angles and stay byte-stable across runs.
export function isStillSearch(search: string): boolean {
  return new URLSearchParams(search).get('still') === '1'
}
