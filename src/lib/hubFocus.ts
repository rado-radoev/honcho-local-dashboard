// Hub focus mode math for the Memory Map constellation: clicking a
// peer hub dims every other peer's cluster and scales the focused
// peer's cluster up around its hub. Pure helpers only — the canvas
// applies the returned opacity / transform to per-peer SVG groups, so
// orbit rotation (an inner group's transform), tooltips, and dot
// clicks keep working untouched inside the scaled group.

// Non-focused clusters fade to this opacity while focus is active.
export const FOCUS_DIM_OPACITY = 0.15

export const FOCUS_MIN_SCALE = 1.3
export const FOCUS_MAX_SCALE = 1.6

// Scale for the focused peer's group. A lone peer has nothing to be
// focused against, so it never scales. Otherwise the scale grows
// gently with the peer count (more, smaller clusters need more help)
// and is clamped into [FOCUS_MIN_SCALE, FOCUS_MAX_SCALE]. Non-finite
// or non-positive counts degrade to no scale.
export function focusScale(peerCount: number): number {
  if (!Number.isFinite(peerCount)) return 1
  if (peerCount <= 1) return 1
  const raw = FOCUS_MIN_SCALE + 0.05 * (peerCount - 2)
  return Math.min(FOCUS_MAX_SCALE, Math.max(FOCUS_MIN_SCALE, raw))
}

// Opacity for one peer's cluster given the focused peer (null = no
// focus active, everything fully opaque).
export function focusOpacity(focusedPeer: string | null, peerId: string): number {
  if (focusedPeer === null) return 1
  if (focusedPeer === peerId) return 1
  return FOCUS_DIM_OPACITY
}

// SVG transform scaling `scale` around the hub point: the hub itself
// is the fixed point, so it stays exactly in place while its dots
// spread. Returns undefined at scale 1 so unfocused renders carry no
// transform attribute at all (byte-stable still captures).
export function focusTransform(
  hub: { x: number; y: number },
  scale: number,
): string | undefined {
  if (!Number.isFinite(scale)) return undefined
  if (scale === 1) return undefined
  return `translate(${hub.x} ${hub.y}) scale(${scale}) translate(${-hub.x} ${-hub.y})`
}
