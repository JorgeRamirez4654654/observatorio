import InfoTooltip from './InfoTooltip.jsx'

export default function SectionCard({
  title,
  subtitle = null,
  tooltip = null,
  actions = null,
  children,
  className = '',
  bodyClassName = '',
  noPadding = false,
}) {
  return (
    <section className={`rounded-xl2 border border-line dark:border-d-line bg-white dark:bg-d-card shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-line dark:border-d-line">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {title ? (
                <h3
                  className="text-base font-semibold text-ink-800 dark:text-d-text"
                  style={{ fontFamily: 'Libre Baskerville' }}
                >
                  {title}
                </h3>
              ) : null}
              {tooltip ? <InfoTooltip text={tooltip} /> : null}
            </div>
            {subtitle ? (
              <p className="text-xs text-ink-500 dark:text-d-muted mt-1 leading-relaxed">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      )}
      <div className={`${noPadding ? '' : 'p-5'} ${bodyClassName}`}>{children}</div>
    </section>
  )
}
