// New-memory detection for the Memory Map: which conclusion ids in a
// refreshed dataset were not in the previous one. Pure and total —
// the page feeds it the previous id set (or null on first load) and
// the next dataset's ids, and animates a one-shot birth ring for
// exactly the ids this returns.
//
// First load NEVER pulses: a null/undefined previous set means there
// is nothing to diff against, so the result is always empty — the
// whole first dataset is "new" only in the trivial sense, and ringing
// 120 dots on mount would be noise. Removals are ignored by
// construction (they simply never appear in the next set).

export const BIRTH_RING_MS = 2400

export function diffConclusionIds(
  prevIds: Iterable<string> | null | undefined,
  nextIds: Iterable<string>,
): string[] {
  if (prevIds === null || prevIds === undefined) return []
  const prev = new Set(prevIds)
  const seen = new Set<string>()
  const fresh: string[] = []
  for (const id of nextIds) {
    if (prev.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    fresh.push(id)
  }
  return fresh
}
