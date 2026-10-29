// Pure schema engine for the API Playground's structured body editor.
//
// Turns an endpoint's JSON request-body schema (from the live
// /openapi.json, or the bundled demo fixture in demo mode) into a flat
// list of form fields, and converts between form state and the exact
// JSON body that Execute / Copy-as-cURL send. ONE serializer
// (serializeBody) is used by every consumer so the form, the raw view,
// Execute and cURL can never disagree about the body.
//
// Form-state representation (values: Record<string, unknown>):
// - string / enum fields        -> string ('' means unset)
// - number / integer fields     -> raw string from the input ('' unset)
// - boolean fields              -> boolean, or undefined when unset
// - array-of-primitives fields  -> comma-separated raw string
// - object fields (one level)   -> nested Record of child values
// - json fields (anything deeper or free-form) -> raw JSON text string
// - keys present in a parsed body but absent from the schema are kept
//   under EXTRA_KEY at each object level and merged back on serialize,
//   so switching Raw -> Form -> Raw never silently drops user input.
//
// Pragmatic depth: fields are structured at the top level and one
// nested object level; anything deeper becomes a per-field JSON
// mini-editor (kind 'json'). Endpoints whose body is not a plain
// object with properties (top-level arrays, free-form maps) report
// supported=false and the UI falls back to the raw editor.

import type { OpenApiDoc } from '../api/openapi'

export const EXTRA_KEY = '__extra'

export type FieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'json'

export interface FormField {
  name: string
  kind: FieldKind
  /** Chip label, e.g. "string", "array<string>", "enum". */
  typeLabel: string
  required: boolean
  description?: string
  enumValues?: string[]
  /** Item kind for kind === 'array' (arrays of primitives only). */
  itemKind?: 'string' | 'number' | 'integer' | 'boolean'
  /** Child fields for kind === 'object'. */
  children?: FormField[]
  /** Schema default / example, used for prefill. */
  prefill?: unknown
}

export interface BodyFormModel {
  supported: boolean
  /** Why the structured editor is unavailable (shown above the raw editor). */
  note?: string
  fields: FormField[]
}

export interface SerializeResult {
  ok: boolean
  /** The serialized body object (present even when ok=false, best effort). */
  body: Record<string, unknown>
  /** Pretty JSON text — the exact text Execute / cURL consume. */
  text: string
  /** Dot-path -> human error (invalid number / invalid nested JSON). */
  errors: Record<string, string>
  /** Dot-paths of required fields that are missing/empty. */
  missing: string[]
}

type Schema = Record<string, unknown>

// --- schema normalization -------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveSchemaRef(schema: Schema, doc: OpenApiDoc): Schema {
  let current = schema
  const seen = new Set<string>()
  while (typeof current.$ref === 'string' && !seen.has(current.$ref)) {
    seen.add(current.$ref)
    const name = current.$ref.split('/').pop() ?? ''
    const target = doc.components?.schemas?.[name]
    if (!target) break
    // Sibling keys (description etc.) win over the referenced schema.
    const { $ref: _ref, ...siblings } = current
    current = { ...target, ...siblings }
  }
  return current
}

// Flatten allOf by merging, and tolerate oneOf/anyOf by picking the
// first non-null variant — real Honcho schemas use anyOf almost
// exclusively as "T | null", so the first object/typed variant is the
// meaningful one. (Deliberate simplification, per Phase D spec.)
export function normalizeSchema(schema: Schema, doc: OpenApiDoc, depth = 0): Schema {
  if (depth > 6) return schema
  const resolved = resolveSchemaRef(schema, doc)

  const variants = (resolved.anyOf ?? resolved.oneOf) as Schema[] | undefined
  if (Array.isArray(variants) && variants.length > 0) {
    const chosen =
      variants.find((entry) => isRecord(entry) && entry.type !== 'null') ?? variants[0]
    if (isRecord(chosen)) {
      const { anyOf: _a, oneOf: _o, ...rest } = resolved
      return normalizeSchema({ ...chosen, ...rest }, doc, depth + 1)
    }
  }

  const allOf = resolved.allOf as Schema[] | undefined
  if (Array.isArray(allOf) && allOf.length > 0) {
    const merged: Schema = {}
    const properties: Record<string, Schema> = {}
    const required = new Set<string>()
    for (const part of allOf) {
      const flat = normalizeSchema(part, doc, depth + 1)
      Object.assign(merged, flat)
      if (isRecord(flat.properties)) Object.assign(properties, flat.properties)
      if (Array.isArray(flat.required)) {
        for (const name of flat.required as string[]) required.add(name)
      }
    }
    const { allOf: _all, ...rest } = resolved
    return {
      ...merged,
      ...rest,
      properties,
      required: [...required],
    }
  }

  return resolved
}

function schemaDescription(schema: Schema): string | undefined {
  return typeof schema.description === 'string' ? schema.description : undefined
}

function schemaPrefill(schema: Schema): unknown {
  if ('default' in schema) return schema.default
  if ('example' in schema) return schema.example
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0]
  return undefined
}

// --- form model -----------------------------------------------------------

function fieldFromSchema(
  name: string,
  rawSchema: Schema,
  required: boolean,
  doc: OpenApiDoc,
  depth: number,
): FormField {
  const schema = normalizeSchema(rawSchema, doc)
  const base = {
    name,
    required,
    description: schemaDescription(schema) ?? schemaDescription(rawSchema),
    prefill: schemaPrefill(schema),
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return { ...base, kind: 'enum', typeLabel: 'enum', enumValues: schema.enum.map(String) }
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined

  if (type === 'string') return { ...base, kind: 'string', typeLabel: 'string' }
  if (type === 'number' || type === 'integer') {
    return { ...base, kind: type, typeLabel: type }
  }
  if (type === 'boolean') return { ...base, kind: 'boolean', typeLabel: 'boolean' }

  if (type === 'array') {
    const items = isRecord(schema.items) ? normalizeSchema(schema.items, doc) : null
    const itemType = items && typeof items.type === 'string' ? items.type : undefined
    if (
      items &&
      (itemType === 'string' || itemType === 'number' || itemType === 'integer' || itemType === 'boolean')
    ) {
      return {
        ...base,
        kind: 'array',
        typeLabel: `array<${itemType}>`,
        itemKind: itemType,
      }
    }
    // Array of objects / unknown items -> JSON mini-editor.
    return { ...base, kind: 'json', typeLabel: 'array (JSON)' }
  }

  if (type === 'object' || isRecord(schema.properties)) {
    const properties = isRecord(schema.properties) ? schema.properties : null
    if (properties && depth < 1) {
      const childRequired = new Set(
        Array.isArray(schema.required) ? (schema.required as string[]) : [],
      )
      const children = Object.entries(properties).map(([childName, childSchema]) =>
        fieldFromSchema(
          childName,
          isRecord(childSchema) ? childSchema : {},
          childRequired.has(childName),
          doc,
          depth + 1,
        ),
      )
      return { ...base, kind: 'object', typeLabel: 'object', children }
    }
    // Free-form map or object past the structured depth -> JSON mini-editor.
    return { ...base, kind: 'json', typeLabel: 'object (JSON)' }
  }

  // No recognizable type (exotic schema) -> JSON mini-editor.
  return { ...base, kind: 'json', typeLabel: 'JSON' }
}

export function buildFormModel(
  schema: Record<string, unknown> | null,
  doc: OpenApiDoc,
): BodyFormModel {
  if (!schema) return { supported: false, note: 'This endpoint has no request body.', fields: [] }
  const normalized = normalizeSchema(schema, doc)
  const properties = isRecord(normalized.properties) ? normalized.properties : null
  if (!properties || Object.keys(properties).length === 0) {
    return {
      supported: false,
      note: 'This endpoint\u2019s body schema has no structured fields (array or free-form body) — use the raw JSON editor.',
      fields: [],
    }
  }
  const required = new Set(
    Array.isArray(normalized.required) ? (normalized.required as string[]) : [],
  )
  const fields = Object.entries(properties).map(([name, propertySchema]) =>
    fieldFromSchema(name, isRecord(propertySchema) ? propertySchema : {}, required.has(name), doc, 0),
  )
  return { supported: true, fields }
}

// --- form state: initial values, and body -> form -------------------------

function emptyValueFor(field: FormField): unknown {
  if (field.kind === 'object') {
    const record: Record<string, unknown> = {}
    for (const child of field.children ?? []) record[child.name] = initialValueFor(child)
    return record
  }
  if (field.kind === 'boolean') return undefined
  return ''
}

function initialValueFor(field: FormField): unknown {
  if (field.prefill !== undefined) return valueFromBody(field, field.prefill)
  return emptyValueFor(field)
}

export function initialFormValues(model: BodyFormModel): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of model.fields) values[field.name] = initialValueFor(field)
  return values
}

// Convert a parsed JSON value for one field into form-state form.
export function valueFromBody(field: FormField, value: unknown): unknown {
  if (value === null || value === undefined) return emptyValueFor(field)
  switch (field.kind) {
    case 'string':
    case 'enum':
      return typeof value === 'string' ? value : String(value)
    case 'number':
    case 'integer':
      return typeof value === 'number' ? String(value) : ''
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'array': {
      if (!Array.isArray(value)) return ''
      return value.map((item) => String(item)).join(', ')
    }
    case 'object': {
      if (!isRecord(value)) return emptyValueFor(field)
      const record: Record<string, unknown> = {}
      const known = new Set<string>()
      for (const child of field.children ?? []) {
        known.add(child.name)
        record[child.name] = valueFromBody(child, value[child.name])
      }
      const extra: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        if (!known.has(key)) extra[key] = entry
      }
      if (Object.keys(extra).length > 0) record[EXTRA_KEY] = extra
      return record
    }
    case 'json':
      return JSON.stringify(value, null, 2)
    default:
      return ''
  }
}

export function valuesFromBody(
  model: BodyFormModel,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const known = new Set<string>()
  for (const field of model.fields) {
    known.add(field.name)
    values[field.name] = valueFromBody(field, body[field.name])
  }
  const extra: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(body)) {
    if (!known.has(key)) extra[key] = entry
  }
  if (Object.keys(extra).length > 0) values[EXTRA_KEY] = extra
  return values
}

// Parse raw JSON text into form values. Never throws: a bad parse
// returns the error so the UI can show it inline and keep the text.
export function parseRawToForm(
  model: BodyFormModel,
  text: string,
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'Request body must be a JSON object for the form view.' }
  }
  return { ok: true, values: valuesFromBody(model, parsed) }
}

// --- the one serializer: form state -> body -------------------------------

function serializeField(
  field: FormField,
  value: unknown,
  path: string,
  errors: Record<string, string>,
  missing: string[],
): unknown {
  // Returns the value to include in the body, or undefined to omit it.
  switch (field.kind) {
    case 'string':
    case 'enum': {
      const text = typeof value === 'string' ? value : ''
      if (text.length === 0) {
        if (field.required) missing.push(path)
        return undefined
      }
      return text
    }
    case 'number':
    case 'integer': {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text.length === 0) {
        if (field.required) missing.push(path)
        return undefined
      }
      const parsed = Number(text)
      if (!Number.isFinite(parsed) || (field.kind === 'integer' && !Number.isInteger(parsed))) {
        errors[path] = `"${path}" must be a valid ${field.kind}.`
        return undefined
      }
      return parsed
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        if (field.required) missing.push(path)
        return undefined
      }
      return value
    }
    case 'array': {
      const text = typeof value === 'string' ? value : ''
      const tokens = text
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
      if (tokens.length === 0) {
        if (field.required) missing.push(path)
        return undefined
      }
      if (field.itemKind === 'number' || field.itemKind === 'integer') {
        const numbers = tokens.map((token) => Number(token))
        if (numbers.some((entry) => !Number.isFinite(entry))) {
          errors[path] = `"${path}" must be a comma-separated list of numbers.`
          return undefined
        }
        return numbers
      }
      if (field.itemKind === 'boolean') {
        if (tokens.some((token) => token !== 'true' && token !== 'false')) {
          errors[path] = `"${path}" must be a comma-separated list of true/false.`
          return undefined
        }
        return tokens.map((token) => token === 'true')
      }
      return tokens
    }
    case 'object': {
      const record = isRecord(value) ? value : {}
      const result: Record<string, unknown> = {}
      const extra = isRecord(record[EXTRA_KEY]) ? record[EXTRA_KEY] : null
      if (extra) Object.assign(result, extra)
      for (const child of field.children ?? []) {
        const childValue = serializeField(child, record[child.name], `${path}.${child.name}`, errors, missing)
        if (childValue !== undefined) result[child.name] = childValue
      }
      if (Object.keys(result).length === 0) {
        if (field.required) missing.push(path)
        return undefined
      }
      return result
    }
    case 'json': {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text.length === 0) {
        if (field.required) missing.push(path)
        return undefined
      }
      try {
        return JSON.parse(text)
      } catch {
        errors[path] = `"${path}" is not valid JSON.`
        return undefined
      }
    }
    default:
      return undefined
  }
}

export function serializeBody(
  model: BodyFormModel,
  values: Record<string, unknown>,
): SerializeResult {
  const errors: Record<string, string> = {}
  const missing: string[] = []
  const body: Record<string, unknown> = {}
  const extra = isRecord(values[EXTRA_KEY]) ? values[EXTRA_KEY] : null
  if (extra) Object.assign(body, extra)
  for (const field of model.fields) {
    const value = serializeField(field, values[field.name], field.name, errors, missing)
    if (value !== undefined) body[field.name] = value
  }
  const ok = missing.length === 0 && Object.keys(errors).length === 0
  return { ok, body, text: JSON.stringify(body, null, 2), errors, missing }
}

// --- path-parameter helpers (D4) ------------------------------------------

// Enum / example options a parameter's own schema offers (dropdown or
// datalist suggestions). Returns [] when the spec offers neither — the
// UI then uses a plain input; nothing is ever fabricated here.
export function parameterOptions(schema: Record<string, unknown> | undefined): string[] {
  if (!schema) return []
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum.map(String)
  const options: string[] = []
  if ('example' in schema && schema.example !== undefined) options.push(String(schema.example))
  if (Array.isArray(schema.examples)) {
    for (const entry of schema.examples) options.push(String(entry))
  }
  return options
}
