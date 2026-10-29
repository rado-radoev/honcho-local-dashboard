import { useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { useConnection } from '../state/connection'
import { ErrorBox, Spinner } from '../components/ui'
import { LEVEL_COLORS } from '../lib/conclusions'
import { REASONING_LEVELS, type ReasoningLevel, type WorkspaceChatResult } from '../types'

// Workspace Chat tab: POST /v3/workspaces/{id}/chat with
// include_evidence:true, non-streaming. The evidence panel shows exactly
// what the dialectic agent read (conclusions + message refs + tools).

export function WorkspaceChatTab({ workspaceId }: { workspaceId: string }) {
  const { api } = useConnection()
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<ReasoningLevel>('low')
  const [result, setResult] = useState<WorkspaceChatResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  async function ask() {
    if (!api || query.trim().length === 0) return
    setAsking(true)
    setError(null)
    try {
      setResult(await api.chatWorkspace(workspaceId, query.trim(), level))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Workspace chat failed')
    }
    setAsking(false)
  }

  return (
    <section aria-label="Workspace chat">
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-mist">
        <MessageSquare className="h-5 w-5" /> Workspace Chat
      </h3>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-fog">
        Ask about the whole workspace — the dialectic agent reasons over every peer, not just
        one. Answers include the evidence the agent read.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void ask()
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Ask about workspace ${workspaceId}…`}
          className="w-full max-w-xl rounded-md border border-line bg-panel px-3 py-2.5 text-sm text-mist outline-none focus:border-fog"
        />
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value as ReasoningLevel)}
          className="rounded-md border border-line bg-panel px-2.5 py-2.5 text-sm text-mist outline-none"
          aria-label="Reasoning level"
        >
          {REASONING_LEVELS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={asking}
          className="flex items-center gap-1.5 rounded-md bg-badge px-4 py-2.5 text-sm font-semibold text-badge-ink hover:brightness-110 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> Ask
        </button>
      </form>

      {asking ? <Spinner label="Thinking…" /> : null}
      {error ? (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      ) : null}

      {result && !asking ? (
        <div className="mt-5 grid items-start gap-4 xl:grid-cols-[1fr_320px]">
          <div className="card-shell p-5">
            <h4 className="mb-2 text-xs tracking-widest text-fog">ANSWER</h4>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-mist">
              {result.content ?? 'The agent returned no content.'}
            </p>
          </div>
          {result.evidence ? (
            <div className="card-shell p-5" aria-label="Evidence">
              <h4 className="mb-2 text-xs tracking-widest text-fog">EVIDENCE — WHAT THE AGENT READ</h4>
              {result.evidence.conclusions.length > 0 ? (
                <>
                  <p className="mb-1 text-xs text-fog">
                    Conclusions ({result.evidence.conclusions.length})
                  </p>
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {result.evidence.conclusions.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-2 text-xs text-mist">
                        <span
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: LEVEL_COLORS[entry.level] }}
                        />
                        <span>{entry.content}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {result.evidence.messages.length > 0 ? (
                <>
                  <p className="mb-1 text-xs text-fog">Messages ({result.evidence.messages.length})</p>
                  <ul className="mb-3 flex flex-col gap-1 text-xs text-fog">
                    {result.evidence.messages.map((entry) => (
                      <li key={entry.id}>
                        {entry.id} · {entry.peer_id} in {entry.session_id}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="text-xs text-fog">
                Tool calls: {result.evidence.tool_calls.length}
              </p>
            </div>
          ) : (
            <div className="card-shell p-5 text-sm text-fog">
              No evidence returned for this answer.
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
