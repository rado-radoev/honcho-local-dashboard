import type { ReactNode } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { navigate, type Route } from '../lib/routing'

// Shared building blocks used by every view, styled after the layout
// patterns of the cloud dashboard: section titles with an icon, muted
// subtitle, breadcrumbs, pale-blue count badges, bordered tab bar.

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-fog">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-fog">
      {children}
    </div>
  )
}

// The pale-blue count chip used next to section titles ("3 peers").
export function CountBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-badge px-1.5 text-sm font-semibold text-badge-ink">
      {count}
    </span>
  )
}

export function PageHeader({
  icon,
  title,
  subtitle,
  backRoute,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  backRoute?: Route
}) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-wide text-mist">
          {icon}
          {title}
        </h1>
        {backRoute ? (
          <button
            type="button"
            onClick={() => navigate(backRoute)}
            className="text-sm text-fog hover:text-mist"
          >
            &lt;&nbsp; Back
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-fog">{subtitle}</p>
    </div>
  )
}

// Breadcrumb trail in the cloud style: "Workspaces > test-1 > Peers > alice".
export function Breadcrumbs({ parts }: { parts: Array<{ label: string; route?: Route }> }) {
  return (
    <nav className="mb-5 border-b border-line pb-4 text-sm text-fog" aria-label="Breadcrumb">
      {parts.map((part, index) => (
        <span key={`${part.label}-${index}`}>
          {index > 0 ? <span className="mx-1.5">&gt;</span> : null}
          {part.route ? (
            <button type="button" className="hover:text-mist" onClick={() => navigate(part.route!)}>
              {part.label}
            </button>
          ) : (
            <span className="text-mist">{part.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

// Tab bar: bordered boxes, the active tab outlined — same pattern as the
// cloud Peer/Session Utilities pages.
export function TabBar({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: Array<{ id: string; label: string }>
  activeTab: string
  onSelect: (tabId: string) => void
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-0" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab
        let className =
          'border border-line px-6 py-2.5 text-sm first:rounded-tl-md last:rounded-tr-md '
        className += isActive ? 'bg-panel-raise text-mist' : 'bg-panel text-fog hover:text-mist'
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={className}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export function RefreshButton({ onRefresh, spinning }: { onRefresh: () => void; spinning: boolean }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      title="Refresh"
      className="rounded-md p-2 text-fog hover:bg-panel-raise hover:text-mist"
    >
      <RefreshCw className={spinning ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
    </button>
  )
}

// Pagination footer in the cloud style: "<  Page 1 of 1  >".
export function PaginationControls({
  page,
  pages,
  onChange,
}: {
  page: number
  pages: number
  onChange: (page: number) => void
}) {
  if (pages <= 1) {
    return <div className="text-sm text-fog">Page 1 of 1</div>
  }
  return (
    <div className="flex items-center gap-3 text-sm text-fog">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="px-1 disabled:opacity-30"
        aria-label="Previous page"
      >
        &lt;
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
        className="px-1 disabled:opacity-30"
        aria-label="Next page"
      >
        &gt;
      </button>
    </div>
  )
}

// Uppercase small table header row used by the data tables.
export function TableHead({ columns }: { columns: string[] }) {
  return (
    <thead>
      <tr className="border-b border-line text-left text-xs tracking-widest text-fog">
        {columns.map((column) => (
          <th key={column} className="px-3 py-2 font-medium">
            {column}
          </th>
        ))}
      </tr>
    </thead>
  )
}
