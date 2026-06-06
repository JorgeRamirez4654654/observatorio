import { LogOut, X } from 'lucide-react'
import FilterPanel from '../Filters/FilterPanel.jsx'
import Logo from '/favicon.ico'

export default function Sidebar({
  filters,
  onApply,
  onLogout,
  open,
  onClose,
  username,
  view,
}) {
  return (
    <>
      {/* Mobile overlay */}
      {open ? (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed lg:sticky lg:top-0 lg:h-screen z-50 top-0 left-0 h-full w-[280px] shrink-0 flex flex-col bg-sidebar dark:bg-d-sidebar text-white shadow-xl transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand */}
        <div className="px-5 pt-5 pb-4 border-b border-white/10 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 shrink-0">
              {/* <ShieldCheck size={18} /> */}
              <img src={Logo} alt="Logo" className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1
                className="text-[15px] font-bold leading-snug text-white"
                style={{ fontFamily: 'Libre Baskerville' }}
              >
                Observatorio
              </h1>
              <p className="text-[11px] text-white/60 leading-tight">
                Ejecución Presupuestaria
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden p-1 text-white/70 hover:text-white"
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filters (only relevant in dashboard) */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {view === 'dashboard' ? (
            <FilterPanel value={filters} onApply={onApply} variant="dark" />
          ) : (
            <p className="text-xs text-white/40 text-center mt-4">
              Los filtros aplican al dashboard
            </p>
          )}
        </div>

        {/* User + Logout */}
        <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white text-xs font-semibold uppercase shrink-0">
              {username ? username[0] : 'U'}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-white truncate">
                {username || 'Usuario'}
              </div>
              <div className="text-[10px] text-white/50">Sesión activa</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white/80 hover:text-white hover:bg-white/10"
          >
            <LogOut size={13} />
            Salir
          </button>
        </div>
      </aside>
    </>
  )
}
