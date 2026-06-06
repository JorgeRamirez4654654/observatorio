import { useEffect, useState } from 'react'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'
import KpiSection from '../Dashboard/KpiSection.jsx'
import TabNav from '../Dashboard/TabNav.jsx'
import ErrorBoundary from '../common/ErrorBoundary.jsx'

import TabMapaGasto from '../tabs/TabMapaGasto.jsx'
import TabMunicipiosProveedores from '../tabs/TabMunicipiosProveedores.jsx'
import TabAlcaldesProveedores from '../tabs/TabAlcaldesProveedores.jsx'
import TabProyectosSospechosos from '../tabs/TabProyectosSospechosos.jsx'
import TabPartidos from '../tabs/TabPartidos.jsx'
import TabProveedores from '../tabs/TabProveedores.jsx'
import TabCodedes from '../tabs/TabCodedes.jsx'
import TabCostoUnidad from '../tabs/TabCostoUnidad.jsx'
import TabCompetencia from '../tabs/TabCompetencia.jsx'
import TabBusqueda from '../tabs/TabBusqueda.jsx'
import UserManagement from '../Users/UserManagement.jsx'

const DEFAULT_FILTERS = {
  departamentos: [],
  municipios: [],
  codedes: [],
  sectores: [],
  instituciones: [],
  year_min: null,
  year_max: null,
  etapas: [],
}

const TABS = [
  { id: 'mapaGasto', label: 'Mapa de Gasto' },
  { id: 'municipios', label: 'Municipios y Proveedores' },
  { id: 'alcaldes', label: 'Alcaldes y Proveedores' },
  { id: 'codedes', label: 'Codedes' },
  { id: 'sospechosos', label: 'Proyectos Sospechosos' },
  { id: 'partidos', label: 'Partidos' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'costo', label: 'Costo por Unidad' },
  { id: 'competencia', label: 'Competencia' },
  { id: 'busqueda', label: 'Búsqueda' },
]

export default function Layout({ username, role, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS)
  const [activeTab, setActiveTab] = useState(TABS[0].id)
  const [view, setView] = useState('dashboard') // 'dashboard' | 'users'

  // Close sidebar on viewport resize >= lg
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleApply = (next) => {
    setFilters(next)
    setAppliedFilters(next)
    setSidebarOpen(false)
  }

  const handleNavUsers = () => {
    setView('users')
    setSidebarOpen(false)
  }

  const handleNavDashboard = () => {
    setView('dashboard')
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'mapaGasto':
        return <TabMapaGasto filters={appliedFilters} />
      case 'municipios':
        return <TabMunicipiosProveedores filters={appliedFilters} />
      case 'alcaldes':
        return <TabAlcaldesProveedores filters={appliedFilters} />
      case 'sospechosos':
        return <TabProyectosSospechosos filters={appliedFilters} />
      case 'codedes':
        return <TabCodedes filters={appliedFilters} />
      case 'partidos':
        return <TabPartidos filters={appliedFilters} />
      case 'proveedores':
        return <TabProveedores filters={appliedFilters} />
      case 'costo':
        return <TabCostoUnidad filters={appliedFilters} />
      case 'competencia':
        return <TabCompetencia filters={appliedFilters} />
      case 'busqueda':
        return <TabBusqueda filters={appliedFilters} />
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen flex bg-canvas dark:bg-d-canvas">
      <Sidebar
        filters={filters}
        onApply={handleApply}
        onLogout={onLogout}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        username={username}
        view={view}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Sticky top bar: header + tab navigation (only in dashboard view) */}
        <div className="sticky top-0 z-30 bg-white/95 dark:bg-d-card/95 backdrop-blur shadow-sm">
          <Header
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
            username={username}
            role={role}
            view={view}
            onNavUsers={handleNavUsers}
            onNavDashboard={handleNavDashboard}
          />
          {view === 'dashboard' && (
            <div className="px-4 md:px-6">
              <TabNav tabs={TABS} activeId={activeTab} onChange={setActiveTab} />
            </div>
          )}
        </div>

        <main className="flex-1 px-4 md:px-6 py-6 space-y-6">
          {view === 'users' ? (
            <ErrorBoundary>
              <UserManagement currentUsername={username} />
            </ErrorBoundary>
          ) : (
            <>
              {/* KPIs — hidden on search tab to avoid noise */}
              {activeTab !== 'busqueda' && (
                <ErrorBoundary>
                  <KpiSection filters={appliedFilters} />
                </ErrorBoundary>
              )}

              {/* Tab content */}
              <ErrorBoundary key={activeTab}>{renderTab()}</ErrorBoundary>
            </>
          )}

          <footer className="pt-4 pb-2 text-center text-[11px] text-ink-400 dark:text-d-muted">
            Observatorio de Ejecución Presupuestaria · CACIF · Improgress
          </footer>
        </main>
      </div>
    </div>
  )
}
