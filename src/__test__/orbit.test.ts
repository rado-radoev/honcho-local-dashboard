import { describe, expect, it } from 'vitest'
import {
  angleAt,
  isStillSearch,
  orbitBandForDistance,
  orbitDirection,
  orbitPeriodMs,
  orbitRotationDeg,
  TAU,
} from '../lib/orbit'

// Orbit math: deterministic angle advancement, wrapping, ring-band
// periods/directions, and still-mode detection. The layout lib stays
// untouched — these helpers only rotate its output at render time.

describe('angleAt', () => {
  it('is deterministic: same inputs give the same angle', () => {
    expect(angleAt(1.2, 45_000, 180_000)).toBe(angleAt(1.2, 45_000, 180_000))
  })

  it('returns the base angle (normalized) at zero elapsed', () => {
    expect(angleAt(0.5, 0, 120_000)).toBeCloseTo(0.5)
    expect(angleAt(-Math.PI / 2, 0, 120_000)).toBeCloseTo((3 * Math.PI) / 2)
  })

  it('advances by the elapsed fraction of a full turn', () => {
    expect(angleAt(0, 30_000, 120_000)).toBeCloseTo(Math.PI / 2)
    expect(angleAt(1, 60_000, 120_000)).toBeCloseTo(1 + Math.PI)
  })

  it('wraps at exactly one period and over many periods', () => {
    expect(angleAt(0.25, 120_000, 120_000)).toBeCloseTo(0.25)
    expect(angleAt(0.25, 120_000 * 7 + 30_000, 120_000)).toBeCloseTo(0.25 + Math.PI / 2)
  })

  it('wraps negative elapsed back into [0, 2π)', () => {
    const angle = angleAt(0, -30_000, 120_000)
    expect(angle).toBeGreaterThanOrEqual(0)
    expect(angle).toBeLessThan(TAU)
    expect(angle).toBeCloseTo((3 * Math.PI) / 2)
  })

  it('falls back to the normalized base angle for a non-positive period', () => {
    expect(angleAt(7, 1_000, 0)).toBeCloseTo(7 - TAU)
  })
})

describe('ring bands', () => {
  it('maps distance to band by fixed shell width', () => {
    expect(orbitBandForDistance(0)).toBe(0)
    expect(orbitBandForDistance(27.9)).toBe(0)
    expect(orbitBandForDistance(28)).toBe(1)
    expect(orbitBandForDistance(100)).toBe(3)
  })

  it('keeps every period inside the 2–5 minute window', () => {
    for (let band = 0; band < 12; band += 1) {
      expect(orbitPeriodMs(band)).toBeGreaterThanOrEqual(120_000)
      expect(orbitPeriodMs(band)).toBeLessThanOrEqual(300_000)
    }
    expect(orbitPeriodMs(0)).toBe(120_000)
    expect(orbitPeriodMs(3)).toBe(300_000)
    expect(orbitPeriodMs(4)).toBe(120_000)
  })

  it('alternates direction between neighbouring bands', () => {
    expect(orbitDirection(0)).toBe(1)
    expect(orbitDirection(1)).toBe(-1)
    expect(orbitDirection(2)).toBe(1)
    expect(orbitDirection(3)).toBe(-1)
  })
})

describe('orbitRotationDeg', () => {
  it('is zero at zero elapsed for every band', () => {
    for (let band = 0; band < 6; band += 1) {
      expect(orbitRotationDeg(0, band)).toBe(0)
    }
  })

  it('rotates a quarter turn per quarter period, signed by band direction', () => {
    expect(orbitRotationDeg(30_000, 0)).toBeCloseTo(90)
    expect(orbitRotationDeg(45_000, 1)).toBeCloseTo(-90)
  })

  it('wraps back to zero at a full period and stays within (-360, 360)', () => {
    expect(orbitRotationDeg(120_000, 0)).toBeCloseTo(0)
    for (let elapsed = 0; elapsed < 900_000; elapsed += 7_919) {
      const deg = orbitRotationDeg(elapsed, 2)
      expect(deg).toBeGreaterThan(-360)
      expect(deg).toBeLessThan(360)
    }
  })

  it('agrees with angleAt for a dot starting at angle zero', () => {
    const elapsed = 50_000
    const band = 2
    const fromAngle = (angleAt(0, elapsed, orbitPeriodMs(band)) * 180) / Math.PI
    expect(orbitRotationDeg(elapsed, band)).toBeCloseTo(fromAngle)
  })
})

describe('isStillSearch', () => {
  it('detects ?still=1 alongside other params', () => {
    expect(isStillSearch('?demo=1&still=1')).toBe(true)
    expect(isStillSearch('?still=1')).toBe(true)
    expect(isStillSearch('?demo=1')).toBe(false)
    expect(isStillSearch('?still=0')).toBe(false)
    expect(isStillSearch('')).toBe(false)
  })
})
