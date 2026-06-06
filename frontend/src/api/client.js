import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 120000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('obs_token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Token invalid/expired
      localStorage.removeItem('obs_token')
      localStorage.removeItem('obs_username')
      // Soft reload to send back to login
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('storage'))
      }
    }
    return Promise.reject(error)
  }
)

// -------------- AUTH --------------
export async function login(username, password) {
  const { data } = await api.post('/api/auth/login', { username, password })
  return data
}

// -------------- FILTERS --------------
export async function getFilters() {
  const { data } = await api.get('/api/filters')
  return data
}

export async function getMunicipios(departamentos = []) {
  const q = departamentos && departamentos.length ? `?departamentos=${encodeURIComponent(departamentos.join(','))}` : ''
  const { data } = await api.get(`/api/filters/municipios${q}`)
  return data
}

// -------------- KPIs --------------
export async function getKpis(filters) {
  const { data } = await api.post('/api/kpis', filters)
  return data
}

// -------------- PIPELINE --------------
export async function getLastUpdated() {
  const { data } = await api.get('/api/pipeline/last-updated')
  return data
}

export async function runPipeline() {
  const { data } = await api.post('/api/pipeline/run')
  return data
}

export async function getPipelineStatus() {
  const { data } = await api.get('/api/pipeline/status')
  return data
}

export async function getPipelineProgress() {
  const { data } = await api.get('/api/pipeline/progress')
  return data
}

// -------------- TAB 1 --------------
export async function getMunicipiosProveedores(filters) {
  const { data } = await api.post('/api/analysis/municipios-proveedores', filters)
  return data
}
export async function getMunicipioDetalle(municipio, filters) {
  const { data } = await api.post('/api/analysis/municipios-proveedores/detalle', { municipio, filters })
  return data
}
export async function getMunicipiosProveedorDetalle(proveedor, filters) {
  const { data } = await api.post('/api/analysis/municipios-proveedores/proveedor-detalle', { proveedor, filters })
  return data
}

// -------------- TAB 2 --------------
export async function getAlcaldesProveedores(filters, { periodoFrom = null, periodoTo = null } = {}) {
  const { data } = await api.post('/api/analysis/alcaldes-proveedores', {
    ...filters,
    periodo_from: periodoFrom,
    periodo_to: periodoTo,
  })
  return data
}
export async function getAlcaldeDetalle(alcalde, filters) {
  const { data } = await api.post('/api/analysis/alcaldes-proveedores/detalle', { alcalde, filters })
  return data
}
export async function getAlcaldesMunicipioDetalle(municipio, filters, { periodoFrom = null, periodoTo = null } = {}) {
  const { data } = await api.post('/api/analysis/alcaldes-proveedores/municipio-detalle', {
    ...filters,
    municipio,
    periodo_from: periodoFrom,
    periodo_to: periodoTo,
  })
  return data
}

export async function getCodedes(filters, { periodoFrom = null, periodoTo = null } = {}) {
  const { data } = await api.post('/api/analysis/codedes', {
    ...filters,
    periodo_from: periodoFrom,
    periodo_to: periodoTo,
  })
  return data
}

export async function getCodedesMunicipioDetalle(municipio, filters, { periodoFrom = null, periodoTo = null } = {}) {
  const { data } = await api.post('/api/analysis/codedes/municipio-detalle', {
    ...filters,
    municipio,
    periodo_from: periodoFrom,
    periodo_to: periodoTo,
  })
  return data
}

// -------------- TAB 3 --------------
export async function getProyectosSospechosos(filters, { ejecucionMin = 0.95, metaMax = 0.50 } = {}) {
  const { data } = await api.post('/api/analysis/proyectos-sospechosos', {
    ...filters,
    ejecucion_min: ejecucionMin,
    meta_max: metaMax,
  })
  return data
}

// -------------- TAB 4 --------------
export async function getPartidos(filters) {
  const { data } = await api.post('/api/analysis/partidos', filters)
  return data
}
export async function getPartidoDetalle(partido, filters) {
  const { data } = await api.post('/api/analysis/partidos/detalle', { partido, filters })
  return data
}

// -------------- TAB 5 --------------
export async function getProveedores(filters) {
  const { data } = await api.post('/api/analysis/proveedores', filters)
  return data
}
export async function getProveedorDetalle(proveedor, filters) {
  const { data } = await api.post('/api/analysis/proveedores/detalle', { proveedor, filters })
  return data
}

// -------------- TAB 6 --------------
export async function getCostoUnidad(filters, unidad = '') {
  const body = { ...filters, unidad }
  const { data } = await api.post('/api/analysis/costo-unidad', body)
  return data
}

// -------------- MAPA DE GASTO --------------
export async function getMapaGasto(filters) {
  const { data } = await api.post('/api/analysis/mapa-gasto', filters)
  return data
}

// -------------- TAB 7 --------------
export async function getCompetencia(filters) {
  const { data } = await api.post('/api/analysis/competencia', filters)
  return data
}

// -------------- TAB 8 – Búsqueda por indicador de riesgo --------------
export async function getBusqueda({ filters, variable, tipo }) {
  const { data } = await api.post('/api/analysis/busqueda', { filters, variable, tipo })
  return data
}

// -------------- USER MANAGEMENT --------------
export async function getMe() {
  const { data } = await api.get('/api/auth/me')
  return data
}
export async function listUsers() {
  const { data } = await api.get('/api/users')
  return data
}
export async function createUser(username, password, role) {
  const { data } = await api.post('/api/users', { username, password, role })
  return data
}
export async function updateUser(username, { password, role }) {
  const { data } = await api.put(`/api/users/${encodeURIComponent(username)}`, { password, role })
  return data
}
export async function deleteUser(username) {
  await api.delete(`/api/users/${encodeURIComponent(username)}`)
}

export default api
