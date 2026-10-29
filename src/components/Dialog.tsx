import type { ReactNode } from 'react'
import { X } from 'lucide-react'

// Small modal dialog used by the create / edit-config flows. Original
// implementation; closes on backdrop click or the X button.
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-md border border-line bg-panel p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-mist">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-fog hover:bg-panel-raise hover:text-mist"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const dialogInputClass =
  'w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-mist outline-none focus:border-fog'
export const dialogLabelClass = 'mb-1 block text-xs tracking-widest text-fog'
export const primaryButtonClass =
  'rounded-md bg-badge px-4 py-2.5 text-sm font-semibold text-badge-ink hover:brightness-110 disabled:opacity-50'
export const darkButtonClass =
  'flex items-center gap-1.5 rounded-md border border-line bg-ink px-3 py-1.5 text-sm text-mist hover:bg-panel-raise'
