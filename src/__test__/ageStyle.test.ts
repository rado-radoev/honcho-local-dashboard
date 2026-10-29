import { describe, expect, it } from 'vitest'
import {
  AGE_FOG_COLOR,
  AGE_OPACITY_FLOOR,
  DAY_MS,
  QUIET_THRESHOLD_DAYS,
  ageFill,
  ageFraction,
  ageOpacity,
  ageSaturation,
  buildAgeContext,
  daysSince,
  isQuietPeer,
  lastLearnedByPeer,
  lastLearnedLabel,
  maxCreatedAtMs,
  type AgeContext,
} from '../lib/ageStyle'
import { buildHermesConclusions } from '../api/demoFixtures'
import type { Conclusion } from '../types'

// Dusk overlay: age fraction 0 at the reference "now", 1 at the
// dataset's oldest; opacity 1 → floor over that span, monotonic,
// never below the floor; hub last-learned + quiet markers are
// advisory (fog), computed from the same reference now.

const NOW = Date.parse('2026-10-28T00:00:00Z')
const OLDEST = NOW - 100 * DAY_MS
const CONTEXT: AgeContext = { nowMs: NOW, oldestMs: OLDEST }

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function makeConclusion(id: string, observed: string, createdMs: number): Conclusion {
  return {
    id,
    content: `content of ${id}`,
    observer_id: 'hermes',
    observed_id: observed,
    session_id: 's1',
    level: 'explicit',
    source_ids: [],
    source_message_ids: [],
    times_derived: 1,
    created_at: iso(createdMs),
  }
}

describe('ageOpacity', () => {
  it('is full strength (1) for a conclusion created at "now"', () => {
    expect(ageOpacity(iso(NOW), CONTEXT)).toBe(1)
    expect(ageOpacity(NOW, CONTEXT)).toBe(1)
  })

  it('floors the oldest conclusion at AGE_OPACITY_FLOOR (~25%)', () => {
    expect(AGE_OPACITY_FLOOR).toBe(0.25)
    expect(ageOpacity(iso(OLDEST), CONTEXT)).toBe(AGE_OPACITY_FLOOR)
  })

  it('never drops below the floor, even before the oldest', () => {
    expect(ageOpacity(iso(OLDEST - 500 * DAY_MS), CONTEXT)).toBe(AGE_OPACITY_FLOOR)
  })

  it('clamps future timestamps to full strength', () => {
    expect(ageOpacity(iso(NOW + 10 * DAY_MS), CONTEXT)).toBe(1)
  })

  it('is monotonic: newer is never fainter than older', () => {
    const stamps = [0, 10, 25, 50, 75, 90, 100].map((daysAgo) => NOW - daysAgo * DAY_MS)
    const opacities = stamps.map((ms) => ageOpacity(iso(ms), CONTEXT))
    for (let i = 1; i < opacities.length; i += 1) {
      expect(opacities[i]).toBeLessThan(opacities[i - 1])
    }
    expect(opacities[3]).toBeCloseTo(0.625)
  })

  it('returns full strength for a degenerate (zero-span) context', () => {
    const flat: AgeContext = { nowMs: NOW, oldestMs: NOW }
    expect(ageFraction(iso(NOW - 90 * DAY_MS), flat)).toBe(0)
    expect(ageOpacity(iso(NOW - 90 * DAY_MS), flat)).toBe(1)
  })

  it('returns full strength for an unparseable timestamp', () => {
    expect(ageOpacity('not-a-date', CONTEXT)).toBe(1)
  })
})

describe('ageFill / ageSaturation', () => {
  it('keeps the exact level colour for the newest dot', () => {
    expect(ageFill('#BCD6FF', iso(NOW), CONTEXT)).toBe('#BCD6FF')
    expect(ageSaturation(iso(NOW), CONTEXT)).toBe(1)
  })

  it('mixes the oldest dot toward fog', () => {
    // #BCD6FF mixed 55% toward #9FB0CC.
    expect(ageFill('#BCD6FF', iso(OLDEST), CONTEXT)).toBe('#ACC1E3')
    expect(ageSaturation(iso(OLDEST), CONTEXT)).toBeCloseTo(0.45)
    expect(AGE_FOG_COLOR).toBe('#9FB0CC')
  })

  it('passes unparseable colours through unchanged', () => {
    expect(ageFill('red', iso(OLDEST), CONTEXT)).toBe('red')
  })
})

describe('age context + last learned', () => {
  it('buildAgeContext finds the dataset oldest and keeps the supplied now', () => {
    const items = [
      makeConclusion('a', 'radoslav', NOW - 5 * DAY_MS),
      makeConclusion('b', 'radoslav', NOW - 40 * DAY_MS),
      makeConclusion('c', 'claude', NOW - 2 * DAY_MS),
    ]
    expect(buildAgeContext(items, NOW)).toEqual({ nowMs: NOW, oldestMs: NOW - 40 * DAY_MS })
    expect(buildAgeContext([], NOW)).toEqual({ nowMs: NOW, oldestMs: NOW })
    expect(maxCreatedAtMs(items)).toBe(NOW - 2 * DAY_MS)
    expect(maxCreatedAtMs([])).toBeNull()
  })

  it('lastLearnedByPeer keeps the newest conclusion per observed peer', () => {
    const items = [
      makeConclusion('a', 'radoslav', NOW - 5 * DAY_MS),
      makeConclusion('b', 'radoslav', NOW - 40 * DAY_MS),
      makeConclusion('c', 'claude', NOW - 2 * DAY_MS),
    ]
    const byPeer = lastLearnedByPeer(items)
    expect(byPeer.get('radoslav')).toBe(NOW - 5 * DAY_MS)
    expect(byPeer.get('claude')).toBe(NOW - 2 * DAY_MS)
  })

  it('daysSince floors partial days and never goes negative', () => {
    expect(daysSince(NOW - 36 * 60 * 60 * 1000, NOW)).toBe(1)
    expect(daysSince(NOW, NOW)).toBe(0)
    expect(daysSince(NOW + DAY_MS, NOW)).toBe(0)
  })

  it('lastLearnedLabel reads "today" / "Xd ago"', () => {
    expect(lastLearnedLabel(NOW - 3 * 60 * 60 * 1000, NOW)).toBe('last learned today')
    expect(lastLearnedLabel(NOW - DAY_MS, NOW)).toBe('last learned 1d ago')
    expect(lastLearnedLabel(NOW - 42 * DAY_MS, NOW)).toBe('last learned 42d ago')
  })

  it('isQuietPeer triggers only beyond 30 days', () => {
    expect(QUIET_THRESHOLD_DAYS).toBe(30)
    expect(isQuietPeer(NOW - QUIET_THRESHOLD_DAYS * DAY_MS, NOW)).toBe(false)
    expect(isQuietPeer(NOW - (QUIET_THRESHOLD_DAYS * DAY_MS + 1), NOW)).toBe(true)
    expect(isQuietPeer(NOW - 90 * DAY_MS, NOW)).toBe(true)
    expect(isQuietPeer(NOW, NOW)).toBe(false)
  })
})

describe('ageStyle — hermes demo determinism', () => {
  it('screenshot "now" = dataset max: the newest demo dot is full strength, the oldest is floored', () => {
    const items = buildHermesConclusions()
    const now = maxCreatedAtMs(items)
    expect(now).not.toBeNull()
    const context = buildAgeContext(items, now!)
    const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))
    expect(ageOpacity(sorted[sorted.length - 1].created_at, context)).toBe(1)
    expect(ageOpacity(sorted[0].created_at, context)).toBe(AGE_OPACITY_FLOOR)
  })
})
