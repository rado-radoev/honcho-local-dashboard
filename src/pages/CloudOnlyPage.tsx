import { Cloud } from 'lucide-react'
import { PageHeader } from '../components/ui'
import type { CloudPageId } from '../lib/routing'

// Pages that exist in the cloud dashboard's sidebar but manage the Honcho Cloud account
// (organization membership, billing), not data on a self-hosted server.
// Members and Billing are the ONLY remaining cloud-only pages: the
// self-hosted v3 API has no endpoints for either, and no data is faked. Rather than fake them, this page says what the cloud
// page does and what the local equivalent is.

const PAGE_INFO: Record<CloudPageId, { title: string; subtitle: string; body: string; localEquivalent: string }> = {
  members: {
    title: 'Members',
    subtitle: 'Organization member access',
    body: 'Members administers who belongs to your Honcho Cloud organization. A self-hosted instance has no organization or member accounts — access is controlled by the server\u2019s auth setting and your network.',
    localEquivalent: 'No local equivalent by design.',
  },
  billing: {
    title: 'Billing',
    subtitle: 'Payment method and plan for your cloud instance',
    body: 'Billing is where a Honcho Cloud organization adds a payment method to activate its hosted instance. Self-hosted Honcho is free and has no billing.',
    localEquivalent: 'No local equivalent by design — nothing to pay for on your own server.',
  },
}

export function CloudOnlyPage({ page }: { page: CloudPageId }) {
  const info = PAGE_INFO[page]

  return (
    <div>
      <PageHeader
        icon={<Cloud className="h-6 w-6" />}
        title={info.title}
        subtitle={info.subtitle}
      />
      <div className="max-w-2xl rounded-md border border-line bg-panel p-5 text-sm leading-relaxed text-fog">
        <p>{info.body}</p>
        <p className="mt-3 text-mist">{info.localEquivalent}</p>
      </div>
    </div>
  )
}
