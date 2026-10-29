// Small display helpers shared across views.

// The cloud dashboard renders timestamps like "8/25/2025, 1:25:00 PM".
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})

export function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return isoString
  return dateTimeFormatter.format(date)
}

// Metadata / configuration cells in the cloud tables show "None" for empty
// objects and the raw JSON otherwise.
export function formatJsonCell(value: Record<string, unknown>): string {
  if (!value || Object.keys(value).length === 0) return 'None'
  return JSON.stringify(value)
}

// Deterministic per-peer chip colors, echoing the cloud session view where
// each peer's name renders in its own color (alice rose, bob blue, ...).
const PEER_CHIP_CLASSES = [
  'bg-rose-950 text-rose-300',
  'bg-blue-950 text-blue-300',
  'bg-violet-950 text-violet-300',
  'bg-emerald-950 text-emerald-300',
  'bg-amber-950 text-amber-300',
  'bg-cyan-950 text-cyan-300',
  'bg-fuchsia-950 text-fuchsia-300',
  'bg-lime-950 text-lime-300',
]

export function peerChipClass(peerId: string): string {
  let hash = 0
  for (let index = 0; index < peerId.length; index += 1) {
    hash = (hash * 31 + peerId.charCodeAt(index)) >>> 0
  }
  return PEER_CHIP_CLASSES[hash % PEER_CHIP_CLASSES.length]
}
