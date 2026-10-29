import { useState } from 'react'
import { Download } from 'lucide-react'
import { useConnection } from '../state/connection'
import type { Conclusion } from '../types'

// Peer export: peer card + representation + conclusions (capped set,
// observed = this peer) downloaded as JSON or Markdown. Generated
// entirely client-side from data the dashboard already fetches.

interface PeerExportData {
  peer: string
  workspace: string
  exportedFrom: string
  card: string[] | null
  representation: string
  conclusions: Conclusion[]
  conclusionsTotal: number
  conclusionsCapped: boolean
}

function download(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function toMarkdown(data: PeerExportData): string {
  const lines: string[] = [`# Peer: ${data.peer}`, '', `Workspace: ${data.workspace}`, '']
  lines.push('## Peer Card')
  if (data.card && data.card.length > 0) {
    for (const fact of data.card) lines.push(`- ${fact}`)
  } else {
    lines.push('(no card)')
  }
  lines.push('', '## Representation', '', data.representation || '(none)', '')
  lines.push(`## Conclusions (${data.conclusions.length} of ${data.conclusionsTotal})`)
  for (const conclusion of data.conclusions) {
    lines.push(
      `- [${conclusion.level}] ${conclusion.content} — ${conclusion.observer_id} → ${conclusion.observed_id}, ${conclusion.created_at}`,
    )
  }
  return lines.join('\n')
}

export function PeerExportButtons({
  workspaceId,
  peerId,
}: {
  workspaceId: string
  peerId: string
}) {
  const { api } = useConnection()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function buildData(): Promise<PeerExportData | null> {
    if (!api) return null
    const [card, representation, capped] = await Promise.all([
      api.getPeerCard(workspaceId, peerId),
      api.getRepresentation(workspaceId, peerId),
      api.fetchConclusionsCapped(workspaceId, { observed_id: peerId }),
    ])
    return {
      peer: peerId,
      workspace: workspaceId,
      exportedFrom: 'honcho-local-dashboard',
      card,
      representation,
      conclusions: capped.items,
      conclusionsTotal: capped.total,
      conclusionsCapped: capped.capped,
    }
  }

  async function exportAs(format: 'json' | 'md') {
    setBusy(true)
    setError(null)
    try {
      const data = await buildData()
      if (!data) return
      if (format === 'json') {
        download(`peer-${peerId}.json`, 'application/json', JSON.stringify(data, null, 2))
      } else {
        download(`peer-${peerId}.md`, 'text/markdown', toMarkdown(data))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed')
    }
    setBusy(false)
  }

  const buttonClass =
    'flex items-center gap-1.5 rounded-md border border-line bg-ink px-3 py-1.5 text-sm text-mist hover:bg-panel-raise disabled:opacity-50'

  return (
    <span className="flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void exportAs('json')} className={buttonClass}>
        <Download className="h-4 w-4" /> Export JSON
      </button>
      <button type="button" disabled={busy} onClick={() => void exportAs('md')} className={buttonClass}>
        <Download className="h-4 w-4" /> Export MD
      </button>
      {error ? <span className="text-xs text-[#FF7A7A]">{error}</span> : null}
    </span>
  )
}
