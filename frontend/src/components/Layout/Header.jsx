import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Menu,
  Moon,
  RefreshCcw,
  Sun,
  User,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import { getLastUpdated, getPipelineProgress, getPipelineStatus, runPipeline } from '../../api/client.js'
import { formatDateTime } from '../../utils/format.js'

// ─── Step status icons ────────────────────────────────────────────────────────

function StepIcon({ status }) {
  if (status === 'done')    return <CheckCircle2 size={16} className="text-green-500 shrink-0" />
  if (status === 'failed')  return <XCircle      size={16} className="text-red-500 shrink-0" />
  if (status === 'running') return <Loader2      size={16} className="text-accent shrink-0 animate-spin" />
  return <Circle size={16} className="text-ink-300 dark:text-d-muted shrink-0" />
}

function fmtElapsed(s) {
  if (s == null) return ''
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

// ─── Progress modal ───────────────────────────────────────────────────────────

function ProgressModal({ progress, onClose }) {
  const steps   = progress?.steps || []
  const current = progress?.current_step ?? 0
  const total   = progress?.total_steps ?? 4
  const pct     = total > 0 ? Math.round((current / total) * 100) : 0
  const finished = progress?.finished

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-d-card rounded-xl2 shadow-2xl border border-line dark:border-d-line overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line dark:border-d-line">
          <div>
            <h3 className="text-base font-semibold text-ink-800 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
              Estado de actualización
            </h3>
            <p className="text-xs text-ink-500 dark:text-d-muted mt-0.5">
              {finished
                ? (steps.every((s) => s.status === 'done') ? 'Proceso completado' : 'Proceso terminado con errores')
                : progress?.running
                  ? `Paso ${current} de ${total} en progreso…`
                  : 'Iniciando…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 dark:text-d-muted dark:hover:text-d-text hover:bg-canvas dark:hover:bg-d-canvas transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center justify-between text-xs text-ink-500 dark:text-d-muted mb-1.5">
            <span>Progreso general</span>
            <span className="font-semibold tabular-nums text-accent">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-canvas dark:bg-d-canvas overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <ul className="px-5 py-3 space-y-3">
          {steps.length === 0
            ? Array.from({ length: total }).map((_, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Circle size={16} className="text-ink-300 dark:text-d-muted shrink-0" />
                  <span className="text-sm text-ink-400 dark:text-d-muted">Paso {i + 1}</span>
                </li>
              ))
            : steps.map((step, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <StepIcon status={step.status} />
                    <span className={`text-sm truncate ${
                      step.status === 'running'
                        ? 'font-medium text-accent'
                        : step.status === 'done'
                          ? 'text-ink-700 dark:text-d-text'
                          : step.status === 'failed'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-ink-400 dark:text-d-muted'
                    }`}>
                      {step.name}
                    </span>
                  </div>
                  {step.elapsed != null && (
                    <span className="text-xs tabular-nums text-ink-400 dark:text-d-muted shrink-0 flex items-center gap-1">
                      <Clock size={11} />
                      {fmtElapsed(step.elapsed)}
                    </span>
                  )}
                  {step.status === 'running' && (
                    <span className="text-xs text-accent shrink-0 animate-pulse">en curso…</span>
                  )}
                </li>
              ))}
        </ul>

        <p className="px-5 pb-4 text-[11px] text-ink-400 dark:text-d-muted">
          La ventana se actualiza automáticamente cada 3 segundos mientras el proceso está activo.
        </p>
      </div>
    </div>,
    document.body
  )
}

// ─── Confirm modal (warning before start) ────────────────────────────────────

function ConfirmModal({ onConfirm, onCancel }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-d-card rounded-xl2 shadow-2xl border border-line dark:border-d-line overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-4">
          <div className="flex gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertTriangle size={20} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-ink-800 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
                Actualizar datos
              </h3>
              <p className="text-xs text-ink-500 dark:text-d-muted mt-0.5">
                Este proceso puede tardar más de 10 minutos
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
            <p>El pipeline ejecuta 4 pasos secuenciales:</p>
            <ol className="list-decimal list-inside space-y-0.5 pl-1">
              <li>Descarga GuateCompras — el más largo (descarga meses desde 2020)</li>
              <li>Enlace NOG → SNIP</li>
              <li>Scraping SNIP</li>
              <li>Preprocesamiento</li>
            </ol>
            <p className="pt-1">
              Puedes cerrar esta ventana — el proceso continúa en segundo plano y los datos se actualizan automáticamente todos los días a las 3 AM.
            </p>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg border border-line dark:border-d-line text-ink-700 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
            >
              Sí, actualizar ahora
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

export default function Header({ onToggleSidebar, username, role, view, onNavDashboard, onNavUsers }) {
  const { theme, toggleTheme } = useTheme()
  const [lastUpdated, setLastUpdated]   = useState(null)
  const [running, setRunning]           = useState(false)
  const [message, setMessage]           = useState(null)
  const [progress, setProgress]         = useState(null)
  const [showConfirm, setShowConfirm]   = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const pollTimer = useRef(null)

  // Initial load
  useEffect(() => {
    let active = true
    getLastUpdated()
      .then((d) => active && setLastUpdated(d.last_updated))
      .catch(() => {})
    getPipelineStatus()
      .then((d) => {
        if (!active) return
        setRunning(Boolean(d.running))
        if (d.last_updated) setLastUpdated(d.last_updated)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (pollTimer.current) return
    pollTimer.current = setInterval(async () => {
      try {
        const d = await getPipelineProgress()
        setRunning(Boolean(d.running))
        setProgress(d)
        if (!d.running) {
          stopPolling()
          const allOk = d.steps?.every((s) => s.status !== 'failed')
          setMessage(allOk ? 'Actualización completada' : 'Actualización terminó con errores')
          setTimeout(() => setMessage(null), 6000)
          // Refresh last_updated timestamp
          getLastUpdated().then((u) => setLastUpdated(u.last_updated)).catch(() => {})
        }
      } catch { /* keep polling */ }
    }, 3000)
  }, [stopPolling])

  useEffect(() => {
    if (running && !pollTimer.current) startPolling()
    return stopPolling
  }, [running, startPolling, stopPolling])

  const doStart = async () => {
    setShowConfirm(false)
    setMessage(null)
    try {
      const res = await runPipeline()
      if (res.status === 'already_running') {
        setRunning(true)
        startPolling()
        setShowProgress(true)
        return
      }
      setRunning(true)
      setMessage('Actualización iniciada')
      startPolling()
    } catch (err) {
      setMessage(err?.response?.data?.detail || 'Error al iniciar actualización')
    }
  }

  const handleButtonClick = () => {
    if (running) {
      setShowProgress(true)
    } else {
      setShowConfirm(true)
    }
  }

  // Derive button label from current running step
  const runningStep = running && progress?.steps?.find((s) => s.status === 'running')
  const stepLabel = runningStep
    ? `${progress.current_step}/${progress.total_steps} · ${runningStep.name}`
    : running
      ? 'Actualizando…'
      : 'Actualizar datos'

  return (
    <>
      <header className="border-b border-line dark:border-d-line">
        <div className="px-4 md:px-6 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg border border-line dark:border-d-line text-ink-800 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas"
            aria-label="Abrir menú"
          >
            <Menu size={18} />
          </button>

          <div className="flex-1 min-w-0">
            <h2
              className="text-base md:text-lg font-bold leading-tight text-ink-900 dark:text-d-text truncate"
              style={{ fontFamily: 'Libre Baskerville' }}
            >
              Panel de Transparencia
            </h2>
            <p className="text-[11px] md:text-xs text-ink-500 dark:text-d-muted mt-0.5 flex items-center gap-2">
              <span className="hidden sm:inline">Última actualización:</span>
              <span className="num">{formatDateTime(lastUpdated)}</span>
              {message ? (
                <span className={`ml-2 flex items-center gap-1 ${message.includes('error') || message.includes('Error') ? 'text-red-500' : 'text-accent'}`}>
                  {message.includes('completada') && <CheckCircle2 size={11} />}
                  {message}
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Desktop button */}
            <button
              type="button"
              onClick={handleButtonClick}
              className={`hidden md:inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-medium transition-colors ${
                running
                  ? 'bg-accent/80 hover:bg-accent cursor-pointer'
                  : 'bg-accent hover:bg-accent-hover'
              }`}
              title={running ? 'Ver estado de actualización' : 'Ejecutar pipeline de actualización'}
            >
              <RefreshCcw size={14} className={running ? 'animate-spin' : ''} />
              <span className="max-w-[180px] truncate">{stepLabel}</span>
            </button>

            {/* Mobile icon button */}
            <button
              type="button"
              onClick={handleButtonClick}
              className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg bg-accent text-white"
              aria-label={running ? 'Ver estado de actualización' : 'Actualizar datos'}
            >
              <RefreshCcw size={15} className={running ? 'animate-spin' : ''} />
            </button>

            <div className="hidden md:flex items-center gap-1">
              <button
                type="button"
                onClick={onNavDashboard}
                className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  view === 'dashboard'
                    ? 'bg-accent text-white border-accent'
                    : 'border-line dark:border-d-line text-ink-700 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'
                }`}
              >
                <BarChart2 size={13} />
                Dashboard
              </button>
              {role === 'admin' && (
                <button
                  type="button"
                  onClick={onNavUsers}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    view === 'users'
                      ? 'bg-accent text-white border-accent'
                      : 'border-line dark:border-d-line text-ink-700 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'
                  }`}
                >
                  <Users size={13} />
                  Usuarios
                </button>
              )}
            </div>
            <div className="md:hidden flex items-center gap-1">
              <button
                type="button"
                onClick={onNavDashboard}
                className={`inline-flex items-center justify-center h-9 w-9 rounded-lg border transition-colors ${
                  view === 'dashboard'
                    ? 'bg-accent text-white border-accent'
                    : 'border-line dark:border-d-line text-ink-700 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'
                }`}
                aria-label="Ir a Dashboard"
              >
                <BarChart2 size={15} />
              </button>
              {role === 'admin' && (
                <button
                  type="button"
                  onClick={onNavUsers}
                  className={`inline-flex items-center justify-center h-9 w-9 rounded-lg border transition-colors ${
                    view === 'users'
                      ? 'bg-accent text-white border-accent'
                      : 'border-line dark:border-d-line text-ink-700 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'
                  }`}
                  aria-label="Ir a Usuarios"
                >
                  <Users size={15} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-line dark:border-d-line text-ink-800 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas"
              aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>

            <div className="hidden sm:flex items-center gap-2 pl-3 ml-1 border-l border-line dark:border-d-line">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft dark:bg-accent/15 text-accent">
                <User size={14} />
              </span>
              <span className="text-xs text-ink-800 dark:text-d-text font-medium max-w-[120px] truncate">
                {username || 'Usuario'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {showConfirm && (
        <ConfirmModal onConfirm={doStart} onCancel={() => setShowConfirm(false)} />
      )}
      {showProgress && (
        <ProgressModal progress={progress} onClose={() => setShowProgress(false)} />
      )}
    </>
  )
}
