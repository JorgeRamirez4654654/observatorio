import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

/**
 * Custom multi-select dropdown with checkboxes and search.
 * Props:
 *   label: string
 *   options: string[]
 *   value: string[]
 *   onChange: (string[]) => void
 *   onApply: () => void  (optional — close + apply filters from inside the dropdown)
 *   placeholder: string
 *   disabled: boolean
 *   variant?: 'light' | 'dark' (dark fits dark sidebars)
 */
export default function MultiSelect({
  label,
  options = [],
  value = [],
  onChange,
  onApply,
  placeholder = 'Todos',
  disabled = false,
  variant = 'dark',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const inputRef = useRef(null)

  const dark = variant === 'dark'

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return undefined
    const onMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Focus search input when opened; clear query when closed
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      setQuery('')
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter((o) => String(o).toLowerCase().includes(q))
  }, [options, query])

  const toggle = (opt) => {
    if (value.includes(opt)) onChange?.(value.filter((v) => v !== opt))
    else onChange?.([...value, opt])
  }

  const clear = (e) => {
    e?.stopPropagation()
    onChange?.([])
  }

  const handleApply = () => {
    setOpen(false)
    onApply?.()
  }

  const summary = value.length === 0 ? placeholder : value.length === 1 ? value[0] : `${value.length} seleccionados`

  const triggerCls = dark
    ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
    : 'bg-white hover:border-accent/60 border-line dark:bg-d-card dark:border-d-line text-ink-800 dark:text-d-text'

  const labelCls = dark
    ? 'text-white/60'
    : 'text-ink-500 dark:text-d-muted'

  return (
    <div ref={ref} className="relative">
      {label ? (
        <label className={`block text-[11px] font-medium uppercase tracking-wide mb-1.5 ${labelCls}`}>
          {label}
        </label>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${triggerCls}`}
      >
        <span className={`truncate text-left ${value.length === 0 ? (dark ? 'text-white/50' : 'text-ink-400') : ''}`}>
          {summary}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {value.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  clear(e)
                }
              }}
              className={`p-0.5 rounded ${dark ? 'text-white/60 hover:text-white' : 'text-ink-400 hover:text-ink-800'} cursor-pointer`}
              aria-label="Limpiar selección"
            >
              <X size={13} />
            </span>
          ) : null}
          <ChevronDown size={14} className={`${open ? 'rotate-180' : ''} transition-transform ${dark ? 'text-white/60' : 'text-ink-500'}`} />
        </span>
      </button>

      {open ? (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-d-card border border-line dark:border-d-line rounded-lg shadow-card-hover overflow-hidden">
          <div className="relative border-b border-line dark:border-d-line">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-d-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-transparent text-ink-800 dark:text-d-text placeholder:text-ink-400 focus:outline-none"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-500 dark:text-d-muted">Sin resultados</li>
            ) : (
              filtered.map((opt) => {
                const checked = value.includes(opt)
                return (
                  <li key={opt}>
                    <button
                      type="button"
                      onClick={() => toggle(opt)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-canvas dark:hover:bg-d-canvas text-left"
                    >
                      <span
                        className={`flex-shrink-0 flex items-center justify-center h-4 w-4 rounded border ${checked ? 'bg-accent border-accent text-white' : 'border-line dark:border-d-line text-transparent'}`}
                      >
                        <Check size={12} />
                      </span>
                      <span className="text-ink-800 dark:text-d-text truncate">{opt}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {value.length > 0 ? (
            <div className="border-t border-line dark:border-d-line px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-ink-500 dark:text-d-muted num">{value.length} seleccionados</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onChange?.([])}
                  className="text-ink-400 dark:text-d-muted hover:text-ink-700 dark:hover:text-d-text"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  className="text-accent font-medium hover:underline"
                >
                  Aplicar
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
