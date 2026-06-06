import { ExternalLink as Icon } from 'lucide-react'

export default function ExternalLink({ href, children, className = '' }) {
  if (!href) {
    return <span className="text-ink-500 dark:text-d-muted">{children || '—'}</span>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-accent hover:underline ${className}`}
    >
      <span className="truncate">{children}</span>
      <Icon size={12} className="shrink-0 opacity-70" />
    </a>
  )
}
