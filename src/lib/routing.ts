import { useEffect, useState } from 'react'

// Hash-based routing: every main view has a stable URL (e.g.
// #/workspace/test-1/peers/alice?tab=chat) so views can be deep-linked,
// bookmarked, and captured by the screenshot script without a live server.

export type CloudPageId = 'performance' | 'playground' | 'api-keys' | 'webhooks' | 'members' | 'billing'

export type Route =
  | { name: 'get-started' }
  | { name: 'explore' }
  | { name: 'status' }
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
    case 'status':
      return '#/status'
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
  if (segments[0] === 'status') return { name: 'status' }
  if (segments[0] === 'cloud' && segments.length === 2) {
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
