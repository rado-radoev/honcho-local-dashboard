import { parameterInputSpec } from '../lib/schemaForm'

// The ONE renderer for Playground parameters — path and query alike.
// Enum parameters get a <select> dropdown of the schema's values;
// every other parameter stays a free-text <input>, with the schema's
// examples (plus caller-supplied suggestions, e.g. live workspace
// ids) offered through a <datalist> when the spec provides any. The
// select-vs-input decision lives in parameterInputSpec (lib, tested);
// this component is rendering only. Two visual variants: 'inline' for
// path parameters embedded in the URL bar, 'field' for the boxed
// query-parameter rows.

interface ParameterInputProps {
  name: string
  ariaLabel: string
  schema?: Record<string, unknown>
  extraSuggestions?: string[]
  value: string
  onChange: (value: string) => void
  variant: 'inline' | 'field'
  /** Unique datalist id for this parameter instance. */
  listId: string
  placeholder?: string
}

const INLINE_CLASS = 'w-36 border-b border-fog bg-transparent px-1 text-badge outline-none'
const FIELD_CLASS =
  'w-full max-w-sm rounded-md border border-line bg-panel px-3 py-2 text-sm text-mist outline-none focus:border-fog'

export function ParameterInput(props: ParameterInputProps) {
  const spec = parameterInputSpec(props.schema, props.extraSuggestions ?? [])
  const className = props.variant === 'inline' ? INLINE_CLASS : FIELD_CLASS

  if (spec.mode === 'select') {
    return (
      <select
        aria-label={props.ariaLabel}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={className}
      >
        <option value="">{props.variant === 'inline' ? props.name : ''}</option>
        {spec.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }

  const input = (
    <input
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      list={spec.options.length > 0 ? props.listId : undefined}
      className={className}
    />
  )
  if (spec.options.length === 0) return input
  const datalist = (
    <datalist id={props.listId}>
      {spec.options.map((option) => (
        <option key={option} value={option} />
      ))}
    </datalist>
  )
  if (props.variant === 'inline') {
    return (
      <span className="inline-flex">
        {input}
        {datalist}
      </span>
    )
  }
  return (
    <>
      {input}
      {datalist}
    </>
  )
}
