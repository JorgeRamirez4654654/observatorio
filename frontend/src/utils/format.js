// Formatters used across the app.

export function formatMoney(value, opts = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const { compact = false, prefix = 'Q ' } = opts
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  if (compact && Math.abs(num) >= 1_000_000) {
    return `${prefix}${(num / 1_000_000).toLocaleString('es-GT', { maximumFractionDigits: 1 })}M`
  }
  if (compact && Math.abs(num) >= 1_000) {
    return `${prefix}${(num / 1_000).toLocaleString('es-GT', { maximumFractionDigits: 1 })}K`
  }
  return `${prefix}${num.toLocaleString('es-GT', { maximumFractionDigits: 0 })}`
}

export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString('es-GT', { maximumFractionDigits: digits })
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${(num * 100).toLocaleString('es-GT', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('es-GT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

/**
 * Extract a display name from a firmaconcerteza-style link.
 * If the URL contains `query=`, decode and return that; otherwise return fallback.
 */
export function nameFromLink(link, fallback = '') {
  if (!link || typeof link !== 'string') return fallback
  try {
    const url = new URL(link)
    const q = url.searchParams.get('query')
    if (q) return decodeURIComponent(q)
  } catch {
    /* ignore */
  }
  return fallback
}
