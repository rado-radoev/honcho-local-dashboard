import { useEffect, useMemo, useState } from 'react'
import { Code2, Copy, Play } from 'lucide-react'
import { useConnection } from '../state/connection'
import { useAsyncData } from '../lib/useAsyncData'
import {
  buildBodySkeleton,
  buildCurl,
  extractPathParams,
  fillPathParams,
  groupEndpointsByTag,
  listTags,
  methodPillLabel,
  parseEndpoints,
  titleCase,
  type PlaygroundEndpoint,
} from '../api/openapi'
import { methodPillClass } from '../lib/methodStyles'
import { ErrorBox, PageHeader, Spinner } from '../components/ui'
import type { ExecuteResult } from '../types'

// API Playground — a Postman-like client driven by the LIVE OpenAPI spec
// of the connected server (GET /openapi.json through the same proxy/auth
// machinery as every other request). In demo mode the spec is the bundled
// trimmed 3.4.1 fixture and Execute returns a labeled canned response.

function endpointKey(endpoint: PlaygroundEndpoint): string {
  return `${endpoint.method} ${endpoint.path}`
}

export function PlaygroundPage() {
  const { api, baseUrl, mode } = useConnection()
  const spec = useAsyncData(async () => (api ? api.fetchSpec() : null), [api])

  const endpoints = useMemo(
    () => (spec.data ? parseEndpoints(spec.data) : []),
    [spec.data],
  )
  const tags = useMemo(() => listTags(endpoints), [endpoints])

  const [filterTag, setFilterTag] = useState<string>('All')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pathValues, setPathValues] = useState<Record<string, string>>({})
  const [queryValues, setQueryValues] = useState<Record<string, string>>({})
  const [bodyText, setBodyText] = useState('')
  const [result, setResult] = useState<ExecuteResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [copyNote, setCopyNote] = useState<string | null>(null)

  const selected = useMemo(() => {
    const found = endpoints.find((endpoint) => endpointKey(endpoint) === selectedKey)
    return found ?? endpoints[0] ?? null
  }, [endpoints, selectedKey])

  // When the selection changes, prefill path params, query fields, body.
  useEffect(() => {
    if (!selected || !spec.data) return
    const defaults: Record<string, string> = {}
    for (const name of extractPathParams(selected.path)) defaults[name] = ''
    setPathValues(defaults)
    setQueryValues({})
    setBodyText(buildBodySkeleton(selected.requestBodySchema, spec.data) ?? '')
    setResult(null)
  }, [selectedKey, selected, spec.data])

  const visibleGroups = useMemo(() => {
    const filtered =
      filterTag === 'All' ? endpoints : endpoints.filter((endpoint) => endpoint.tag === filterTag)
    return groupEndpointsByTag(filtered)
  }, [endpoints, filterTag])

  const queryParams = (selected?.parameters ?? []).filter((param) => param.in === 'query')
  const filledPath = selected ? fillPathParams(selected.path, pathValues) : ''
  const displayBase = mode === 'demo' ? 'http://localhost:8000' : baseUrl.replace(/\/+$/, '')

  async function copyText(text: string, note: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyNote(note)
    } catch {
      setCopyNote('Copy failed — select the text manually.')
    }
  }

  async function execute() {
    if (!api || !selected) return
    if (selected.method === 'DELETE') {
      const confirmed = window.confirm(`Send DELETE ${filledPath}? This cannot be undone.`)
      if (!confirmed) return
    }
    if (bodyText.trim().length > 0 && selected.requestBodySchema) {
      try {
        JSON.parse(bodyText)
      } catch {
        setResult({ status: 0, durationMs: 0, bodyText: 'Request body is not valid JSON.' })
        return
      }
    }
    setExecuting(true)
    const response = await api.execute(
      selected.method,
      filledPath,
      queryValues,
      selected.requestBodySchema ? bodyText : undefined,
    )
    setResult(response)
    setExecuting(false)
  }

  function curlText(): string {
    if (!selected) return ''
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(queryValues)) {
      if (value.trim().length > 0) query.set(key, value)
    }
    const suffix = query.toString().length > 0 ? `?${query.toString()}` : ''
    return buildCurl({
      method: selected.method,
      url: `${displayBase}${filledPath}${suffix}`,
      bodyText: selected.requestBodySchema ? bodyText : undefined,
    })
  }

  return (
    <div>
      <PageHeader
        icon={<Code2 className="h-6 w-6" />}
        title="API Playground"
        subtitle="Test and explore API endpoints"
      />
      <p className="-mt-3 mb-6 text-sm text-fog">
        See{' '}
        <a className="text-badge underline" href="https://honcho.dev/docs" target="_blank" rel="noreferrer">
          docs.honcho.dev
        </a>{' '}
        for reference
      </p>

      {spec.error ? <ErrorBox message={`Could not load /openapi.json: ${spec.error}`} /> : null}
      {spec.loading && !spec.data ? <Spinner label="Loading API spec…" /> : null}

      {spec.data && selected ? (
        <div className="grid items-start gap-6 lg:grid-cols-[300px_1fr]">
          <div>
            <div className="mb-2 text-xs tracking-widest text-fog">FILTER BY CATEGORY</div>
            <div className="mb-5 flex flex-wrap gap-1.5">
              {['All', ...tags].map((tag) => {
                const isActive = filterTag === tag
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setFilterTag(tag)}
                    className={
                      isActive
                        ? 'rounded bg-badge px-2.5 py-1 text-xs font-semibold text-badge-ink'
                        : 'rounded bg-panel px-2.5 py-1 text-xs text-fog hover:text-mist'
                    }
                  >
                    {tag === 'All' ? 'All' : titleCase(tag)}
                  </button>
                )
              })}
            </div>

            {visibleGroups.map((group) => (
              <div key={group.tag} className="mb-4">
                <div className="mb-1.5 text-sm text-fog">{group.tag}</div>
                <div className="flex flex-col">
                  {group.endpoints.map((endpoint) => {
                    const isSelected = endpointKey(endpoint) === endpointKey(selected)
                    return (
                      <button
                        key={endpointKey(endpoint)}
                        type="button"
                        onClick={() => setSelectedKey(endpointKey(endpoint))}
                        className={
                          isSelected
                            ? 'flex items-center gap-2.5 rounded-md bg-panel-raise px-2.5 py-2 text-left text-sm text-mist'
                            : 'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-fog hover:bg-panel hover:text-mist'
                        }
                      >
                        <span
                          className={`w-11 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold ${methodPillClass(endpoint.method)}`}
                        >
                          {methodPillLabel(endpoint.method)}
                        </span>
                        <span className="truncate">{titleCase(endpoint.summary)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="rounded-md border border-line bg-panel p-4">
              <div className="flex items-center gap-3">
                <span
                  className={`rounded px-2 py-1 text-xs font-bold ${methodPillClass(selected.method)}`}
                >
                  {methodPillLabel(selected.method)}
                </span>
                <span className="font-display text-base font-bold text-mist">
                  {titleCase(selected.summary)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1 rounded bg-ink px-3 py-2 text-sm text-mist">
                {selected.path.split(/(\{[^}]+\})/).map((segment, index) => {
                  const match = segment.match(/^\{([^}]+)\}$/)
                  if (!match) return <span key={index}>{segment}</span>
                  const name = match[1]
                  return (
                    <input
                      key={index}
                      aria-label={`Path parameter ${name}`}
                      value={pathValues[name] ?? ''}
                      onChange={(event) =>
                        setPathValues((current) => ({ ...current, [name]: event.target.value }))
                      }
                      placeholder={name}
                      className="w-36 border-b border-fog bg-transparent px-1 text-badge outline-none"
                    />
                  )
                })}
              </div>
              <p className="mt-2 text-sm text-fog">{selected.description}</p>
            </div>

            <div className="mt-4 flex items-center gap-4 text-sm text-fog">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400" /> Required
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" /> Satisfied
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-badge" /> Optional
              </span>
            </div>

            <h3 className="mb-2 mt-6 text-sm text-fog">Query Parameters</h3>
            {queryParams.length === 0 ? (
              <div className="rounded-md border border-dashed border-line px-4 py-5 text-center text-sm text-fog">
                No query parameters for this endpoint
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {queryParams.map((param) => (
                  <label key={param.name} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 text-fog">
                      {param.name}
                      {param.required ? ' *' : ''}
                    </span>
                    <input
                      value={queryValues[param.name] ?? ''}
                      onChange={(event) =>
                        setQueryValues((current) => ({ ...current, [param.name]: event.target.value }))
                      }
                      className="w-full max-w-sm rounded-md border border-line bg-panel px-3 py-2 text-sm text-mist outline-none focus:border-fog"
                    />
                  </label>
                ))}
              </div>
            )}

            {selected.requestBodySchema ? (
              <>
                <div className="mb-2 mt-6 flex items-center justify-between">
                  <h3 className="text-sm text-mist">Request Body</h3>
                  <button
                    type="button"
                    onClick={() => void copyText(bodyText, 'Body copied.')}
                    className="flex items-center gap-1.5 text-sm text-fog hover:text-mist"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy JSON
                  </button>
                </div>
                <textarea
                  value={bodyText}
                  onChange={(event) => setBodyText(event.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-mist outline-none focus:border-fog"
                />
              </>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={executing}
                onClick={() => void execute()}
                className="flex items-center gap-2 rounded-md bg-badge px-4 py-2.5 text-sm font-semibold text-badge-ink hover:brightness-110 disabled:opacity-50"
              >
                <Play className="h-4 w-4" /> {executing ? 'Executing…' : 'Execute Request'}
              </button>
              <button
                type="button"
                onClick={() => void copyText(curlText(), 'cURL copied.')}
                className="flex items-center gap-1.5 rounded-md border border-line px-4 py-2.5 text-sm text-mist hover:bg-panel-raise"
              >
                <Copy className="h-4 w-4" /> Copy as cURL
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null)
                  setBodyText(
                    spec.data ? (buildBodySkeleton(selected.requestBodySchema, spec.data) ?? '') : '',
                  )
                }}
                className="rounded-md border border-line px-4 py-2.5 text-sm text-mist hover:bg-panel-raise"
              >
                Clear
              </button>
              {copyNote ? <span className="text-sm text-fog">{copyNote}</span> : null}
            </div>

            <div className="mb-2 mt-8 flex items-center justify-between">
              <h3 className="text-sm text-mist">Response</h3>
              {result ? (
                <button
                  type="button"
                  onClick={() => void copyText(result.bodyText, 'Response copied.')}
                  className="flex items-center gap-1.5 text-sm text-fog hover:text-mist"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy Response
                </button>
              ) : null}
            </div>
            {result ? (
              <>
                <div className="mb-2 text-sm text-fog">
                  Status <span className="text-mist">{result.status}</span> ·{' '}
                  {Math.round(result.durationMs)} ms
                  {result.isDemo ? ' · demo (no server called)' : ''}
                </div>
                <pre className="max-h-96 overflow-auto rounded-md border border-line bg-ink-deep p-4 text-sm text-mist">
                  {result.bodyJson !== undefined
                    ? JSON.stringify(result.bodyJson, null, 2)
                    : result.bodyText}
                </pre>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-line px-4 py-5 text-center text-sm text-fog">
                No response yet — execute a request to see it here.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
