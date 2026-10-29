import type { Page } from '../types'

// Work Item 5 audit (3.4.1 spec): every list endpoint's 200 response is
// `anyOf Page_* | CursorPage_*`. Page_* is {items,total,page,size,pages};
// CursorPage_* is {items,total|null,current_page,...} with NO page/size/
// pages fields. The old client cast the raw body straight to Page<T>, so
// a cursor-shaped response rendered CountBadge(total=null) and
// PaginationControls(pages=undefined) — counts blank, pagination broken.
// normalizePage accepts both shapes (and a bare items-only body) and
// always returns a complete Page<T>.
export function normalizePage<T>(raw: unknown, requestedPage = 1, requestedSize = 50): Page<T> {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const items = Array.isArray(body.items) ? (body.items as T[]) : []
  const total = typeof body.total === 'number' ? body.total : items.length
  const page = typeof body.page === 'number' ? body.page : requestedPage
  const size = typeof body.size === 'number' ? body.size : requestedSize
  const pages =
    typeof body.pages === 'number' ? body.pages : Math.max(1, Math.ceil(total / Math.max(1, size)))
  return { items, total, page, size, pages }
}

// Workspace/Peer/Session metadata+configuration are NOT in the spec's
// required lists, so a live server may omit them or send null. Pages
// assume records; coerce missing/null to {} at the client boundary.
export function ensureRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}
