import { useEffect, useState } from 'react'

/**
 * Dual-handle range slider with two overlapping range inputs.
 * Props: min, max, value=[from,to], onChange([from,to])
 */
export default function YearRange({ min, max, value, onChange, label = 'Rango de años', variant = 'dark' }) {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) ? max : 0
  const [from, setFrom] = useState(value?.[0] ?? safeMin)
  const [to, setTo] = useState(value?.[1] ?? safeMax)

  useEffect(() => {
    setFrom(value?.[0] ?? safeMin)
    setTo(value?.[1] ?? safeMax)
  }, [value, safeMin, safeMax])

  const dark = variant === 'dark'
  const range = Math.max(1, safeMax - safeMin)
  const leftPct = ((from - safeMin) / range) * 100
  const rightPct = ((to - safeMin) / range) * 100

  const commit = (newFrom, newTo) => {
    if (newFrom > newTo) {
      const t = newFrom
      newFrom = newTo
      newTo = t
    }
    onChange?.([newFrom, newTo])
  }

  if (safeMax <= safeMin) {
    return (
      <div>
        {label ? (
          <label className={`block text-[11px] font-medium uppercase tracking-wide mb-1.5 ${dark ? 'text-white/60' : 'text-ink-500 dark:text-d-muted'}`}>
            {label}
          </label>
        ) : null}
        <div className={`text-sm ${dark ? 'text-white/60' : 'text-ink-500 dark:text-d-muted'}`}>—</div>
      </div>
    )
  }

  return (
    <div>
      {label ? (
        <label className={`block text-[11px] font-medium uppercase tracking-wide mb-1.5 ${dark ? 'text-white/60' : 'text-ink-500 dark:text-d-muted'}`}>
          {label}
        </label>
      ) : null}
      <div className="flex items-center justify-between text-xs mb-2 num">
        <span className={dark ? 'text-white' : 'text-ink-800 dark:text-d-text'}>{from}</span>
        <span className={dark ? 'text-white/50' : 'text-ink-400 dark:text-d-muted'}>—</span>
        <span className={dark ? 'text-white' : 'text-ink-800 dark:text-d-text'}>{to}</span>
      </div>

      <div className="relative h-6">
        {/* Track */}
        <div className={`absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded-full ${dark ? 'bg-white/10' : 'bg-line dark:bg-d-line'}`} />
        {/* Active range */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-accent"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        <input
          type="range"
          min={safeMin}
          max={safeMax}
          value={from}
          onChange={(e) => setFrom(Number(e.target.value))}
          onMouseUp={(e) => commit(Number(e.target.value), to)}
          onTouchEnd={(e) => commit(Number(e.target.value), to)}
          onKeyUp={(e) => commit(Number(e.target.value), to)}
          className="absolute inset-0 w-full"
          aria-label="Año inicial"
        />
        <input
          type="range"
          min={safeMin}
          max={safeMax}
          value={to}
          onChange={(e) => setTo(Number(e.target.value))}
          onMouseUp={(e) => commit(from, Number(e.target.value))}
          onTouchEnd={(e) => commit(from, Number(e.target.value))}
          onKeyUp={(e) => commit(from, Number(e.target.value))}
          className="absolute inset-0 w-full"
          aria-label="Año final"
        />
      </div>

      <div className="flex items-center justify-between mt-1 text-[10px] num">
        <span className={dark ? 'text-white/40' : 'text-ink-400 dark:text-d-muted'}>{safeMin}</span>
        <span className={dark ? 'text-white/40' : 'text-ink-400 dark:text-d-muted'}>{safeMax}</span>
      </div>
    </div>
  )
}
