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
import {
  buildFormModel,
  initialFormValues,
  parameterOptions,
  parseRawToForm,
  serializeBody,
  type BodyFormModel,
  type SerializeResult,
} from '../lib/schemaForm'
import { SchemaBodyForm } from '../components/SchemaBodyForm'
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
  // Real workspace ids from the connected server, used only as
  // datalist suggestions for the workspace_id path parameter (D4).
  const workspaceList = useAsyncData(
    async () => (api ? api.listWorkspaces(1, 100) : null),
    [api],
  )
  const workspaceIds = useMemo(
    () => (workspaceList.data?.items ?? []).map((workspace) => workspace.id),
    [workspaceList.data],
  )

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
  const [bodyMode, setBodyMode] = useState<'form' | 'raw'>('raw')
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [result, setResult] = useState<ExecuteResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [copyNote, setCopyNote] = useState<string | null>(null)

  const selected = useMemo(() => {
    const found = endpoints.find((endpoint) => endpointKey(endpoint) === selectedKey)
    return found ?? endpoints[0] ?? null
  }, [endpoints, selectedKey])

  const formModel: BodyFormModel = useMemo(() => {
    if (!selected || !spec.data) return { supported: false, fields: [] }
    return buildFormModel(selected.requestBodySchema, spec.data)
  }, [selected, spec.data])

  // When the selection changes, prefill path params, query fields, body.
  useEffect(() => {
    if (!selected || !spec.data) return
    const defaults: Record<string, string> = {}
    for (const name of extractPathParams(selected.path)) defaults[name] = ''
    setPathValues(defaults)
    setQueryValues({})
    const model = buildFormModel(selected.requestBodySchema, spec.data)
    if (model.supported) {
      const initial = initialFormValues(model)
      setFormValues(initial)
      setBodyText(serializeBody(model, initial).text)
      setBodyMode('form')
    } else {
      setFormValues({})
      setBodyText(buildBodySkeleton(selected.requestBodySchema, spec.data) ?? '')
      setBodyMode('raw')
    }
    setResult(null)
  }, [selectedKey, selected, spec.data])

  // Raw-mode parse of the current text (form model only). A failure
  // here is shown inline and blocks both Execute and the switch back
  // to Form — the user's text is never discarded.
  const rawParse = useMemo(() => {
    if (!formModel.supported || bodyMode !== 'raw') return null
    if (bodyText.trim().length === 0) return null
    return parseRawToForm(formModel, bodyText)
  }, [formModel, bodyMode, bodyText])
  const rawParseError = rawParse && !rawParse.ok ? rawParse.error : null

  // THE body serializer: Execute, Copy-as-cURL and Copy JSON all read
  // serializedBody / effectiveBodyText, so they can never disagree.
  const serializedBody: SerializeResult | null = useMemo(() => {
    if (!formModel.supported) return null
    if (bodyMode === 'form') return serializeBody(formModel, formValues)
    if (rawParse && rawParse.ok) return serializeBody(formModel, rawParse.values)
    return null
  }, [formModel, bodyMode, formValues, rawParse])

  function effectiveBodyText(): string | undefined {
    if (!selected?.requestBodySchema) return undefined
    if (!formModel.supported) return bodyText
    return serializedBody ? serializedBody.text : bodyText
  }

  const bodyProblem: string | null = (() => {
    if (!selected?.requestBodySchema || !formModel.supported) return null
    if (rawParseError) return `Raw JSON is invalid: ${rawParseError}`
    if (serializedBody && !serializedBody.ok) {
      const parts: string[] = []
      if (serializedBody.missing.length > 0) {
        parts.push(`Missing required: ${serializedBody.missing.join(', ')}`)
      }
      const firstError = Object.values(serializedBody.errors)[0]
      if (firstError) parts.push(firstError)
      return parts.join(' · ')
    }
    return null
  })()

  function switchToRaw() {
    if (formModel.supported) {
      const current = serializeBody(formModel, formValues)
      // Field-level errors (bad nested JSON / number) mean there is no
      // exact JSON the form produces — stay in Form with the errors
      // visible rather than silently dropping the offending input.
      if (Object.keys(current.errors).length > 0) {
        setCopyNote('Fix the highlighted field errors before switching to Raw JSON.')
        return
      }
      setBodyText(current.text)
    }
    setBodyMode('raw')
  }

  function switchToForm() {
    if (!formModel.supported) return
    const parsed = parseRawToForm(formModel, bodyText)
    if (!parsed.ok) return // error stays visible under the raw editor
    setFormValues(parsed.values)
    setBodyMode('form')
  }

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
    if (selected.requestBodySchema && formModel.supported) {
      if (rawParseError) {
        setResult({
          status: 0,
          durationMs: 0,
          bodyText: `Request body is not valid JSON: ${rawParseError}`,
        })
        return
      }
      if (serializedBody && !serializedBody.ok) {
        setResult({
          status: 0,
          durationMs: 0,
          bodyText: `Request body is incomplete — ${bodyProblem ?? 'check the highlighted fields.'}`,
        })
        return
      }
    }
    if (!formModel.supported && bodyText.trim().length > 0 && selected.requestBodySchema) {
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
      effectiveBodyText(),
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
      bodyText: effectiveBodyText(),
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
                  const param = selected.parameters.find(
                    (entry) => entry.in === 'path' && entry.name === name,
                  )
                  const paramSchema = param?.schema
                  const enumValues =
                    paramSchema && Array.isArray(paramSchema.enum)
                      ? (paramSchema.enum as unknown[]).map(String)
                      : []
                  const suggestions = [
                    ...parameterOptions(paramSchema),
                    ...(name === 'workspace_id' ? workspaceIds : []),
                  ]
                  const uniqueSuggestions = [...new Set(suggestions)]
                  const setValue = (value: string) =>
                    setPathValues((current) => ({ ...current, [name]: value }))
                  if (enumValues.length > 0) {
                    return (
                      <select
                        key={index}
                        aria-label={`Path parameter ${name}`}
                        value={pathValues[name] ?? ''}
                        onChange={(event) => setValue(event.target.value)}
                        className="w-36 border-b border-fog bg-transparent px-1 text-badge outline-none"
                      >
                        <option value="">{name}</option>
                        {enumValues.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    )
                  }
                  return (
                    <span key={index} className="inline-flex">
                      <input
                        aria-label={`Path parameter ${name}`}
                        value={pathValues[name] ?? ''}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={name}
                        list={uniqueSuggestions.length > 0 ? `path-options-${name}` : undefined}
                        className="w-36 border-b border-fog bg-transparent px-1 text-badge outline-none"
                      />
                      {uniqueSuggestions.length > 0 ? (
                        <datalist id={`path-options-${name}`}>
                          {uniqueSuggestions.map((option) => (
                            <option key={option} value={option} />
                          ))}
                        </datalist>
                      ) : null}
                    </span>
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
                  <div className="flex items-center gap-3">
                    {formModel.supported ? (
                      <div className="flex overflow-hidden rounded-md border border-line text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            if (bodyMode !== 'form') switchToForm()
                          }}
                          className={
                            bodyMode === 'form'
                              ? 'bg-badge px-2.5 py-1 font-semibold text-badge-ink'
                              : 'px-2.5 py-1 text-fog hover:text-mist'
                          }
                        >
                          Form
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (bodyMode !== 'raw') switchToRaw()
                          }}
                          className={
                            bodyMode === 'raw'
                              ? 'bg-badge px-2.5 py-1 font-semibold text-badge-ink'
                              : 'px-2.5 py-1 text-fog hover:text-mist'
                          }
                        >
                          Raw JSON
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void copyText(effectiveBodyText() ?? '', 'Body copied.')}
                      className="flex items-center gap-1.5 text-sm text-fog hover:text-mist"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy JSON
                    </button>
                  </div>
                </div>
                {formModel.supported && bodyMode === 'form' ? (
                  <SchemaBodyForm
                    fields={formModel.fields}
                    values={formValues}
                    errors={serializedBody?.errors ?? {}}
                    missing={serializedBody?.missing ?? []}
                    onChange={setFormValues}
                  />
                ) : (
                  <>
                    {!formModel.supported && formModel.note ? (
                      <p className="mb-2 text-xs text-fog">{formModel.note}</p>
                    ) : null}
                    <textarea
                      aria-label="Raw request body JSON"
                      value={bodyText}
                      onChange={(event) => setBodyText(event.target.value)}
                      rows={10}
                      spellCheck={false}
                      className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-mist outline-none focus:border-fog"
                    />
                    {rawParseError ? (
                      <p className="mt-1 text-sm text-red-400">
                        Invalid JSON: {rawParseError} — fix it to switch back to the form or
                        execute.
                      </p>
                    ) : null}
                  </>
                )}
                {bodyProblem && bodyMode === 'form' ? (
                  <p className="mt-2 text-sm text-red-400">{bodyProblem}</p>
                ) : null}
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
                  if (formModel.supported) {
                    const initial = initialFormValues(formModel)
                    setFormValues(initial)
                    setBodyText(serializeBody(formModel, initial).text)
                    setBodyMode('form')
                  } else {
                    setBodyText(
                      spec.data
                        ? (buildBodySkeleton(selected.requestBodySchema, spec.data) ?? '')
                        : '',
                    )
                  }
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
