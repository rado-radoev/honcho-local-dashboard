import type { Message } from '../types'
import { formatDateTime, peerChipClass } from '../lib/format'
import { EmptyState } from './ui'

// Message rows in the cloud session view style: colored peer chip, rule
// line, right-aligned timestamp, content indented below. Optionally shows
// the session each message belongs to (used by search results).
export function MessageList({
  messages,
  showSession = false,
  emptyText = 'No messages.',
}: {
  messages: Message[]
  showSession?: boolean
  emptyText?: string
}) {
  if (messages.length === 0) return <EmptyState>{emptyText}</EmptyState>

  return (
    <div className="flex flex-col">
      {messages.map((message) => (
        <article key={message.id} className="border-b border-line py-3">
          <div className="flex items-center gap-3">
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold ${peerChipClass(message.peer_id)}`}
            >
              {message.peer_id}
            </span>
            <span className="h-px flex-1 bg-line" />
            {showSession ? (
              <span className="text-xs text-fog">in {message.session_id}</span>
            ) : null}
            <time className="text-xs text-fog">{formatDateTime(message.created_at)}</time>
          </div>
          <p className="mt-2 whitespace-pre-wrap pl-1 text-sm leading-relaxed text-mist">
            {message.content}
          </p>
        </article>
      ))}
    </div>
  )
}
