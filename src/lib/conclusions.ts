import type { CappedConclusions, Conclusion, ConclusionLevel, Page } from '../types'

// Shared conclusion constants + the capped fetch used by the Overview,
// Memory Map, and Conclusions Explorer. Kept in a shared module (not a
// component) per the standing rule for status/style constants.

export const CONCLUSION_PAGE_SIZE = 100
export const CONCLUSION_CONCURRENCY = 4
export const CONCLUSIONS_CAP = 2000
export const CONCLUSIONS_CACHE_MS = 60_000

export const LEVEL_COLORS: Record<ConclusionLevel, string> = {
  explicit: '#BCD6FF',
  deductive: '#6EA8FF',
  inductive: '#B79CFF',
  contradiction: '#FF7A7A',
}

export const CONCLUSION_LEVELS: ConclusionLevel[] = [
  'explicit',
  'deductive',
  'inductive',
  'contradiction',
]

// The ONE gradient allowed by the design law: chart strokes, map hub
// rings, and the hero top rule only.
export const ACCENT_GRADIENT = 'linear-gradient(135deg,#6EA8FF,#B79CFF)'

export function cappedLabel(result: CappedConclusions): string {
  if (result.capped) return `latest ${result.items.length} of ${result.total}`
  return `${result.total} conclusions`
}

type PageFetcher = (page: number, size: number) => Promise<Page<Conclusion>>

// Fetch conclusions page by page (size 100, at most 4 requests in flight)
// until the server total is exhausted or the hard cap is reached. Items
// are deduped by id, preserving server order.
export async function fetchConclusionsCapped(fetchPage: PageFetcher): Promise<CappedConclusions> {
  const first = await fetchPage(1, CONCLUSION_PAGE_SIZE)
  const total = first.total
  const wanted = Math.min(total, CONCLUSIONS_CAP)
  const pageCount = Math.max(1, Math.ceil(wanted / CONCLUSION_PAGE_SIZE))
  const byPage: Conclusion[][] = [first.items]
  let nextPage = 2
  while (nextPage <= pageCount) {
    const batch: number[] = []
    while (batch.length < CONCLUSION_CONCURRENCY && nextPage <= pageCount) {
      batch.push(nextPage)
      nextPage += 1
    }
    const results = await Promise.all(batch.map(async (page) => fetchPage(page, CONCLUSION_PAGE_SIZE)))
    for (const result of results) byPage.push(result.items)
  }
  const seen = new Set<string>()
  const items: Conclusion[] = []
  for (const pageItems of byPage) {
    for (const item of pageItems) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
      if (items.length >= CONCLUSIONS_CAP) break
    }
    if (items.length >= CONCLUSIONS_CAP) break
  }
  return { items, total, capped: total > items.length }
}

// Filter a capped set in memory (Explorer filters over the capped set use
// the server-side list filters instead; this is for demo parity + tests).
export function filterConclusions(
  items: Conclusion[],
  filters: { level?: string; observer_id?: string; observed_id?: string; session_id?: string },
): Conclusion[] {
  return items.filter((item) => {
    if (filters.level && item.level !== filters.level) return false
    if (filters.observer_id && item.observer_id !== filters.observer_id) return false
    if (filters.observed_id && item.observed_id !== filters.observed_id) return false
    if (filters.session_id && item.session_id !== filters.session_id) return false
    return true
  })
}
