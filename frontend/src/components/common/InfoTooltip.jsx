import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

export default function InfoTooltip({ text, label = 'Más información', position = 'top', className = '' }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, transform: '' })
  const btnRef = useRef(null)
  const tooltipRef = useRef(null)

  const calcCoords = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const gap = 8
    const positions = {
      top:    { top: r.top - gap,        left: cx,               transform: 'translate(-50%, -100%)' },
      bottom: { top: r.bottom + gap,     left: cx,               transform: 'translate(-50%, 0)' },
      left:   { top: cy,                 left: r.left - gap,     transform: 'translate(-100%, -50%)' },
      right:  { top: cy,                 left: r.right + gap,    transform: 'translate(0, -50%)' },
    }
    setCoords(positions[position] || positions.top)
  }

  const show = () => { calcCoords(); setOpen(true) }
  const hide = () => setOpen(false)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      const outside =
        btnRef.current && !btnRef.current.contains(e.target) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target)
      if (outside) hide()
    }
    const onKey = (e) => { if (e.key === 'Escape') hide() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.stopPropagation(); open ? hide() : show() }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-400 hover:text-accent dark:text-d-muted dark:hover:text-accent transition-colors cursor-help"
      >
        <Info size={14} aria-hidden="true" />
      </button>

      {open && text && createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          style={{ position: 'fixed', top: coords.top, left: coords.left, transform: coords.transform, zIndex: 9999 }}
          className="w-64 px-3 py-2 text-xs leading-snug font-normal whitespace-pre-line text-white bg-ink-900 dark:bg-slate-800 border border-ink-700 dark:border-slate-600 rounded-lg shadow-xl"
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  )
}
