import type { ReactNode } from 'react'
import {
  BarChart3,
  Building2,
  ChevronDown,
  Code2,
  CreditCard,
  KeyRound,
  Layers,
  LogOut,
  Rocket,
  Server,
  Settings,
  Users,
  Webhook,
} from 'lucide-react'
import { navigate, type Route } from '../lib/routing'
import type { HealthState } from '../state/connection'

// Left navigation mirroring the cloud dashboard's sidebar order and icons:
// Get Started, Explore, Instance Status, Performance, API Playground,
// API Keys, Webhooks, Members, Billing — Settings at the bottom.
// Performance / Playground / API Keys / Webhooks are real local pages now;
// only Members and Billing (cloud-account concepts with no self-hosted
// API endpoints) keep the CLOUD badge and an explainer page.

interface NavItem {
  label: string
  icon: ReactNode
  route: Route
  cloudOnly: boolean
}

const iconClass = 'h-4 w-4 shrink-0'

const NAV_ITEMS: NavItem[] = [
  { label: 'GET STARTED', icon: <Rocket className={iconClass} />, route: { name: 'get-started' }, cloudOnly: false },
  { label: 'EXPLORE', icon: <Layers className={iconClass} />, route: { name: 'explore' }, cloudOnly: false },
  { label: 'INSTANCE STATUS', icon: <Server className={iconClass} />, route: { name: 'status' }, cloudOnly: false },
  { label: 'PERFORMANCE', icon: <BarChart3 className={iconClass} />, route: { name: 'performance' }, cloudOnly: false },
  { label: 'API PLAYGROUND', icon: <Code2 className={iconClass} />, route: { name: 'playground' }, cloudOnly: false },
  { label: 'API KEYS', icon: <KeyRound className={iconClass} />, route: { name: 'api-keys' }, cloudOnly: false },
  { label: 'WEBHOOKS', icon: <Webhook className={iconClass} />, route: { name: 'webhooks' }, cloudOnly: false },
  { label: 'MEMBERS', icon: <Users className={iconClass} />, route: { name: 'cloud-only', page: 'members' }, cloudOnly: true },
  { label: 'BILLING', icon: <CreditCard className={iconClass} />, route: { name: 'cloud-only', page: 'billing' }, cloudOnly: true },
]

function isItemActive(item: NavItem, route: Route): boolean {
  if (item.route.name === 'get-started') return route.name === 'get-started'
  if (item.route.name === 'status') return route.name === 'status'
  if (item.route.name === 'performance') return route.name === 'performance'
  if (item.route.name === 'playground') return route.name === 'playground'
  if (item.route.name === 'api-keys') return route.name === 'api-keys'
  if (item.route.name === 'webhooks') return route.name === 'webhooks'
  if (item.route.name === 'explore') {
    return (
      route.name === 'explore' ||
      route.name === 'workspace' ||
      route.name === 'peers' ||
      route.name === 'peer' ||
      route.name === 'sessions' ||
      route.name === 'session'
    )
  }
  if (item.route.name === 'cloud-only' && route.name === 'cloud-only') {
    return item.route.page === route.page
  }
  return false
}

function healthDotClass(health: HealthState): string {
  if (health === 'connected') return 'bg-green-500'
  if (health === 'failed') return 'bg-red-500'
  return 'bg-yellow-500'
}

export function Sidebar({
  route,
  health,
  mode,
  baseUrl,
  onDisconnect,
}: {
  route: Route
  health: HealthState
  mode: 'live' | 'demo' | null
  baseUrl: string
  onDisconnect: () => void
}) {
  const serverLabel = mode === 'demo' ? 'DEMO DATA' : baseUrl.replace(/^https?:\/\//, '')
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-ink-deep">
      <div className="px-4 pb-2 pt-5">
        {/* Text wordmark inside a rounded pill — our own rendering, not
            the cloud logo graphic. */}
        <div className="font-display inline-flex items-center rounded-full bg-panel-raise px-5 py-2.5 text-2xl font-bold tracking-widest text-mist">
          HONCHO
        </div>
        <div className="mt-1.5 px-1 text-[11px] tracking-widest text-fog">LOCAL DASHBOARD</div>
      </div>

      {/* Server / organization switcher row, styled like the cloud's
          PLASTIC-LABS row: building icon + label + chevron. */}
      <div className="mx-4 mb-4 mt-3 flex items-center gap-2 border-b border-line pb-4 text-xs tracking-widest text-fog">
        <Building2 className="h-4 w-4 shrink-0" />
        <span className="truncate" title={baseUrl}>
          {serverLabel}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
      </div>

      <nav className="flex flex-col gap-1 px-3" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const active = isItemActive(item, route)
          let className =
            'flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] tracking-widest '
          className += active ? 'bg-panel-raise text-mist' : 'text-fog hover:bg-panel hover:text-mist'
          return (
            <button
              key={item.label}
              type="button"
              className={className}
              onClick={() => navigate(item.route)}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              {item.label === 'INSTANCE STATUS' ? (
                <span className={`ml-auto h-2 w-2 rounded-full ${healthDotClass(health)}`} />
              ) : null}
              {item.cloudOnly ? (
                <span className="ml-auto shrink-0 rounded border border-line px-1 text-[8px] tracking-normal text-fog">
                  CLOUD
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto px-3 pb-5">
        <button
          type="button"
          onClick={() => navigate({ name: 'settings' })}
          className={
            route.name === 'settings'
              ? 'mb-1 flex w-full items-center gap-3 rounded-md bg-panel-raise px-3 py-2.5 text-[13px] tracking-widest text-mist'
              : 'mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] tracking-widest text-fog hover:bg-panel hover:text-mist'
          }
        >
          <Settings className="h-4 w-4" />
          <span>SETTINGS</span>
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] tracking-widest text-fog hover:bg-panel hover:text-mist"
        >
          <LogOut className="h-4 w-4" />
          <span>{mode === 'demo' ? 'EXIT DEMO' : 'DISCONNECT'}</span>
        </button>
      </div>
    </aside>
  )
}
