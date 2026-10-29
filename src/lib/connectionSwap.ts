import type { HonchoApi } from '../api/honchoApi'
import { formatHealthError } from '../api/client'

// Validated server swap, shared by the Settings page (via the connection
// provider) and unit tests. The candidate connection is health-checked
// through the exact client machinery the app will use afterwards (bound
// fetch, resolveRequestBase proxy/loopback rules) BEFORE anything is
// applied: on failure the caller's current connection is left untouched
// and nothing is persisted; on success the caller-supplied `apply`
// callback performs the actual swap (persist + rebuild + invalidate).

export interface NewServerConnection {
  baseUrl: string
  token: string
}

export type ServerSwapResult = { ok: true } | { ok: false; error: string }

export interface ServerSwapDeps {
  // Build the candidate client for a (trimmed) connection — in the app
  // this is the same factory the connection provider uses for the live
  // client, so proxy resolution and fetch binding are identical.
  createCandidate: (connection: NewServerConnection) => HonchoApi
  // Perform the swap for a validated connection: persist it, rebuild the
  // active client, and invalidate the previous server's cached data.
  // Only ever called after the candidate's health check has passed.
  apply: (connection: NewServerConnection) => void
}

// Health-check one client exactly the way the connection provider's
// refresh does: GET /health must answer {"status":"ok"}. Returns null on
// success, otherwise the formatted error (which names the tried route).
export async function checkServerHealth(api: HonchoApi): Promise<string | null> {
  try {
    const result = await api.health()
    if (result.status === 'ok') return null
    const unexpected = new Error(`Unexpected health response: ${JSON.stringify(result)}`)
    return formatHealthError(unexpected, api)
  } catch (error) {
    return formatHealthError(error, api)
  }
}

export async function swapToNewServer(
  input: NewServerConnection,
  deps: ServerSwapDeps,
): Promise<ServerSwapResult> {
  const connection: NewServerConnection = {
    baseUrl: input.baseUrl.trim(),
    token: input.token.trim(),
  }
  const candidate = deps.createCandidate(connection)
  const error = await checkServerHealth(candidate)
  if (error !== null) return { ok: false, error }
  deps.apply(connection)
  return { ok: true }
}
