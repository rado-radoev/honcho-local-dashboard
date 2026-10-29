import type { FormField } from '../lib/schemaForm'
import { EXTRA_KEY } from '../lib/schemaForm'

// Structured request-body form for the API Playground, driven by the
// field model from lib/schemaForm. Rendering only — all conversion
// logic lives in the lib. No nested ternaries: each field kind gets its
// own small renderer chosen by an if-chain.

interface FieldRowProps {
  field: FormField
  value: unknown
  path: string
  errors: Record<string, string>
  missing: Set<string>
  onChange: (value: unknown) => void
}

const inputClass =
  'w-full max-w-md rounded-md border border-line bg-panel px-3 py-2 text-sm text-mist outline-none focus:border-fog'

function FieldShell(props: {
  field: FormField
  path: string
  errors: Record<string, string>
  missing: Set<string>
  children: React.ReactNode
}) {
  const { field } = props
  const error = props.errors[props.path]
  const isMissing = props.missing.has(props.path)
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5" data-field={props.path}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-mist">
          {field.name}
          {field.required ? <span className="text-red-400"> *</span> : null}
        </span>
        <span className="rounded bg-ink px-1.5 py-0.5 text-[11px] text-fog">{field.typeLabel}</span>
        {isMissing ? <span className="text-xs text-red-400">required</span> : null}
      </div>
      {props.children}
      {field.description ? (
        <p className="mt-1 line-clamp-2 text-xs text-fog" title={field.description}>
          {field.description}
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  )
}

function TextLikeInput(props: FieldRowProps & { numeric?: boolean; placeholder?: string }) {
  const text = typeof props.value === 'string' ? props.value : ''
  return (
    <input
      aria-label={`Body field ${props.path}`}
      type={props.numeric ? 'number' : 'text'}
      value={text}
      placeholder={props.placeholder}
      onChange={(event) => props.onChange(event.target.value)}
      className={inputClass}
    />
  )
}

function BooleanInput(props: FieldRowProps) {
  let selected = ''
  if (props.value === true) selected = 'true'
  if (props.value === false) selected = 'false'
  return (
    <select
      aria-label={`Body field ${props.path}`}
      value={selected}
      onChange={(event) => {
        if (event.target.value === 'true') props.onChange(true)
        else if (event.target.value === 'false') props.onChange(false)
        else props.onChange(undefined)
      }}
      className={inputClass}
    >
      <option value="">(unset)</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  )
}

function EnumInput(props: FieldRowProps) {
  const text = typeof props.value === 'string' ? props.value : ''
  return (
    <select
      aria-label={`Body field ${props.path}`}
      value={text}
      onChange={(event) => props.onChange(event.target.value)}
      className={inputClass}
    >
      <option value="">(unset)</option>
      {(props.field.enumValues ?? []).map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function JsonInput(props: FieldRowProps) {
  const text = typeof props.value === 'string' ? props.value : ''
  return (
    <textarea
      aria-label={`Body field ${props.path}`}
      value={text}
      rows={3}
      spellCheck={false}
      placeholder="JSON…"
      onChange={(event) => props.onChange(event.target.value)}
      className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-mist outline-none focus:border-fog"
    />
  )
}

function ObjectInput(props: FieldRowProps) {
  const record =
    typeof props.value === 'object' && props.value !== null && !Array.isArray(props.value)
      ? (props.value as Record<string, unknown>)
      : {}
  return (
    <div className="flex flex-col gap-2">
      {(props.field.children ?? []).map((child) => (
        <FieldRow
          key={child.name}
          field={child}
          value={record[child.name]}
          path={`${props.path}.${child.name}`}
          errors={props.errors}
          missing={props.missing}
          onChange={(childValue) => props.onChange({ ...record, [child.name]: childValue })}
        />
      ))}
    </div>
  )
}

function FieldControl(props: FieldRowProps) {
  const kind = props.field.kind
  if (kind === 'string') return <TextLikeInput {...props} />
  if (kind === 'number' || kind === 'integer') return <TextLikeInput {...props} numeric />
  if (kind === 'boolean') return <BooleanInput {...props} />
  if (kind === 'enum') return <EnumInput {...props} />
  if (kind === 'array') return <TextLikeInput {...props} placeholder="comma, separated, values" />
  if (kind === 'object') return <ObjectInput {...props} />
  return <JsonInput {...props} />
}

function FieldRow(props: FieldRowProps) {
  return (
    <FieldShell field={props.field} path={props.path} errors={props.errors} missing={props.missing}>
      <FieldControl {...props} />
    </FieldShell>
  )
}

export function SchemaBodyForm(props: {
  fields: FormField[]
  values: Record<string, unknown>
  errors: Record<string, string>
  missing: string[]
  onChange: (values: Record<string, unknown>) => void
}) {
  const missingSet = new Set(props.missing)
  const extra = props.values[EXTRA_KEY]
  const extraKeys =
    typeof extra === 'object' && extra !== null ? Object.keys(extra as Record<string, unknown>) : []
  return (
    <div className="flex flex-col gap-2">
      {props.fields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          value={props.values[field.name]}
          path={field.name}
          errors={props.errors}
          missing={missingSet}
          onChange={(value) => props.onChange({ ...props.values, [field.name]: value })}
        />
      ))}
      {extraKeys.length > 0 ? (
        <p className="text-xs text-fog">
          Also preserved from raw JSON (not in the schema): {extraKeys.join(', ')}
        </p>
      ) : null}
    </div>
  )
}
