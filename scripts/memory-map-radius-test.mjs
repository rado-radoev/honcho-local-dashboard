// Playwright coverage for the Memory Map Reasoning Radius layout
// (Phase E), in demo mode against the production build.
//
// Flow under test (demo workspace `hermes`, ?still=1 so dots sit at
// their base coordinates): the Constellation starts in Spiral with
// 120 dots; toggling Layout: Radius keeps all 120 dots, shows the
// ring labels (Said / Derived ×1 / ×2 / ×3+), and places the demo
// fixture's deep-chain conclusion (concl_hermes_g117 — the end of
// the per-peer derivation chain in demoFixtures) in a strictly outer
// band than a ring-0 said conclusion about the same peer
// (concl_demo_hermes_01), measured from actual SVG coordinates.
// Clicking the deep dot selects it (detail rail), and toggling back
// to Spiral restores every dot's pre-toggle coordinates exactly.
// Any console error or page error fails the run.
//
// Usage:  npm run build && npm run test:radius

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4175
const ORIGIN = `http://localhost:${PORT}`

const DEEP_ID = 'concl_hermes_g117'
const SAID_ID = 'concl_demo_hermes_01'
const PEER = 'radoslav'

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`)
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

async function dotPositions(page) {
  return page.evaluate(() => {
    const positions = {}
    for (const el of document.querySelectorAll('[data-testid="map-dot"]')) {
      positions[el.getAttribute('data-conclusion-id')] = [
        Number(el.getAttribute('cx')),
        Number(el.getAttribute('cy')),
      ]
    }
    return positions
  })
}

async function hubCenter(page, peerId) {
  return page.evaluate((peer) => {
    const hub = document.querySelector(`[data-testid="map-hub"][data-peer="${peer}"]`)
    if (!hub) throw new Error(`no hub for ${peer}`)
    for (const circle of hub.querySelectorAll('circle')) {
      if (circle.getAttribute('r') === '13') {
        return [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))]
      }
    }
    throw new Error(`no hub circle for ${peer}`)
  }, peerId)
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

async function main() {
  // detached + process-group kill: killing the npx wrapper alone
  // leaves the vite child serving a stale build on the port.
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
    detached: true,
  })

  const problems = []
  try {
    await waitForPreviewServer()
    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`)
    })

    await page.goto(`${ORIGIN}/?demo=1&still=1#/memory-map/hermes`, { waitUntil: 'networkidle' })
    await page.getByTestId('map-dot').first().waitFor()

    // Spiral is the default layout, with all 120 demo dots.
    const dotCount = await page.getByTestId('map-dot').count()
    assert(dotCount === 120, `spiral: expected 120 dots, got ${dotCount}`)
    const spiralPositions = await dotPositions(page)
    console.log('ok - Spiral default renders 120 demo hermes dots')

    // Toggle to Radius: no refetch, same dots, ring labels present.
    await page.getByRole('button', { name: 'Radius', exact: true }).click()
    await page.getByTestId('radius-ring-label').first().waitFor()
    const radiusCount = await page.getByTestId('map-dot').count()
    assert(radiusCount === 120, `radius: expected 120 dots still rendered, got ${radiusCount}`)
    const labelTexts = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="radius-ring-label"]')].map((el) => el.textContent),
    )
    for (const expected of ['Said', 'Derived ×1', 'Derived ×2', 'Derived ×3+']) {
      assert(labelTexts.includes(expected), `radius: ring label "${expected}" present`)
    }
    console.log(`ok - Radius renders 120 dots and ring labels (${[...new Set(labelTexts)].join(', ')})`)

    // The deep-chain dot's depth/band as computed by the app itself.
    const deepMeta = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="map-dot"][data-conclusion-id="${id}"]`)
      if (!el) throw new Error(`no dot ${id}`)
      return { depth: Number(el.getAttribute('data-depth')), band: Number(el.getAttribute('data-band')) }
    }, DEEP_ID)
    console.log(`info - ${DEEP_ID} computed depth=${deepMeta.depth}, band=${deepMeta.band}`)
    assert(deepMeta.band === 3, `deep dot sits in the 3+ band, got band ${deepMeta.band}`)

    // Measured radii from actual SVG coordinates vs the shared hub.
    const hub = await hubCenter(page, PEER)
    const radiusPositions = await dotPositions(page)
    const deepRadius = distance(radiusPositions[DEEP_ID], hub)
    const saidRadius = distance(radiusPositions[SAID_ID], hub)
    console.log(`info - measured radii: deep (${DEEP_ID}) = ${deepRadius.toFixed(1)}px, ring-0 (${SAID_ID}) = ${saidRadius.toFixed(1)}px, hub ${PEER} at (${hub[0]}, ${hub[1]})`)
    assert(deepRadius > saidRadius, `deep dot radius ${deepRadius} > ring-0 radius ${saidRadius}`)
    // Band geometry: ring 0 centre 26±6, band 3+ centre 92±6.
    assert(saidRadius >= 19 && saidRadius <= 33, `ring-0 radius in [19,33], got ${saidRadius}`)
    assert(deepRadius >= 85 && deepRadius <= 99, `band-3+ radius in [85,99], got ${deepRadius}`)
    console.log('ok - deep-chain dot sits in an outer band than the ring-0 dot (SVG coordinates)')

    // Month rim ticks render in Radius mode.
    const ticks = await page.getByTestId('month-rim-tick').count()
    assert(ticks >= 3, `radius: expected month rim ticks, got ${ticks}`)
    console.log(`ok - month rim ticks present (${ticks} across hubs)`)

    // Click the deep dot (dispatch on the SVG element itself: dots
    // overlap in a dense band, so a coordinate click could land on a
    // neighbour) -> detail rail shows it, with its derivation depth.
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="map-dot"][data-conclusion-id="${id}"]`)
      if (!el) throw new Error(`no dot ${id}`)
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }, DEEP_ID)
    await page.locator('aside[aria-label="Map detail rail"]').getByText('Radoslav prefers deep-work tasks late at night').waitFor()
    await page.getByText('Derivation depth', { exact: true }).waitFor()
    console.log('ok - clicking the deep dot selects it in the detail rail')

    // Toggle back to Spiral: every dot returns to its exact
    // pre-toggle coordinates (selection state survives, too).
    await page.getByRole('button', { name: 'Spiral', exact: true }).click()
    await page.waitForTimeout(150)
    const restored = await dotPositions(page)
    const ids = Object.keys(spiralPositions)
    assert(Object.keys(restored).length === ids.length, 'spiral restore: same dot count')
    for (const id of ids) {
      const before = spiralPositions[id]
      const after = restored[id]
      assert(
        after && after[0] === before[0] && after[1] === before[1],
        `spiral restore: dot ${id} back at (${before}), got (${after})`,
      )
    }
    await page.locator('aside[aria-label="Map detail rail"]').getByText('Radoslav prefers deep-work tasks late at night').waitFor()
    console.log('ok - toggling back to Spiral restores all 120 dot coordinates exactly, selection kept')

    await browser.close()
  } finally {
    try {
      process.kill(-preview.pid, 'SIGKILL')
    } catch {
      preview.kill()
    }
  }

  if (problems.length > 0) {
    console.error('\nConsole/page errors detected:')
    for (const problem of problems) console.error(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll Memory Map Radius checks passed.')
}

await main()
