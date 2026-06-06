import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'

function buildSnipUrl(snip) {
  const id = String(snip ?? '').trim()
  if (!id) return null
  return `https://sistemas.segeplan.gob.gt/guest/SNPPKG$PL_PROYECTOS.INFORMACION?prmIdSnip=${encodeURIComponent(id)}`
}

/**
 * DataTable
 * Props:
 *   columns: Array<{
 *     key: string,
 *     header: string,
 *     align?: 'left'|'right'|'center',
 *     width?: string (Tailwind / inline),
 *     sortable?: boolean (default true),
 *     accessor?: (row) => primitive  // value used for sorting
 *     render?: (row) => ReactNode,    // override visual cell
 *   }>
 *   data: Array<object>
 *   defaultSort: { key, direction: 'asc'|'desc' }
 *   rowClassName: (row) => string (optional override; default uses _risk)
 *   searchable?: boolean
 *   searchPlaceholder?: string
 *   pageSize?: number
 *   empty?: ReactNode
 */
export default function DataTable({
  columns,
  data,
  defaultSort = null,
  rowClassName = null,
  searchable = true,
  searchPlaceholder = 'Buscar…',
  pageSize = 25,
  empty = null,
  dense = false,
  onRowClick = null,
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(defaultSort)
  const [page, setPage] = useState(1)

  const safeData = Array.isArray(data) ? data : []

  const filtered = useMemo(() => {
    if (!search.trim()) return safeData
    const q = search.trim().toLowerCase()
    return safeData.filter((row) =>
      columns.some((c) => {
        const v = c.accessor ? c.accessor(row) : row[c.key]
        if (v == null) return false
        return String(v).toLowerCase().includes(q)
      })
    )
  }, [safeData, search, columns])

  const sorted = useMemo(() => {
    if (!sort || !sort.key) return filtered
    const col = columns.find((c) => c.key === sort.key)
    const getVal = (row) => (col && col.accessor ? col.accessor(row) : row[sort.key])
    const dir = sort.direction === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => {
      const av = getVal(a)
      const bv = getVal(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv), 'es', { numeric: true }) * dir
    })
  }, [filtered, sort, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const pageRows = sorted.slice(start, start + pageSize)

  const toggleSort = (key) => {
    const col = columns.find((c) => c.key === key)
    if (col && col.sortable === false) return
    setSort((s) => {
      if (!s || s.key !== key) return { key, direction: 'desc' }
      if (s.direction === 'desc') return { key, direction: 'asc' }
      return null
    })
  }

  const getRiskClass = (row) => {
    if (rowClassName) {
      const v = rowClassName(row)
      if (v) return v
    }
    const r = row && row._risk
    if (r === 'sin_meta') return 'bg-red-100 dark:bg-red-900/20'
    if (r === 'sospechoso') return 'bg-red-50 dark:bg-red-900/10'
    if (r === 'sobreejecucion') return 'bg-yellow-50 dark:bg-yellow-900/10'
    return ''
  }

  return (
    <div className="rounded-xl2 border border-line dark:border-d-line bg-white dark:bg-d-card shadow-card overflow-hidden">
      {searchable ? (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line dark:border-d-line">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-d-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-canvas dark:bg-d-canvas border border-line dark:border-d-line text-ink-800 dark:text-d-text placeholder:text-ink-400 dark:placeholder:text-d-muted focus:border-accent focus:outline-none"
            />
          </div>
          <div className="text-xs text-ink-500 dark:text-d-muted num">
            {sorted.length.toLocaleString('es-GT')} registros
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas/60 dark:bg-d-canvas/60 sticky top-0">
            <tr className="border-b border-line dark:border-d-line">
              {columns.map((c) => {
                const isSorted = sort && sort.key === c.key
                const align = c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                return (
                  <th
                    key={c.key}
                    className={`px-4 ${dense ? 'py-2' : 'py-3'} ${align} text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-d-muted whitespace-nowrap`}
                    style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                  >
                    {c.sortable === false ? (
                      <span>{c.header}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1.5 hover:text-accent transition-colors"
                      >
                        <span>{c.header}</span>
                        {isSorted ? (
                          sort.direction === 'desc' ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ArrowUp size={12} />
                          )
                        ) : (
                          <ArrowUpDown size={12} className="opacity-50" />
                        )}
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-ink-500 dark:text-d-muted">
                  {empty || 'Sin datos para mostrar.'}
                </td>
              </tr>
            ) : (
              pageRows.map((row, idx) => {
                const risk = getRiskClass(row)
                return (
                  <tr
                    key={idx}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`border-b border-line/70 dark:border-d-line/70 hover:bg-canvas/50 dark:hover:bg-d-canvas/40 transition-colors ${risk} ${onRowClick ? 'cursor-pointer' : ''}`}
                  >
                    {columns.map((c) => {
                      const align = c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                      const rawValue = row[c.key]
                      const content = c.render
                        ? c.render(row)
                        : c.key === 'snip' && rawValue != null && rawValue !== ''
                          ? (
                            <a
                              href={buildSnipUrl(rawValue)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {rawValue}
                            </a>
                            )
                          : rawValue
                      return (
                        <td
                          key={c.key}
                          className={`px-4 ${dense ? 'py-1.5' : 'py-2.5'} ${align} ${c.mono || c.align === 'right' ? 'num' : ''} text-ink-800 dark:text-d-text whitespace-nowrap`}
                        >
                          {content == null || content === '' ? <span className="text-ink-400 dark:text-d-muted">—</span> : content}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line dark:border-d-line text-xs text-ink-500 dark:text-d-muted">
          <span className="num">
            Página {safePage} de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="px-2 py-1 rounded-md border border-line dark:border-d-line hover:bg-canvas dark:hover:bg-d-canvas disabled:opacity-40"
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
            >
              Anterior
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded-md border border-line dark:border-d-line hover:bg-canvas dark:hover:bg-d-canvas disabled:opacity-40"
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage >= totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
