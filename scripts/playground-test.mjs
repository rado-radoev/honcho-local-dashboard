// Playwright coverage for the Playground structured body editor
// (Phase D), in demo mode against the production build.
//
// Flow under test (POST /v3/workspaces, "Get Or Create Workspace"):
// the structured form renders fields from the fixture schema, a
// required-field miss blocks Execute, a filled value round-trips
// Form -> Raw JSON -> Form unchanged, Execute shows the labeled canned
// demo response, and Copy-as-cURL carries the SAME serialized body.
// Any console error or page error fails the run.
//
// Usage:  npm run build && npm run test:playground

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4174
const ORIGIN = `http://localhost:${PORT}`

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
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`)
    })

    await page.goto(`${ORIGIN}/?demo=1#/playground`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Get Or Create Workspace/ }).click()

    // D1: the structured form renders fields from the fixture schema.
    const idInput = page.getByLabel('Body field id')
    await idInput.waitFor()
    assert(await page.getByLabel('Body field metadata').count() === 1, 'metadata field renders')
    assert(
      (await page.getByLabel('Body field configuration.custom_instructions').count()) === 1,
      'nested configuration.custom_instructions field renders',
    )
    console.log('ok - form renders fixture schema fields (incl. one nested level)')

    // D3: required validation — id starts empty, Execute is blocked.
    await page.getByText('Missing required: id').waitFor()
    await page.getByRole('button', { name: 'Execute Request' }).click()
    await page.getByText(/Request body is incomplete/).waitFor()
    console.log('ok - missing required field blocks Execute with a clear message')

    // Fill a field, then D2: Form -> Raw shows exactly that JSON.
    await idInput.fill('playground-ws-1')
    await page.getByRole('button', { name: 'Raw JSON' }).click()
    const raw = page.getByLabel('Raw request body JSON')
    await raw.waitFor()
    const rawText = await raw.inputValue()
    assert(rawText.includes('"id": "playground-ws-1"'), `raw JSON contains the filled id, got: ${rawText}`)
    console.log('ok - Form -> Raw JSON carries the filled value')

    // D2: Raw -> Form keeps the value.
    await page.getByRole('button', { name: 'Form', exact: true }).click()
    await idInput.waitFor()
    assert((await idInput.inputValue()) === 'playground-ws-1', 'id survives Raw -> Form')
    console.log('ok - value survives Raw -> Form round-trip')

    // D2: invalid JSON in Raw shows the parse error inline and the
    // switch back to Form does not discard the text.
    await page.getByRole('button', { name: 'Raw JSON' }).click()
    await raw.fill('{broken json')
    await page.getByText(/Invalid JSON:/).waitFor()
    await page.getByRole('button', { name: 'Form', exact: true }).click()
    assert((await raw.inputValue()) === '{broken json', 'invalid raw text is never discarded')
    console.log('ok - invalid raw JSON errors inline and is never discarded')

    // Restore the good body, then D3/D6: Execute shows the canned
    // demo response, and Copy-as-cURL contains the same body.
    await raw.fill(rawText)
    await page.getByRole('button', { name: 'Execute Request' }).click()
    await page.getByText('demo (no server called)').waitFor()
    await page.getByText('"demo": true').waitFor()
    console.log('ok - Execute shows the labeled canned demo response')

    await page.getByRole('button', { name: 'Copy as cURL' }).click()
    await page.getByText('cURL copied.').waitFor()
    const clipboard = await page.evaluate(async () => navigator.clipboard.readText())
    assert(clipboard.startsWith('curl -X POST'), `cURL starts with the POST command, got: ${clipboard}`)
    assert(
      clipboard.includes('"id": "playground-ws-1"'),
      `cURL body matches the form body, got: ${clipboard}`,
    )
    console.log('ok - Copy-as-cURL contains the same serialized body')

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
  console.log('\nPlayground editor Playwright checks passed, zero console errors.')
}

await main()
