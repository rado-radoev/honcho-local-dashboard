import type { Conclusion } from '../types'

export interface PeerExportData {
  peer: string
  workspace: string
  exportedFrom: string
  card: string[] | null
  representation: string
  conclusions: Conclusion[]
  conclusionsTotal: number
  conclusionsCapped: boolean
}

export function peerExportToMarkdown(data: PeerExportData): string {
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
