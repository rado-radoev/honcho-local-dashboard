import { describe, expect, it } from 'vitest'
import {
  FOCUS_DIM_OPACITY,
  FOCUS_MAX_SCALE,
  FOCUS_MIN_SCALE,
  focusOpacity,
  focusScale,
  focusTransform,
} from '../lib/hubFocus'

// Hub focus math: focused-group scale (clamped, peer-count aware),
// dim opacity for the other clusters, and the scale-around-hub
// transform whose fixed point is the hub itself.

describe('focusScale', () => {
  it('never scales a lone peer (nothing to focus against)', () => {
    expect(focusScale(0)).toBe(1)
    expect(focusScale(1)).toBe(1)
  })

  it('starts at the minimum scale for two peers and grows with the count', () => {
    expect(focusScale(2)).toBeCloseTo(FOCUS_MIN_SCALE)
    expect(focusScale(3)).toBeCloseTo(1.35)
    expect(focusScale(4)).toBeCloseTo(1.4)
  })

  it('clamps at the maximum scale for crowded maps', () => {
    expect(focusScale(8)).toBeCloseTo(FOCUS_MAX_SCALE)
    expect(focusScale(50)).toBe(FOCUS_MAX_SCALE)
  })

  it('degrades to no scale for non-finite or negative counts', () => {
    expect(focusScale(Number.NaN)).toBe(1)
    expect(focusScale(Number.POSITIVE_INFINITY)).toBe(1)
    expect(focusScale(-3)).toBe(1)
  })

  it('stays inside the clamp window for every plausible peer count', () => {
    for (let count = 2; count <= 60; count += 1) {
      const scale = focusScale(count)
      expect(scale).toBeGreaterThanOrEqual(FOCUS_MIN_SCALE)
      expect(scale).toBeLessThanOrEqual(FOCUS_MAX_SCALE)
    }
  })
})

describe('focusOpacity', () => {
  it('is fully opaque for every peer when no focus is active', () => {
    expect(focusOpacity(null, 'alice')).toBe(1)
    expect(focusOpacity(null, 'bob')).toBe(1)
  })

  it('keeps the focused peer opaque and dims the rest to 15%', () => {
    expect(FOCUS_DIM_OPACITY).toBe(0.15)
    expect(focusOpacity('alice', 'alice')).toBe(1)
    expect(focusOpacity('alice', 'bob')).toBe(0.15)
    expect(focusOpacity('alice', 'claude')).toBe(0.15)
  })
})

describe('focusTransform', () => {
  it('is undefined at scale 1 so unfocused renders stay attribute-free', () => {
    expect(focusTransform({ x: 100, y: 80 }, 1)).toBeUndefined()
    expect(focusTransform({ x: 100, y: 80 }, Number.NaN)).toBeUndefined()
  })

  it('builds a translate-scale-translate around the hub point', () => {
    expect(focusTransform({ x: 100, y: 80 }, 1.35)).toBe(
      'translate(100 80) scale(1.35) translate(-100 -80)',
    )
  })

  it('keeps the hub as the fixed point of the transform', () => {
    // Applying translate(h) scale(s) translate(-h) to h itself:
    // h + s * (h - h) = h, for any scale.
    const hub = { x: 190, y: 95 }
    const scale = focusScale(3)
    const moved = {
      x: hub.x + scale * (hub.x - hub.x),
      y: hub.y + scale * (hub.y - hub.y),
    }
    expect(moved).toEqual(hub)
    expect(focusTransform(hub, scale)).toContain(`scale(${scale})`)
  })
})
