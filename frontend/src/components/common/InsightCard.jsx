import { Sparkles } from 'lucide-react'
import InfoTooltip from './InfoTooltip.jsx'

/**
 * InsightCard – bullet list of key findings.
 * Props:
 *   title:       string
 *   subtitle:    string
 *   tooltip:     string
 *   items:       Array<{ label: string, value: ReactNode, explanation?: string } | string>
 *   onItemClick: (item) => void  — when provided, each item becomes a clickable button
 */
export default function InsightCard({
  title = 'Hallazgos clave',
  subtitle = null,
  tooltip = 'Resumen automático de las observaciones más relevantes según los filtros aplicados.',
  items = [],
  onItemClick = null,
}) {
  return (
    <section className="rounded-xl2 border border-line dark:border-d-line bg-white dark:bg-d-card shadow-card">
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-line dark:border-d-line">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft dark:bg-accent/15 text-accent shrink-0">
            <Sparkles size={18} />
          </span>
          <div>
            <h3 className="text-base font-semibold text-ink-800 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
              {title}
            </h3>
            {subtitle ? <p className="text-xs text-ink-500 dark:text-d-muted mt-0.5">{subtitle}</p> : null}
          </div>
        </div>
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </header>

      <ul className="divide-y divide-line dark:divide-d-line">
        {items.length === 0 ? (
          <li className="px-5 py-4 text-sm text-ink-500 dark:text-d-muted">
            No se identificaron hallazgos con los filtros actuales.
          </li>
        ) : (
          items.map((item, i) => {
            if (item == null) return null
            if (typeof item === 'string') {
              return (
                <li key={i} className="px-5 py-3 text-sm text-ink-800 dark:text-d-text leading-relaxed">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent mr-2 align-middle" />
                  {item}
                </li>
              )
            }
            if (onItemClick) {
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onItemClick(item)}
                    className="w-full px-5 py-3 flex items-start gap-3 text-left hover:bg-canvas/60 dark:hover:bg-d-canvas/40 transition-colors group"
                  >
                    <span className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-d-muted group-hover:text-accent transition-colors">
                        {item.label}
                      </div>
                      <div className="text-sm text-ink-800 dark:text-d-text mt-0.5 break-words">
                        {item.value}
                      </div>
                    </div>
                    <span className="shrink-0 mt-1 text-xs text-ink-400 dark:text-d-muted group-hover:text-accent transition-colors">
                      Ver →
                    </span>
                  </button>
                </li>
              )
            }
            return (
              <li key={i} className="px-5 py-3 flex items-start gap-3">
                <span className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-d-muted">
                    {item.label}
                  </div>
                  <div className="text-sm text-ink-800 dark:text-d-text mt-0.5 break-words">
                    {item.value}
                  </div>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </section>
  )
}
