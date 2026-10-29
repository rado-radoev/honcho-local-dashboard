import { useEffect, useState } from 'react'

// Hash-based routing: every main view has a stable URL (e.g.
// #/workspace/test-1/peers/alice?tab=chat) so views can be deep-linked,
// bookmarked, and captured by the screenshot script without a live server.

export type CloudPageId = 'members' | 'billing'

export interface ConclusionsRouteParams {
  observer: string
  observed: string
  level: string
  sessionId: string
}

export type Route =
  | { name: 'get-started' }
  | { name: 'explore' }
  | { name: 'memory-map', workspaceId: string | null }
  | { name: 'conclusions', workspaceId: string | null, filters: ConclusionsRouteParams }
  | { name: 'status' }
  | { name: 'performance' }
  | { name: 'playground' }
  | { name: 'api-keys' }
  | { name: 'webhooks' }
  | { name: 'settings' }
  | { name: 'cloud-only', page: CloudPageId }
  | { name: 'workspace', workspaceId: string }
  | { name: 'peers', workspaceId: string }
  | { name: 'peer', workspaceId: string, peerId: string, tab: string }
  | { name: 'sessions', workspaceId: string }
  | { name: 'session', workspaceId: string, sessionId: string, tab: string }

export const DEFAULT_PEER_TAB = 'search'
export const DEFAULT_SESSION_TAB = 'messages'

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'get-started':
      return '#/get-started'
    case 'explore':
      return '#/explore'
    case 'memory-map':
      return route.workspaceId ? `#/memory-map/${route.workspaceId}` : '#/memory-map'
    case 'conclusions': {
      const params = new URLSearchParams()
      if (route.filters.observer) params.set('observer', route.filters.observer)
      if (route.filters.observed) params.set('observed', route.filters.observed)
      if (route.filters.level) params.set('level', route.filters.level)
      if (route.filters.sessionId) params.set('session', route.filters.sessionId)
      const query = params.toString()
      const base = route.workspaceId ? `#/conclusions/${route.workspaceId}` : '#/conclusions'
      return query ? `${base}?${query}` : base
    }
    case 'status':
      return '#/status'
    case 'performance':
      return '#/performance'
    case 'playground':
      return '#/playground'
    case 'api-keys':
      return '#/api-keys'
    case 'webhooks':
      return '#/webhooks'
    case 'settings':
      return '#/settings'
    case 'cloud-only':
      return `#/cloud/${route.page}`
    case 'workspace':
      return `#/workspace/${route.workspaceId}`
    case 'peers':
      return `#/workspace/${route.workspaceId}/peers`
    case 'peer':
      return `#/workspace/${route.workspaceId}/peers/${route.peerId}?tab=${route.tab}`
    case 'sessions':
      return `#/workspace/${route.workspaceId}/sessions`
    case 'session':
      return `#/workspace/${route.workspaceId}/sessions/${route.sessionId}?tab=${route.tab}`
  }
}

export function parseHash(hash: string): Route {
  const withoutPrefix = hash.replace(/^#\/?/, '')
  const [pathPart, queryPart] = withoutPrefix.split('?')
  const segments = pathPart.split('/').filter((segment) => segment.length > 0)
  const params = new URLSearchParams(queryPart ?? '')

  if (segments.length === 0) return { name: 'explore' }
  if (segments[0] === 'get-started') return { name: 'get-started' }
  if (segments[0] === 'explore') return { name: 'explore' }
  if (segments[0] === 'memory-map') {
    return {
      name: 'memory-map',
      workspaceId: segments.length >= 2 ? decodeURIComponent(segments[1]) : null,
    }
  }
  if (segments[0] === 'conclusions') {
    return {
      name: 'conclusions',
      workspaceId: segments.length >= 2 ? decodeURIComponent(segments[1]) : null,
      filters: {
        observer: params.get('observer') ?? '',
        observed: params.get('observed') ?? '',
        level: params.get('level') ?? '',
        sessionId: params.get('session') ?? '',
      },
    }
  }
  if (segments[0] === 'status') return { name: 'status' }
  if (segments[0] === 'performance') return { name: 'performance' }
  if (segments[0] === 'playground') return { name: 'playground' }
  if (segments[0] === 'api-keys') return { name: 'api-keys' }
  if (segments[0] === 'webhooks') return { name: 'webhooks' }
  if (segments[0] === 'settings') return { name: 'settings' }
  if (segments[0] === 'cloud' && segments.length === 2) {
    if (segments[1] === 'performance') return { name: 'performance' }
    if (segments[1] === 'playground') return { name: 'playground' }
    if (segments[1] === 'api-keys') return { name: 'api-keys' }
    if (segments[1] === 'webhooks') return { name: 'webhooks' }
    return { name: 'cloud-only', page: segments[1] as CloudPageId }
  }
  if (segments[0] === 'workspace' && segments.length >= 2) {
    const workspaceId = decodeURIComponent(segments[1])
    if (segments.length === 2) return { name: 'workspace', workspaceId }
    if (segments[2] === 'peers' && segments.length === 3) return { name: 'peers', workspaceId }
    if (segments[2] === 'peers' && segments.length === 4) {
      return {
        name: 'peer',
        workspaceId,
        peerId: decodeURIComponent(segments[3]),
        tab: params.get('tab') ?? DEFAULT_PEER_TAB,
      }
    }
    if (segments[2] === 'sessions' && segments.length === 3) return { name: 'sessions', workspaceId }
    if (segments[2] === 'sessions' && segments.length === 4) {
      return {
        name: 'session',
        workspaceId,
        sessionId: decodeURIComponent(segments[3]),
        tab: params.get('tab') ?? DEFAULT_SESSION_TAB,
      }
    }
  }
  return { name: 'explore' }
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(route)
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash(window.location.hash))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return route
}
