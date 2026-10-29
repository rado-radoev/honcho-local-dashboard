import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { HonchoApi } from '../api/honchoApi'
import { HonchoClient, formatHealthError, shouldUseProxy } from '../api/client'
import { DemoHonchoApi } from '../api/demoClient'
import { swapToNewServer, type ServerSwapResult } from '../lib/connectionSwap'

// Connection settings are persisted in localStorage so a refresh keeps the
// session. The token is stored only in the browser, on this machine, and is
// sent solely to the configured Honcho server.

const STORAGE_KEY = 'honcho-dashboard:connection:v1'
export const DEFAULT_BASE_URL = 'http://localhost:8000'

export type ConnectionMode = 'live' | 'demo'
export type HealthState = 'unknown' | 'checking' | 'connected' | 'failed'

interface SavedConnection {
  mode: ConnectionMode
  baseUrl: string
  token: string
}

interface ConnectionContextValue {
  api: HonchoApi | null
  mode: ConnectionMode | null
  baseUrl: string
  // The token saved with the current connection ('' when none / demo).
  // Exposed so Settings can prefill its editable token field.
  token: string
  // Route requests actually take (proxy vs direct, exact URL) — null when
  // no connection is active. Surfaced on the Get Started page so even a
  // working connection documents its path.
  routeDescription: string | null
  health: HealthState
  healthError: string | null
  connect: (baseUrl: string, token: string) => Promise<void>
  // Settings-page server change: health-checks the NEW server first and
  // only swaps (persist + rebuild + invalidate) when that passes. On
  // failure the current connection is untouched and nothing is saved.
  updateConnection: (baseUrl: string, token: string) => Promise<ServerSwapResult>
  startDemo: () => void
  disconnect: () => void
  refreshHealth: () => Promise<void>
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

function loadSavedConnection(): SavedConnection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedConnection
    if (parsed.mode !== 'live' && parsed.mode !== 'demo') return null
    return parsed
  } catch {
    return null
  }
}

function saveConnection(value: SavedConnection | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    }
  } catch {
    // Storage unavailable (private mode etc.) — connection still works
    // for this session, it just won't persist.
  }
}

// The one place live clients are built — the active connection, the
// Settings candidate health check, everything goes through here, so the
// bound fetch and resolveRequestBase proxy logic are identical for all.
function createLiveApi(baseUrl: string, token: string): HonchoApi {
  return new HonchoClient({
    baseUrl,
    token: token || undefined,
    proxyTarget: import.meta.env.VITE_HONCHO_TARGET || undefined,
    // MODE, not DEV: a preview build is a production bundle (DEV=false)
    // served by `vite preview`, which does provide the /honcho-api proxy.
    useProxy: shouldUseProxy(import.meta.env.MODE),
  })
}

function createApi(saved: SavedConnection): HonchoApi {
  if (saved.mode === 'demo') return new DemoHonchoApi()
  return createLiveApi(saved.baseUrl, saved.token)
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<SavedConnection | null>(null)
  const [routeDescription, setRouteDescription] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthState>('unknown')
  const [healthError, setHealthError] = useState<string | null>(null)
  const apiRef = useRef<HonchoApi | null>(null)

  const applyConnection = useCallback((next: SavedConnection | null) => {
    // Invalidate the outgoing client's server-derived state (conclusions
    // cache + stats collector) before it is dropped, so nothing from the
    // old server can surface through a stale reference. The incoming
    // client is freshly built below and starts with empty caches anyway.
    apiRef.current?.clearServerData()
    const api = next === null ? null : createApi(next)
    apiRef.current = api
    setRouteDescription(api?.routeDescription() ?? null)
    setSaved(next)
    saveConnection(next)
    setHealth(next === null ? 'unknown' : 'checking')
    setHealthError(null)
  }, [])

  const refreshHealth = useCallback(async () => {
    const api = apiRef.current
    if (!api) return
    setHealth('checking')
    try {
      const result = await api.health()
      if (result.status === 'ok') {
        setHealth('connected')
        setHealthError(null)
      } else {
        setHealth('failed')
        const unexpected = new Error(`Unexpected health response: ${JSON.stringify(result)}`)
        setHealthError(formatHealthError(unexpected, api))
      }
    } catch (error) {
      setHealth('failed')
      setHealthError(formatHealthError(error, api))
    }
  }, [])

  // Restore a saved connection on first load. `?demo=1` in the URL forces
  // demo mode (used by the screenshot script and for shareable previews).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') {
      applyConnection({ mode: 'demo', baseUrl: 'demo://fixtures', token: '' })
      return
    }
    const restored = loadSavedConnection()
    if (restored) applyConnection(restored)
  }, [applyConnection])

  useEffect(() => {
    if (saved !== null) {
      void refreshHealth()
    }
  }, [saved, refreshHealth])

  const connect = useCallback(
    async (baseUrl: string, token: string) => {
      applyConnection({ mode: 'live', baseUrl: baseUrl.trim(), token: token.trim() })
    },
    [applyConnection],
  )

  const updateConnection = useCallback(
    async (baseUrl: string, token: string): Promise<ServerSwapResult> => {
      return swapToNewServer(
        { baseUrl, token },
        {
          createCandidate: (connection) => createLiveApi(connection.baseUrl, connection.token),
          apply: (connection) => {
            applyConnection({ mode: 'live', baseUrl: connection.baseUrl, token: connection.token })
          },
        },
      )
    },
    [applyConnection],
  )

  const startDemo = useCallback(() => {
    applyConnection({ mode: 'demo', baseUrl: 'demo://fixtures', token: '' })
  }, [applyConnection])

  const disconnect = useCallback(() => {
    applyConnection(null)
  }, [applyConnection])

  const value = useMemo<ConnectionContextValue>(
    () => ({
      api: saved === null ? null : apiRef.current,
      mode: saved?.mode ?? null,
      baseUrl: saved?.baseUrl ?? DEFAULT_BASE_URL,
      token: saved?.token ?? '',
      routeDescription,
      health,
      healthError,
      connect,
      updateConnection,
      startDemo,
      disconnect,
      refreshHealth,
    }),
    [
      saved,
      routeDescription,
      health,
      healthError,
      connect,
      updateConnection,
      startDemo,
      disconnect,
      refreshHealth,
    ],
  )

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext)
  if (!context) throw new Error('useConnection must be used inside ConnectionProvider')
  return context
}
