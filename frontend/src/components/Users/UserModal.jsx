import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'

const ROLES = [
  { value: 'admin', label: 'Administrador', description: 'Acceso total, puede gestionar usuarios' },
  { value: 'viewer', label: 'Analista', description: 'Solo lectura del dashboard' },
]

export default function UserModal({ mode, user, onClose, onSave, loading, error }) {
  const [username, setUsername] = useState(user?.username || '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(user?.role || 'viewer')
  const [showPwd, setShowPwd] = useState(false)
  const firstRef = useRef(null)

  const isEdit = mode === 'edit'

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({ username: username.trim(), password, role })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white dark:bg-d-card rounded-xl2 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line dark:border-d-line">
          <h2 className="text-base font-bold text-ink-900 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
            {isEdit ? 'Editar usuario' : 'Nuevo usuario'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-ink-500 dark:text-d-muted hover:bg-canvas dark:hover:bg-d-canvas"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-ink-600 dark:text-d-muted mb-1">
              Nombre de usuario
            </label>
            <input
              ref={firstRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isEdit}
              required
              autoComplete="off"
              placeholder="ej. jperez"
              className="w-full px-3 py-2 rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-canvas text-ink-900 dark:text-d-text text-sm placeholder:text-ink-400 dark:placeholder:text-d-muted disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            {isEdit && (
              <p className="mt-1 text-[11px] text-ink-400 dark:text-d-muted">
                El nombre de usuario no se puede cambiar
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-ink-600 dark:text-d-muted mb-1">
              {isEdit ? 'Nueva contraseña' : 'Contraseña'}
              {isEdit && <span className="ml-1 font-normal text-ink-400">(dejar vacío para mantener)</span>}
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!isEdit}
                autoComplete="new-password"
                placeholder={isEdit ? '••••••••' : 'Contraseña segura'}
                className="w-full px-3 py-2 pr-10 rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-canvas text-ink-900 dark:text-d-text text-sm placeholder:text-ink-400 dark:placeholder:text-d-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                tabIndex={-1}
                aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-ink-600 dark:text-d-muted mb-2">
              Rol
            </label>
            <div className="space-y-2">
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    role === r.value
                      ? 'border-accent bg-accent-soft dark:bg-accent/10 dark:border-accent/40'
                      : 'border-line dark:border-d-line hover:bg-canvas dark:hover:bg-d-canvas'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={role === r.value}
                    onChange={() => setRole(r.value)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <div className="text-sm font-medium text-ink-800 dark:text-d-text">{r.label}</div>
                    <div className="text-[11px] text-ink-500 dark:text-d-muted">{r.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-ink-700 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas border border-line dark:border-d-line"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent hover:bg-accent-hover disabled:opacity-60 text-white transition-colors"
            >
              {loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
