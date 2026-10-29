import { useState } from 'react'
import { Copy, KeyRound, Plus } from 'lucide-react'
import { useConnection } from '../state/connection'
import { ErrorBox, PageHeader } from '../components/ui'
import { dialogInputClass, dialogLabelClass, primaryButtonClass } from '../components/Dialog'
import type { CreateKeyOptions } from '../types'

function formatCreatedKey(created: unknown): string {
  if (typeof created === 'string') return created
  if (created === null) return ''
  return JSON.stringify(created, null, 2)
}

// API Keys — create-only, because that is all the self-hosted v3 API
// offers: POST /v3/keys (scope via query params) exists, but there is NO
// list or revoke endpoint, so a created key is shown exactly once here
// and can never be retrieved from the API again.
export function ApiKeysPage() {
  const { api, mode } = useConnection()
  const [scopeType, setScopeType] = useState<'admin' | 'workspace' | 'peer' | 'session' | 'scope'>('admin')
  const [workspaceId, setWorkspaceId] = useState('')
  const [peerId, setPeerId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [scopeId, setScopeId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [created, setCreated] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)

  async function createKey() {
    if (!api) return
    const options: CreateKeyOptions = {}
    if (scopeType === 'workspace' || scopeType === 'peer' || scopeType === 'session') {
      options.workspaceId = workspaceId.trim() || undefined
    }
    if (scopeType === 'peer') options.peerId = peerId.trim() || undefined
    if (scopeType === 'session') options.sessionId = sessionId.trim() || undefined
    if (scopeType === 'scope') options.scopeId = scopeId.trim() || undefined
    if (expiresAt.trim().length > 0) options.expiresAt = expiresAt.trim()
    setCreating(true)
    setError(null)
    setCopied(false)
    try {
      setCreated(await api.createKey(options))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Key creation failed')
      setCreated(null)
    }
    setCreating(false)
  }

  const createdText = formatCreatedKey(created)

  async function copyCreated() {
    try {
      await navigator.clipboard.writeText(createdText)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div>
      <PageHeader
        icon={<KeyRound className="h-6 w-6" />}
        title="API Keys"
        subtitle="Manage your API keys and access tokens."
      />

      <div className="max-w-2xl">
        <p className="mb-5 text-sm leading-relaxed text-fog">
          Create a key for this self-hosted instance. The v3 API can create keys but offers{' '}
          <span className="text-mist">no way to list or revoke them</span> — the key below is shown
          once, so copy and store it now.
          {mode === 'demo' ? ' Demo mode generates a clearly fake key locally; no server is called.' : ''}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void createKey()
          }}
          className="rounded-md border border-line bg-panel p-5"
        >
          <label className={dialogLabelClass} htmlFor="key-scope">
            SCOPE
          </label>
          <select
            id="key-scope"
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value as typeof scopeType)}
            className={dialogInputClass}
          >
            <option value="admin">Admin (no scope)</option>
            <option value="workspace">Workspace</option>
            <option value="peer">Peer</option>
            <option value="session">Session</option>
            <option value="scope">Scope (scope_id)</option>
          </select>

          {scopeType === 'workspace' || scopeType === 'peer' || scopeType === 'session' ? (
            <div className="mt-4">
              <label className={dialogLabelClass} htmlFor="key-workspace">
                WORKSPACE ID
              </label>
              <input
                id="key-workspace"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                className={dialogInputClass}
              />
            </div>
          ) : null}
          {scopeType === 'peer' ? (
            <div className="mt-4">
              <label className={dialogLabelClass} htmlFor="key-peer">
                PEER ID
              </label>
              <input
                id="key-peer"
                value={peerId}
                onChange={(event) => setPeerId(event.target.value)}
                className={dialogInputClass}
              />
            </div>
          ) : null}
          {scopeType === 'session' ? (
            <div className="mt-4">
              <label className={dialogLabelClass} htmlFor="key-session">
                SESSION ID
              </label>
              <input
                id="key-session"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                className={dialogInputClass}
              />
            </div>
          ) : null}
          {scopeType === 'scope' ? (
            <div className="mt-4">
              <label className={dialogLabelClass} htmlFor="key-scope-id">
                SCOPE ID
              </label>
              <input
                id="key-scope-id"
                value={scopeId}
                onChange={(event) => setScopeId(event.target.value)}
                className={dialogInputClass}
              />
            </div>
          ) : null}

          <div className="mt-4">
            <label className={dialogLabelClass} htmlFor="key-expires">
              EXPIRES AT (OPTIONAL, ISO 8601)
            </label>
            <input
              id="key-expires"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              placeholder="2027-01-01T00:00:00Z"
              className={dialogInputClass}
            />
          </div>

          <div className="mt-5">
            <button type="submit" disabled={creating} className={primaryButtonClass}>
              <span className="flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> {creating ? 'Creating…' : 'Create Key'}
              </span>
            </button>
          </div>
        </form>

        {error ? (
          <div className="mt-4">
            <ErrorBox message={error} />
          </div>
        ) : null}

        {created !== null ? (
          <div className="mt-5 rounded-md border border-green-900 bg-green-950/30 p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-green-200">
                {mode === 'demo' ? 'Demo key (fake — not a real credential)' : 'Your new API key — shown once'}
              </span>
              <button
                type="button"
                onClick={() => void copyCreated()}
                className="flex items-center gap-1.5 text-sm text-fog hover:text-mist"
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="overflow-auto rounded bg-ink-deep p-3 text-sm text-mist">{createdText}</pre>
            <p className="mt-2 text-xs text-fog">
              The API offers no way to list keys again — if you lose this value, create a new key.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
