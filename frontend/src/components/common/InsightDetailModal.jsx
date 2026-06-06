import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/**
 * InsightDetailModal
 * Shows the label, value, and fraud-analysis explanation of an insight item.
 * Props:
 *   item: { label, value, explanation? }
 *   onClose: () => void
 */
export default function InsightDetailModal({ item, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-d-card rounded-xl2 shadow-2xl border border-line dark:border-d-line w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line dark:border-d-line shrink-0">
          <h2
            className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-d-muted"
            style={{ fontFamily: 'Inter' }}
          >
            {item.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-lg hover:bg-canvas dark:hover:bg-d-canvas text-ink-400 hover:text-ink-700 dark:text-d-muted dark:hover:text-d-text transition-colors"
          >
            <X size={16} />
          </button>
        </header>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Finding */}
          <div
            className="text-base text-ink-800 dark:text-d-text leading-relaxed"
            style={{ fontFamily: 'Libre Baskerville' }}
          >
            {item.value}
          </div>

          {/* Fraud-analysis explanation */}
          {item.explanation ? (
            <div className="flex gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-4">
              <AlertTriangle
                size={15}
                className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
              />
              <p className="text-sm text-ink-800 dark:text-d-text leading-relaxed">
                {item.explanation}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
