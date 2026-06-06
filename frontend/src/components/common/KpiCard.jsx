import InfoTooltip from './InfoTooltip.jsx'

export default function KpiCard({
  label,
  value,
  description = null,
  icon: Icon = null,
  tooltip = null,
  accent = 'default',
  onClick = null,
}) {
  const accents = {
    default: 'text-ink-800 dark:text-d-text',
    accent: 'text-accent',
    danger: 'text-red-600 dark:text-red-400',
    warn: 'text-amber-600 dark:text-amber-400',
    success: 'text-emerald-600 dark:text-emerald-400',
  }
  const iconBg = {
    default: 'bg-ink-800/5 text-ink-600 dark:bg-white/5 dark:text-d-muted',
    accent: 'bg-accent-soft text-accent dark:bg-accent/15',
    danger: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
    warn: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  }

  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`relative w-full text-left rounded-xl2 border border-line dark:border-d-line bg-white dark:bg-d-card shadow-card transition-shadow p-5 ${onClick ? 'cursor-pointer hover:border-accent/50 hover:shadow-card-hover' : 'hover:shadow-card-hover'}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium tracking-wide uppercase text-ink-500 dark:text-d-muted truncate">
            {label}
          </span>
          {tooltip ? <InfoTooltip text={tooltip} /> : null}
        </div>
        {Icon ? (
          <span className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg ${iconBg[accent] || iconBg.default}`}>
            <Icon size={16} />
          </span>
        ) : null}
      </div>
      <div className={`text-2xl md:text-[1.7rem] font-semibold num leading-tight ${accents[accent] || accents.default}`} style={{ fontFamily: 'Inter' }}>
        {value}
      </div>
      {description ? (
        <p className="mt-2 text-xs text-ink-500 dark:text-d-muted leading-relaxed">{description}</p>
      ) : null}
      {onClick ? (
        <p className="mt-2 text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity">Ver casos →</p>
      ) : null}
    </Tag>
  )
}
