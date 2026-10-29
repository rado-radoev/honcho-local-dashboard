// Minimal OpenAPI handling for the API Playground: parse a fetched
// /openapi.json document into a flat endpoint list grouped by tag,
// extract path parameters, generate a JSON request-body skeleton from a
// schema, and render a cURL command. Pure functions — unit-tested.

export interface OpenApiParameter {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: Record<string, unknown>
}

export interface OpenApiOperation {
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: Record<string, unknown> }>
  }
  responses?: Record<string, unknown>
}

export interface OpenApiDoc {
  info?: { title?: string; version?: string }
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: { schemas?: Record<string, Record<string, unknown>> }
}

export interface PlaygroundEndpoint {
  method: string // GET | POST | PUT | DELETE | PATCH
  path: string
  summary: string
  description: string
  tag: string
  parameters: OpenApiParameter[]
  requestBodySchema: Record<string, unknown> | null
}

const METHODS = ['get', 'post', 'put', 'delete', 'patch']

export function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function parseEndpoints(doc: OpenApiDoc): PlaygroundEndpoint[] {
  const endpoints: PlaygroundEndpoint[] = []
  for (const [path, operations] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const operation = operations[method]
      if (!operation) continue
      const jsonContent = operation.requestBody?.content?.['application/json']
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? `${method.toUpperCase()} ${path}`,
        description: operation.description ?? operation.summary ?? '',
        tag: operation.tags?.[0] ?? 'other',
        parameters: operation.parameters ?? [],
        requestBodySchema: jsonContent?.schema ?? null,
      })
    }
  }
  return endpoints
}

export function groupEndpointsByTag(
  endpoints: PlaygroundEndpoint[],
): Array<{ tag: string; endpoints: PlaygroundEndpoint[] }> {
  const groups = new Map<string, PlaygroundEndpoint[]>()
  for (const endpoint of endpoints) {
    const list = groups.get(endpoint.tag) ?? []
    list.push(endpoint)
    groups.set(endpoint.tag, list)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, list]) => ({ tag, endpoints: list }))
}

export function listTags(endpoints: PlaygroundEndpoint[]): string[] {
  return [...new Set(endpoints.map((endpoint) => endpoint.tag))].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function extractPathParams(path: string): string[] {
  const matches = path.match(/\{([^}]+)\}/g) ?? []
  return matches.map((match) => match.slice(1, -1))
}

export function fillPathParams(path: string, values: Record<string, string>): string {
  let result = path
  for (const [name, value] of Object.entries(values)) {
    result = result.replace(`{${name}}`, encodeURIComponent(value))
  }
  return result
}

function resolveRef(
  schema: Record<string, unknown>,
  doc: OpenApiDoc,
): Record<string, unknown> {
  const ref = schema.$ref
  if (typeof ref !== 'string') return schema
  const name = ref.split('/').pop() ?? ''
  return doc.components?.schemas?.[name] ?? schema
}

function skeletonForSchema(
  schema: Record<string, unknown>,
  doc: OpenApiDoc,
  depth: number,
): unknown {
  if (depth > 3) return {}
  const resolved = resolveRef(schema, doc)

  const anyOf = resolved.anyOf as Array<Record<string, unknown>> | undefined
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const nonNull = anyOf.find((entry) => entry.type !== 'null') ?? anyOf[0]
    return skeletonForSchema(nonNull, doc, depth + 1)
  }
  const allOf = resolved.allOf as Array<Record<string, unknown>> | undefined
  if (Array.isArray(allOf) && allOf.length > 0) {
    return skeletonForSchema(allOf[0], doc, depth + 1)
  }

  const type = resolved.type as string | undefined
  if (type === 'array') {
    const items = resolved.items as Record<string, unknown> | undefined
    return [items ? skeletonForSchema(items, doc, depth + 1) : '']
  }
  if (type === 'string') return ''
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false

  // Object (explicit or implied by properties / additionalProperties).
  const properties = resolved.properties as Record<string, Record<string, unknown>> | undefined
  if (properties) {
    const required = new Set((resolved.required as string[] | undefined) ?? [])
    const result: Record<string, unknown> = {}
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (required.size === 0 || required.has(key)) {
        result[key] = skeletonForSchema(propertySchema, doc, depth + 1)
      }
    }
    return result
  }
  const additional = resolved.additionalProperties
  if (typeof additional === 'object' && additional !== null) {
    // Map type (e.g. session peers: { peerId: SessionPeerConfig }).
    return { example_id: skeletonForSchema(additional as Record<string, unknown>, doc, depth + 1) }
  }
  return {}
}

// Generate a JSON body containing the schema's required fields (all
// fields when none are marked required), resolving $refs and one level
// of nested objects/arrays. Returns null when there is no body schema.
export function buildBodySkeleton(
  schema: Record<string, unknown> | null,
  doc: OpenApiDoc,
): string | null {
  if (!schema) return null
  const value = skeletonForSchema(schema, doc, 0)
  return JSON.stringify(value, null, 2)
}

export function methodPillLabel(method: string): string {
  if (method === 'DELETE') return 'DEL'
  return method
}

export function buildCurl(args: {
  method: string
  url: string
  token?: string
  bodyText?: string
}): string {
  const lines = [`curl -X ${args.method} '${args.url}'`]
  if (args.token) lines.push(`  -H 'Authorization: Bearer ${args.token}'`)
  if (args.bodyText && args.bodyText.trim().length > 0) {
    lines.push(`  -H 'Content-Type: application/json'`)
    lines.push(`  -d '${args.bodyText.replace(/'/g, `'\\''`)}'`)
  }
  return lines.join(' \\\n')
}
