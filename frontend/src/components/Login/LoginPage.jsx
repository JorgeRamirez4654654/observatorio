import { useState } from 'react'
import { Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react'
import { login as apiLogin } from '../../api/client.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import Logo from '/favicon.ico'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const { theme, toggleTheme } = useTheme()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError('Ingresa tu usuario y contraseña.')
      return
    }
    setLoading(true)
    try {
      const data = await apiLogin(username.trim(), password)
      onLogin?.({ token: data.token, username: data.username || username.trim(), role: data.role || 'viewer' })
    } catch (err) {
      const msg =
        err?.response?.status === 401
          ? 'Credenciales inválidas. Verifica e inténtalo nuevamente.'
          : err?.message || 'No se pudo iniciar sesión.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas dark:bg-d-canvas">
      {/* Decorative top accent strip */}
      <div className="h-1.5 bg-gradient-to-r from-accent via-blue-500 to-sky-400" />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          {/* Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl2 bg-sidebar text-white shadow-card mb-4">
              {/* <ShieldCheck size={22} /> */}
              <img src={Logo} alt="Logo" className="h-6 w-6" />
            </div>
            <h1
              className="text-2xl md:text-[1.7rem] font-bold text-ink-900 dark:text-d-text leading-tight"
              style={{ fontFamily: 'Libre Baskerville' }}
            >
              Observatorio de Ejecución Presupuestaria
            </h1>
            <p className="mt-2 text-sm text-ink-500 dark:text-d-muted">
              Transparencia y vigilancia en la inversión pública
            </p>
          </div>

          {/* Card */}
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-d-card border border-line dark:border-d-line rounded-xl2 shadow-card p-6 md:p-7"
          >
            <h2
              className="text-lg font-semibold text-ink-800 dark:text-d-text mb-1"
              style={{ fontFamily: 'Libre Baskerville' }}
            >
              Iniciar sesión
            </h2>
            <p className="text-xs text-ink-500 dark:text-d-muted mb-5">
              Acceso autorizado al panel de análisis.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-d-muted mb-1.5">
                  Usuario
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-d-muted" />
                  <input
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-canvas dark:bg-d-canvas border border-line dark:border-d-line text-ink-800 dark:text-d-text placeholder:text-ink-400 focus:border-accent focus:outline-none"
                    placeholder="usuario"
                    disabled={loading}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-d-muted mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-d-muted" />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 text-sm rounded-lg bg-canvas dark:bg-d-canvas border border-line dark:border-d-line text-ink-800 dark:text-d-text placeholder:text-ink-400 focus:border-accent focus:outline-none"
                    placeholder="••••••••"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-ink-400 hover:text-ink-800 dark:text-d-muted dark:hover:text-d-text"
                    aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 rounded-lg px-3 py-2">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {loading ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Ingresando…
                  </>
                ) : (
                  'Ingresar'
                )}
              </button>
            </div>
          </form>

          {/* Org strip */}
          <div className="mt-6 flex items-center justify-center gap-3 text-xs text-ink-500 dark:text-d-muted">
            <span className="font-semibold tracking-wide">CACIF</span>
            <span className="text-line dark:text-d-line">•</span>
            <span>Guatemala</span>
            <span className="text-line dark:text-d-line">•</span>
            <span className="font-semibold tracking-wide">Improgress</span>
          </div>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={toggleTheme}
              className="text-xs text-ink-500 dark:text-d-muted hover:text-accent transition-colors"
            >
              Cambiar a modo {theme === 'light' ? 'oscuro' : 'claro'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
