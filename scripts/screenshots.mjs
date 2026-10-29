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
  { file: 'status.png', hash: '#/status' },
]

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
    const connectContext = await browser.newContext({ viewport: VIEWPORT })
    const connectPage = await connectContext.newPage()
    connectPage.on('pageerror', (error) => pageErrors.push(`connect: ${error.message}`))
    await connectPage.goto(ORIGIN, { waitUntil: 'networkidle' })
    await connectPage.getByText('Connect to your self-hosted Honcho instance').waitFor()
    await connectPage.screenshot({ path: `${OUTPUT_DIR}connect.png` })
    console.log('captured connect.png')
    await connectContext.close()

    // 2. Every app view in demo mode (?demo=1 selects the fixture client).
    const demoContext = await browser.newContext({ viewport: VIEWPORT })
    const page = await demoContext.newPage()
    page.on('pageerror', (error) => pageErrors.push(`${error.message}`))

    for (const view of DEMO_VIEWS) {
      await page.goto(`${ORIGIN}/?demo=1${view.hash}`, { waitUntil: 'networkidle' })
      if (view.interact) await view.interact(page)
      // Let async fixture data settle before capturing.
      await page.waitForTimeout(250)
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
