import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

/**
 * Custom searchable single-select dropdown.
 * Props:
 *   value: string | null
 *   options: string[] | Array<{label, value}>
 *   onChange: (value) => void
 *   placeholder: string
 *   label: string (optional)
 *   clearable: boolean (default true)
 */
export default function SearchableSelect({
  value,
  options = [],
  onChange,
  placeholder = 'Seleccionar…',
  label = null,
  clearable = true,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const inputRef = useRef(null)

  const normalized = useMemo(
    () =>
      options.map((o) =>
        typeof o === 'string' ? { label: o, value: o } : { label: o.label ?? String(o.value), value: o.value }
      ),
    [options]
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return normalized
    const q = query.toLowerCase()
    return normalized.filter((o) => o.label.toLowerCase().includes(q))
  }, [normalized, query])

  useEffect(() => {
    if (!open) return undefined
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  const display = normalized.find((o) => o.value === value)?.label || ''

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label ? (
        <label className="block text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-d-muted mb-1.5">
          {label}
        </label>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card hover:border-accent/60 transition-colors text-left"
      >
        <span className={`truncate ${display ? 'text-ink-800 dark:text-d-text' : 'text-ink-400 dark:text-d-muted'}`}>
          {display || placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {clearable && display ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onChange?.(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange?.(null)
                }
              }}
              className="text-ink-400 hover:text-ink-800 dark:text-d-muted dark:hover:text-d-text cursor-pointer"
              aria-label="Limpiar selección"
            >
              <X size={14} />
            </span>
          ) : null}
          <ChevronDown size={14} className={`text-ink-500 dark:text-d-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full bg-white dark:bg-d-card border border-line dark:border-d-line rounded-lg shadow-card-hover overflow-hidden">
          <div className="relative border-b border-line dark:border-d-line">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-d-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-transparent text-ink-800 dark:text-d-text placeholder:text-ink-400 dark:placeholder:text-d-muted focus:outline-none"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-500 dark:text-d-muted">Sin resultados</li>
            ) : (
              filtered.map((o) => {
                const selected = o.value === value
                return (
                  <li key={String(o.value)}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange?.(o.value)
                        setOpen(false)
                        setQuery('')
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-canvas dark:hover:bg-d-canvas transition-colors ${selected ? 'text-accent font-medium' : 'text-ink-800 dark:text-d-text'}`}
                    >
                      {o.label}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
