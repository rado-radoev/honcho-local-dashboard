// Captures every main view of the dashboard in demo mode (no live Honcho
// server needed) at a fixed viewport, into screenshots/. These PNGs are
// the visual regression baselines: re-run after UI changes and diff.
//
// Usage:  npm run build && npm run screenshots
// The script serves the production build with `vite preview`, drives it
// with Playwright, and fails if any view logs a page error.

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const PORT = 4173
const ORIGIN = `http://localhost:${PORT}`
const VIEWPORT = { width: 1600, height: 1000 }
const OUTPUT_DIR = new URL('../screenshots/', import.meta.url).pathname

// Each entry: file name, hash route, optional interactions to populate the
// view before capturing (search queries, the chat ask, Get Context).
const DEMO_VIEWS = [
  { file: 'get-started.png', hash: '#/get-started' },
  { file: 'explore.png', hash: '#/explore' },
  {
    file: 'workspace.png',
    hash: '#/workspace/test-1',
    interact: async (page) => {
      await page.getByPlaceholder('Search messages across this workspace…').fill('sci-fi')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await page.getByText('Yes! It was great, I love sci-fi novels.').waitFor()
    },
  },
  { file: 'peers.png', hash: '#/workspace/test-1/peers' },
  {
    file: 'peer-search.png',
    hash: '#/workspace/test-1/peers/alice?tab=search',
    interact: async (page) => {
      await page.getByPlaceholder("Search this peer's messages…").fill('book')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await page.getByText('We should start a little book club').waitFor()
    },
  },
  {
    file: 'peer-chat.png',
    hash: '#/workspace/test-1/peers/alice?tab=chat',
    interact: async (page) => {
      await page.getByPlaceholder('Ask about alice…').fill('What does Alice think of Charlie?')
      await page.getByTitle('Ask').click()
      await page.getByText('Demo answer').waitFor()
    },
  },
  { file: 'peer-sessions.png', hash: '#/workspace/test-1/peers/alice?tab=sessions' },
  { file: 'peer-card.png', hash: '#/workspace/test-1/peers/alice?tab=card' },
  { file: 'peer-representation.png', hash: '#/workspace/test-1/peers/alice?tab=representation' },
  { file: 'peer-conclusions.png', hash: '#/workspace/test-1/peers/alice?tab=conclusions' },
  { file: 'peer-config.png', hash: '#/workspace/test-1/peers/alice?tab=config' },
  { file: 'sessions.png', hash: '#/workspace/test-1/sessions' },
  { file: 'session-messages.png', hash: '#/workspace/test-1/sessions/groupchat_1?tab=messages' },
  {
    file: 'session-search.png',
    hash: '#/workspace/test-1/sessions/groupchat_1?tab=search',
    interact: async (page) => {
      await page.getByPlaceholder('Search this session…').fill('book')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await page.getByText('We should start a little book club').waitFor()
    },
  },
  {
    file: 'session-context.png',
    hash: '#/workspace/test-1/sessions/groupchat_1?tab=context',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Get Context' }).click()
      await page.getByText('MESSAGES IN CONTEXT').waitFor()
    },
  },
  { file: 'session-peers.png', hash: '#/workspace/test-1/sessions/groupchat_1?tab=peers' },
  {
    file: 'memory-map.png',
    hash: '#/memory-map/hermes',
    interact: async (page) => {
      await page.getByTestId('map-dot').first().waitFor()
      const dots = await page.getByTestId('map-dot').count()
      if (dots < 50) throw new Error(`memory map: expected >= 50 conclusion dots, got ${dots}`)
      const hubs = await page.locator('[data-testid="constellation-svg"] text').count()
      if (hubs < 3) throw new Error(`memory map: expected peer hub labels, got ${hubs}`)
    },
  },
  {
    file: 'memory-map-network.png',
    hash: '#/memory-map/hermes',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Network', exact: true }).click()
      await page.getByTestId('network-svg').waitFor()
    },
  },
  {
    file: 'memory-map-timeline.png',
    hash: '#/memory-map/hermes',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Timeline', exact: true }).click()
      await page.getByTestId('timeline-svg').waitFor()
      const dots = await page.getByTestId('timeline-dot').count()
      if (dots < 50) throw new Error(`memory map timeline: expected >= 50 timeline dots, got ${dots}`)
      const arcs = await page.getByTestId('timeline-arc').count()
      if (arcs < 50) throw new Error(`memory map timeline: expected >= 50 derivation arcs, got ${arcs}`)
    },
  },
  {
    file: 'memory-map-fault-lines.png',
    hash: '#/memory-map/hermes',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Fault Lines', exact: true }).click()
      await page.getByTestId('fault-lines').waitFor()
      const clusters = await page.getByTestId('fault-cluster').count()
      if (clusters < 1) throw new Error(`fault lines: expected >= 1 linked cluster, got ${clusters}`)
      const cards = await page.getByTestId('fault-card').count()
      if (cards < 7) throw new Error(`fault lines: expected >= 7 contradiction cards, got ${cards}`)
      const unlinked = await page.getByTestId('fault-unlinked').count()
      if (unlinked !== 1) throw new Error(`fault lines: expected the Unlinked group, got ${unlinked}`)
    },
  },
  {
    // Dusk Age mode is deterministic under ?still=1: the page's
    // reference "now" is the dataset's max created_at, so this
    // baseline is byte-stable like the Level one.
    file: 'memory-map-age.png',
    hash: '#/memory-map/hermes',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Age', exact: true }).click()
      await page.getByTestId('hub-last-learned').first().waitFor()
      const labels = await page.getByTestId('hub-last-learned').count()
      if (labels < 3) throw new Error(`memory map age: expected >= 3 hub last-learned labels, got ${labels}`)
      const dots = await page.getByTestId('map-dot').count()
      if (dots < 50) throw new Error(`memory map age: expected >= 50 conclusion dots, got ${dots}`)
    },
  },
  {
    file: 'conclusions.png',
    hash: '#/conclusions/hermes',
    interact: async (page) => {
      await page.getByText('Radoslav prefers short, direct, evidence-backed answers.').first().waitFor()
    },
  },
  {
    file: 'workspace-chat.png',
    hash: '#/workspace/test-1',
    interact: async (page) => {
      await page.getByRole('tab', { name: 'Workspace Chat' }).click()
      await page.getByPlaceholder('Ask about workspace test-1…').fill('What does Alice like?')
      await page.getByRole('button', { name: 'Ask', exact: true }).click()
      await page.getByText('EVIDENCE — WHAT THE AGENT READ').waitFor()
    },
  },
  {
    file: 'workspace-scopes.png',
    hash: '#/workspace/hermes',
    interact: async (page) => {
      await page.getByRole('tab', { name: 'Scopes' }).click()
      await page.getByText('personal-memory').waitFor()
    },
  },
  { file: 'status.png', hash: '#/status' },
  { file: 'performance.png', hash: '#/performance' },
  { file: 'playground.png', hash: '#/playground' },
  { file: 'api-keys.png', hash: '#/api-keys' },
  { file: 'webhooks.png', hash: '#/webhooks' },
  { file: 'settings.png', hash: '#/settings' },
  { file: 'members.png', hash: '#/cloud/members' },
  { file: 'billing.png', hash: '#/cloud/billing' },
]

// Before each capture, freeze everything that can render differently
// between two runs of the same page:
// - blur the focused element + hide text carets (a blinking caret in a
//   filled input renders in ~half the frames — the original peer-chat /
//   peer-search instability),
// - disable CSS animations/transitions (spinner frames, fade-ins),
// - hide scrollbars (thumb size/position tracks async content height),
// - wait for webfonts so text antialiasing is final.
// Together these make consecutive runs byte-identical.
const FREEZE_CSS = `
  * {
    caret-color: transparent !important;
    animation: none !important;
    transition: none !important;
  }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`

async function settleForCapture(page) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {})
  await page.evaluate(async () => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    await document.fonts.ready
  })
  await page.waitForTimeout(60)
}

async function waitForPreviewServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(ORIGIN)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('vite preview did not start in time')
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })

  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  })

  const pageErrors = []
  try {
    await waitForPreviewServer()
    const browser = await chromium.launch()

    // 1. The connect screen, in a pristine browser profile.
    const connectContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    const connectPage = await connectContext.newPage()
    connectPage.on('pageerror', (error) => pageErrors.push(`connect: ${error.message}`))
    await connectPage.goto(ORIGIN, { waitUntil: 'networkidle' })
    await connectPage.getByText('Connect to your self-hosted Honcho instance').waitFor()
    await settleForCapture(connectPage)
    await connectPage.screenshot({ path: `${OUTPUT_DIR}connect.png` })
    console.log('captured connect.png')
    await connectContext.close()

    // 2. Every app view in demo mode (?demo=1 selects the fixture client).
    const demoContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    const page = await demoContext.newPage()
    page.on('pageerror', (error) => pageErrors.push(`${error.message}`))

    for (const view of DEMO_VIEWS) {
      // &still=1 forces the Memory Map's constellation motion off (dots
      // at base angles) so animated views stay byte-stable across runs.
      await page.goto(`${ORIGIN}/?demo=1&still=1${view.hash}`, { waitUntil: 'networkidle' })
      // Full reload before capturing: hash-only navigation keeps the SPA
      // mounted, and a previous view's screenshot leaves Chromium's
      // compositor in one of two raster states — rounded-corner
      // antialiasing then flips between runs (the peer-card / peer-chat /
      // peer-search instability). A fresh document renders canonically.
      // Interactions run AFTER the reload so their results are in frame.
      await page.reload({ waitUntil: 'networkidle' })
      if (view.interact) await view.interact(page)
      // Let async fixture data settle before capturing.
      await page.waitForTimeout(250)
      await settleForCapture(page)
      await page.screenshot({ path: `${OUTPUT_DIR}${view.file}` })
      console.log(`captured ${view.file}`)
    }

    await browser.close()
  } finally {
    preview.kill()
  }

  if (pageErrors.length > 0) {
    console.error('\nPage errors detected:')
    for (const message of pageErrors) console.error(` - ${message}`)
    process.exit(1)
  }
  console.log(`\nDone — ${DEMO_VIEWS.length + 1} screenshots in screenshots/`)
}

await main()
