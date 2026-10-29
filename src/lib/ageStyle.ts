import type { Conclusion } from '../types'

// Dusk overlay math (Phase C2): how a conclusion's age — relative to
// a reference "now" and the dataset's oldest conclusion — fades its
// constellation dot. Pure and deterministic: callers supply `nowMs`
// (live mode passes the real clock; demo/screenshot mode passes the
// dataset's max created_at, so baselines stay byte-stable).
//
// Age fraction 0 = created at `now`, 1 = the dataset's oldest. Opacity
// goes 1 → AGE_OPACITY_FLOOR over that span and never below the
// floor, so the oldest memory is faded, never invisible. Saturation
// fades alongside it by mixing the dot's level colour toward fog.

export const AGE_OPACITY_FLOOR = 0.25
export const QUIET_THRESHOLD_DAYS = 30
export const DAY_MS = 24 * 60 * 60 * 1000
// Theme fog (#9FB0CC, --color-fog in index.css) as the desaturation
// target and the quiet-peer marker colour. Advisory only — red stays
// reserved for contradictions/errors.
export const AGE_FOG_COLOR = '#9FB0CC'
// How far an age-fraction-1 dot's colour mixes toward fog.
export const AGE_DESATURATE_MAX = 0.55

export interface AgeContext {
  nowMs: number
  oldestMs: number
}

function toMs(value: string | number): number {
  if (typeof value === 'number') return value
  return Date.parse(value)
}

export function maxCreatedAtMs(items: Conclusion[]): number | null {
  let max: number | null = null
  for (const item of items) {
    const ms = Date.parse(item.created_at)
    if (Number.isNaN(ms)) continue
    if (max === null || ms > max) max = ms
  }
  return max
}

export function buildAgeContext(items: Conclusion[], nowMs: number): AgeContext {
  let oldest = nowMs
  for (const item of items) {
    const ms = Date.parse(item.created_at)
    if (Number.isNaN(ms)) continue
    if (ms < oldest) oldest = ms
  }
  return { nowMs, oldestMs: oldest }
}

// 0 = created at `now` (or in the future), 1 = created at (or before)
// the dataset's oldest. A degenerate span (every conclusion at the
// same instant, or an empty set) yields 0 — everything is "newest".
export function ageFraction(createdAt: string | number, context: AgeContext): number {
  const createdMs = toMs(createdAt)
  if (Number.isNaN(createdMs)) return 0
  const span = context.nowMs - context.oldestMs
  if (!(span > 0)) return 0
  const fraction = (context.nowMs - createdMs) / span
  if (fraction < 0) return 0
  if (fraction > 1) return 1
  return fraction
}

export function ageOpacity(createdAt: string | number, context: AgeContext): number {
  const fraction = ageFraction(createdAt, context)
  return 1 - fraction * (1 - AGE_OPACITY_FLOOR)
}

// Saturation multiplier mirroring the opacity curve: 1 for the
// newest, 1 - AGE_DESATURATE_MAX for the oldest.
export function ageSaturation(createdAt: string | number, context: AgeContext): number {
  return 1 - ageFraction(createdAt, context) * AGE_DESATURATE_MAX
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function toHexChannel(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')
}

// The dot fill in Age mode: the level colour mixed toward fog by the
// age fraction (newest keeps its exact level colour). Unparseable
// colours pass through unchanged.
export function ageFill(hex: string, createdAt: string | number, context: AgeContext): string {
  const rgb = parseHex(hex)
  const fog = parseHex(AGE_FOG_COLOR)
  if (!rgb || !fog) return hex
  const t = ageFraction(createdAt, context) * AGE_DESATURATE_MAX
  const mixed = rgb.map((channel, index) => channel + (fog[index] - channel) * t)
  return `#${mixed.map(toHexChannel).join('')}`.toUpperCase()
}

// Latest created_at (ms) per observed peer — when Hermes last
// learned something about each hub peer.
export function lastLearnedByPeer(items: Conclusion[]): Map<string, number> {
  const byPeer = new Map<string, number>()
  for (const item of items) {
    const ms = Date.parse(item.created_at)
    if (Number.isNaN(ms)) continue
    const current = byPeer.get(item.observed_id)
    if (current === undefined || ms > current) byPeer.set(item.observed_id, ms)
  }
  return byPeer
}

// Whole days elapsed from `thenMs` to `nowMs`, floored at 0 (a
// future timestamp is "today", never negative).
export function daysSince(thenMs: number, nowMs: number): number {
  const elapsed = nowMs - thenMs
  if (!(elapsed > 0)) return 0
  return Math.floor(elapsed / DAY_MS)
}

export function lastLearnedLabel(thenMs: number, nowMs: number): string {
  const days = daysSince(thenMs, nowMs)
  if (days === 0) return 'last learned today'
  return `last learned ${days}d ago`
}

// Advisory only: a peer whose newest conclusion is beyond the quiet
// threshold. Callers render this in fog, never red.
export function isQuietPeer(thenMs: number, nowMs: number): boolean {
  return nowMs - thenMs > QUIET_THRESHOLD_DAYS * DAY_MS
}
