export default function LoadingSpinner({ label = 'Cargando…', size = 'md', className = '' }) {
  const sizeMap = {
    sm: 'h-4 w-4 border-2',
    md: 'h-7 w-7 border-2',
    lg: 'h-10 w-10 border-[3px]',
  }
  const dim = sizeMap[size] || sizeMap.md

  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-10 ${className}`}>
      <span
        className={`inline-block ${dim} rounded-full border-accent border-t-transparent animate-spin`}
        role="status"
        aria-label={label}
      />
      {label ? (
        <span className="text-sm text-ink-500 dark:text-d-muted">{label}</span>
      ) : null}
    </div>
  )
}
