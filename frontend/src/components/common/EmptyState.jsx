import { Inbox } from 'lucide-react'

export default function EmptyState({
  title = 'No hay datos disponibles',
  message = 'Ajusta los filtros o vuelve a intentarlo más tarde.',
  icon: Icon = Inbox,
  action = null,
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl2 border border-dashed border-line dark:border-d-line bg-white/40 dark:bg-d-card/40 ${className}`}
    >
      <div className="h-12 w-12 rounded-full bg-accent-soft dark:bg-accent/10 text-accent flex items-center justify-center mb-4">
        <Icon size={22} />
      </div>
      <h3 className="text-base font-semibold text-ink-800 dark:text-d-text mb-1" style={{ fontFamily: 'Inter' }}>
        {title}
      </h3>
      <p className="text-sm text-ink-500 dark:text-d-muted max-w-md">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
