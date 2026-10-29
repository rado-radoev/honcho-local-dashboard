import { Cloud } from 'lucide-react'
import { useConnection } from '../state/connection'
import { PageHeader } from '../components/ui'
import type { CloudPageId } from '../lib/routing'

// Pages that exist in the cloud dashboard's sidebar but manage the Honcho
// Cloud account (organization, billing, hosted instance), not the data on a
// self-hosted server. Rather than fake them, this page says what the cloud
// page does and what the local equivalent is.

const PAGE_INFO: Record<CloudPageId, { title: string; subtitle: string; body: string; localEquivalent: string }> = {
  performance: {
    title: 'Performance',
    subtitle: 'Usage metrics, health analytics, and API response times',
    body: 'On Honcho Cloud, Performance charts the hosted instance\u2019s usage and latency. Those metrics come from cloud infrastructure that a self-hosted server does not expose through the v3 API.',
    localEquivalent: 'Local equivalent in v1: Instance Status shows API health and the per-workspace deriver queue, which the API does expose.',
  },
  playground: {
    title: 'API Playground',
    subtitle: 'Test queries against your Honcho instance',
    body: 'The cloud API Playground is a Postman-like client for the hosted instance.',
    localEquivalent: 'Local equivalent: your Honcho server ships interactive OpenAPI docs at /docs on the server itself (linked below).',
  },
  'api-keys': {
    title: 'API Keys',
    subtitle: 'Create and manage authentication tokens',
    body: 'On Honcho Cloud, API Keys mints admin or scoped (workspace / peer / session) tokens for the hosted instance. Key creation is a write operation, and cloud keys belong to the cloud account.',
    localEquivalent: 'Local equivalent: if your server runs with AUTH_USE_AUTH=true, paste your existing JWT into this dashboard\u2019s connect screen. Minting local keys is a v2 candidate (POST /v3/keys exists in the API).',
  },
  webhooks: {
    title: 'Webhooks',
    subtitle: 'Webhook creation and management',
    body: 'The cloud Webhooks page manages webhook endpoints for the hosted instance. Managing webhooks is a write operation.',
    localEquivalent: 'The v3 API does expose webhook endpoints (GET /v3/workspaces/{id}/webhooks); a read-only webhook list is a v2 candidate.',
  },
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
  const { baseUrl, mode } = useConnection()
  const showDocsLink = page === 'playground' && mode === 'live'

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
        {showDocsLink ? (
          <p className="mt-3">
            <a
              className="text-badge underline"
              href={`${baseUrl.replace(/\/+$/, '')}/docs`}
              target="_blank"
              rel="noreferrer"
            >
              Open {baseUrl.replace(/^https?:\/\//, '')}/docs
            </a>
          </p>
        ) : null}
      </div>
    </div>
  )
}
