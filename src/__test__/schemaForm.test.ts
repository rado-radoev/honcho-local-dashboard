import { describe, expect, it } from 'vitest'
import type { OpenApiDoc } from '../api/openapi'
import demoSpecJson from '../api/demoOpenApi.json'
import {
  buildFormModel,
  initialFormValues,
  normalizeSchema,
  parameterOptions,
  parseRawToForm,
  resolveSchemaRef,
  serializeBody,
  valuesFromBody,
} from '../lib/schemaForm'

// Phase D: the pure schema engine behind the Playground's structured
// body editor — $ref resolution, allOf flattening, anyOf tolerance,
// enums, required validation, defaults/examples prefill, nested
// objects, and the form -> JSON -> form round-trip, exercised against
// both hand-built schemas and the real bundled demo fixture spec.

const demoDoc = demoSpecJson as unknown as OpenApiDoc

const doc: OpenApiDoc = {
  paths: {},
  components: {
    schemas: {
      Inner: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          level: { type: 'integer', default: 3 },
        },
        required: ['enabled'],
      },
      Outer: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name' },
          count: { type: 'number' },
          mode: { type: 'string', enum: ['fast', 'slow'] },
          tags: { type: 'array', items: { type: 'string' } },
          inner: { $ref: '#/components/schemas/Inner' },
          deep: {
            type: 'object',
            properties: {
              nested: { type: 'object', properties: { leaf: { type: 'string' } } },
            },
          },
          blob: { type: 'object', additionalProperties: true },
        },
        required: ['name', 'inner'],
      },
    },
  },
}

function outerModel() {
  return buildFormModel({ $ref: '#/components/schemas/Outer' }, doc)
}

describe('schema resolution', () => {
  it('resolves $ref against components.schemas', () => {
    const resolved = resolveSchemaRef({ $ref: '#/components/schemas/Inner' }, doc)
    expect(resolved.type).toBe('object')
    expect(resolved.properties).toBeDefined()
  })

  it('flattens allOf, merging properties and required', () => {
    const flat = normalizeSchema(
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'boolean' } }, required: ['b'] },
        ],
      },
      doc,
    )
    expect(Object.keys(flat.properties as object)).toEqual(['a', 'b'])
    expect(flat.required).toEqual(['a', 'b'])
  })

  it('tolerates anyOf by picking the first non-null variant', () => {
    const picked = normalizeSchema(
      { anyOf: [{ $ref: '#/components/schemas/Inner' }, { type: 'null' }] },
      doc,
    )
    expect(picked.type).toBe('object')
    expect(picked.properties).toBeDefined()
  })
})

describe('buildFormModel', () => {
  it('classifies top-level fields and one nested level', () => {
    const model = outerModel()
    expect(model.supported).toBe(true)
    const byName = new Map(model.fields.map((field) => [field.name, field]))
    expect(byName.get('name')?.kind).toBe('string')
    expect(byName.get('name')?.required).toBe(true)
    expect(byName.get('name')?.description).toBe('Display name')
    expect(byName.get('count')?.kind).toBe('number')
    expect(byName.get('mode')?.kind).toBe('enum')
    expect(byName.get('mode')?.enumValues).toEqual(['fast', 'slow'])
    expect(byName.get('tags')?.kind).toBe('array')
    expect(byName.get('tags')?.itemKind).toBe('string')
    const inner = byName.get('inner')
    expect(inner?.kind).toBe('object')
    expect(inner?.children?.map((child) => child.name)).toEqual(['enabled', 'level'])
    // Deeper than one nested level -> JSON mini-editor.
    const deep = byName.get('deep')
    expect(deep?.kind).toBe('object')
    expect(deep?.children?.[0]?.kind).toBe('json')
    // Free-form map -> JSON mini-editor.
    expect(byName.get('blob')?.kind).toBe('json')
  })

  it('reports unsupported for array and free-form top-level bodies', () => {
    const arrayModel = buildFormModel({ type: 'array', items: { type: 'string' } }, doc)
    expect(arrayModel.supported).toBe(false)
    expect(arrayModel.note).toContain('raw JSON editor')
    const mapModel = buildFormModel(
      { type: 'object', additionalProperties: { $ref: '#/components/schemas/Inner' } },
      doc,
    )
    expect(mapModel.supported).toBe(false)
  })

  it('builds a model from the real fixture WorkspaceCreate schema', () => {
    const model = buildFormModel({ $ref: '#/components/schemas/WorkspaceCreate' }, demoDoc)
    expect(model.supported).toBe(true)
    const byName = new Map(model.fields.map((field) => [field.name, field]))
    expect(byName.get('id')?.kind).toBe('string')
    expect(byName.get('id')?.required).toBe(true)
    expect(byName.get('metadata')?.kind).toBe('json')
    const configuration = byName.get('configuration')
    expect(configuration?.kind).toBe('object')
    const childNames = (configuration?.children ?? []).map((child) => child.name)
    expect(childNames).toContain('reasoning')
    expect(childNames).toContain('custom_instructions')
  })
})

describe('prefill from defaults and examples', () => {
  it('uses schema default, then example', () => {
    const model = buildFormModel(
      {
        type: 'object',
        properties: {
          retries: { type: 'integer', default: 5 },
          label: { type: 'string', example: 'hello' },
          plain: { type: 'string' },
        },
      },
      doc,
    )
    const values = initialFormValues(model)
    expect(values.retries).toBe('5')
    expect(values.label).toBe('hello')
    expect(values.plain).toBe('')
    const serialized = serializeBody(model, values)
    expect(serialized.body).toEqual({ retries: 5, label: 'hello' })
  })

  it('prefills nested defaults from the referenced schema', () => {
    const values = initialFormValues(outerModel())
    const inner = values.inner as Record<string, unknown>
    expect(inner.level).toBe('3')
  })
})

describe('serializeBody', () => {
  it('serializes typed values and omits unset optionals', () => {
    const model = outerModel()
    const values = valuesFromBody(model, {
      name: 'ws',
      count: 2.5,
      mode: 'fast',
      tags: ['a', 'b'],
      inner: { enabled: true, level: 7 },
    })
    const result = serializeBody(model, values)
    expect(result.ok).toBe(true)
    expect(result.body).toEqual({
      name: 'ws',
      count: 2.5,
      mode: 'fast',
      tags: ['a', 'b'],
      inner: { enabled: true, level: 7 },
    })
    expect(JSON.parse(result.text)).toEqual(result.body)
  })

  it('flags missing required fields and blocks', () => {
    const model = outerModel()
    const result = serializeBody(model, initialFormValues(model))
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('name')
    expect(result.missing).toContain('inner.enabled')
  })

  it('flags invalid numbers and invalid nested JSON', () => {
    const model = outerModel()
    const values = valuesFromBody(model, { name: 'x', inner: { enabled: true } })
    values.count = 'not-a-number'
    values.blob = '{oops'
    const result = serializeBody(model, values)
    expect(result.ok).toBe(false)
    expect(result.errors.count).toContain('valid number')
    expect(result.errors.blob).toContain('not valid JSON')
  })

  it('preserves unknown keys from a parsed body through the form', () => {
    const model = outerModel()
    const values = valuesFromBody(model, {
      name: 'x',
      inner: { enabled: false },
      future_field: { kept: true },
    })
    const result = serializeBody(model, values)
    expect(result.ok).toBe(true)
    expect(result.body.future_field).toEqual({ kept: true })
  })
})

describe('round-trip form -> JSON -> form', () => {
  it('is stable for a fully populated body', () => {
    const model = outerModel()
    const start = valuesFromBody(model, {
      name: 'ws',
      count: 1.25,
      mode: 'slow',
      tags: ['x', 'y', 'z'],
      inner: { enabled: true, level: 9 },
      deep: { nested: { leaf: 'hi' } },
      blob: { any: ['thing'] },
    })
    const first = serializeBody(model, start)
    expect(first.ok).toBe(true)
    const reparsed = parseRawToForm(model, first.text)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    const second = serializeBody(model, reparsed.values)
    expect(second.ok).toBe(true)
    expect(second.text).toBe(first.text)
  })

  it('reports invalid raw JSON instead of throwing', () => {
    const model = outerModel()
    const result = parseRawToForm(model, '{not json')
    expect(result.ok).toBe(false)
    const nonObject = parseRawToForm(model, '["a"]')
    expect(nonObject.ok).toBe(false)
  })

  it('round-trips the fixture create-workspace body', () => {
    const model = buildFormModel({ $ref: '#/components/schemas/WorkspaceCreate' }, demoDoc)
    const values = valuesFromBody(model, {
      id: 'my-workspace',
      metadata: { team: 'demo' },
      configuration: { reasoning: { enabled: false } },
    })
    const first = serializeBody(model, values)
    expect(first.ok).toBe(true)
    expect(first.body.id).toBe('my-workspace')
    const reparsed = parseRawToForm(model, first.text)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(serializeBody(model, reparsed.values).text).toBe(first.text)
  })
})

describe('parameterOptions', () => {
  it('returns enum values, then example(s), else nothing', () => {
    expect(parameterOptions({ enum: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(parameterOptions({ example: 'ex-1' })).toEqual(['ex-1'])
    expect(parameterOptions({ examples: ['x', 'y'] })).toEqual(['x', 'y'])
    expect(parameterOptions({ type: 'string' })).toEqual([])
    expect(parameterOptions(undefined)).toEqual([])
  })
})
