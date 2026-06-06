import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import L from 'leaflet'
import { GeoJSON, MapContainer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getMapaGasto, getMunicipioDetalle } from '../../api/client.js'
import { formatMoney, formatNumber } from '../../utils/format.js'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'

// ─── Color helpers ─────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = Number.parseInt(full, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function interpolateColor(fromHex, toHex, ratio) {
  const clamped = Math.min(1, Math.max(0, ratio))
  const from = hexToRgb(fromHex)
  const to = hexToRgb(toHex)
  return `rgb(${Math.round(from.r + (to.r - from.r) * clamped)}, ${Math.round(from.g + (to.g - from.g) * clamped)}, ${Math.round(from.b + (to.b - from.b) * clamped)})`
}

function normalizeMunicipio(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
}

// ─── Shared modal shell ────────────────────────────────────────────────────────
function Modal({ title, subtitle, onClose, wide = false, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`relative bg-white dark:bg-d-card rounded-xl2 shadow-2xl border border-line dark:border-d-line flex flex-col max-h-[90vh] w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line dark:border-d-line shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-800 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
              {title}
            </h2>
            {subtitle ? <p className="text-xs text-ink-500 dark:text-d-muted mt-0.5">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-lg hover:bg-canvas dark:hover:bg-d-canvas text-ink-400 hover:text-ink-700 dark:text-d-muted dark:hover:text-d-text transition-colors"
          >
            <X size={16} />
          </button>
        </header>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

// ─── Municipality detail modal ─────────────────────────────────────────────────
const DETAIL_COLS = [
  { key: 'snip', header: 'SNIP' },
  { key: 'proyecto', header: 'Proyecto' },
  { key: 'ejercicio', header: 'Año', align: 'right' },
  { key: 'proveedor', header: 'Proveedor' },
  { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
  { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
]

function MunicipioModal({ municipio, departamento, filters, onClose }) {
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    getMunicipioDetalle(municipio, filters)
      .then((res) => { setProjects(res.proyectos || []); setLoading(false) })
      .catch((err) => {
        if (err.response?.status === 404) {
          setProjects([])
        } else {
          setError('No se pudieron cargar los proyectos.')
        }
        setLoading(false)
      })
  }, [municipio, filters])

  return (
    <Modal title={municipio} subtitle={departamento} onClose={onClose} wide>
      <div className="p-4">
        {loading ? (
          <LoadingSpinner label="Cargando proyectos…" />
        ) : error ? (
          <EmptyState title="Error" message={error} />
        ) : projects.length === 0 ? (
          <EmptyState title="Sin proyectos" message="No hay proyectos para este municipio con los filtros actuales." />
        ) : (
          <DataTable
            columns={DETAIL_COLS}
            data={projects}
            defaultSort={{ key: 'monto_ejecutado', direction: 'desc' }}
            searchPlaceholder="Buscar SNIP, proyecto, proveedor…"
            pageSize={15}
          />
        )}
      </div>
    </Modal>
  )
}

// ─── Top municipalities table columns ─────────────────────────────────────────
const MUN_COLS = [
  { key: 'rank', header: '#', align: 'right' },
  { key: 'municipio', header: 'Municipio' },
  { key: 'departamento', header: 'Departamento' },
  { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
  { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
  { key: 'num_proyectos', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.num_proyectos) },
]

// ─── Spending choropleth map ───────────────────────────────────────────────────
const FROM_COLOR = '#BFDBFE'
const TO_COLOR = '#1D4ED8'

function GastoMap({ data, metric, geoJson, geoLoading, geoError, onMunicipioClick }) {
  const rows = useMemo(() => (data || []).filter((r) => r && r.municipio), [data])

  const byMunicipio = useMemo(() => {
    const map = new Map()
    for (const row of rows) map.set(normalizeMunicipio(row.municipio), row)
    return map
  }, [rows])

  const maxValue = useMemo(
    () => Math.max(0, ...rows.map((r) => Number(r[metric]) || 0).filter((v) => v > 0)),
    [rows, metric]
  )

  const mapBounds = useMemo(() => (geoJson ? L.geoJSON(geoJson).getBounds() : null), [geoJson])

  if (geoLoading) return <LoadingSpinner label="Cargando mapa…" />
  if (geoError || !geoJson || !mapBounds) {
    return <EmptyState title="Mapa no disponible" message={geoError || 'No se pudo cargar la geometría.'} />
  }
  if (rows.length === 0) {
    return <EmptyState title="Sin datos" message="No hay registros para los filtros seleccionados." />
  }

  const styleFeature = (feature) => {
    const key = normalizeMunicipio(feature?.properties?.municipio)
    const row = byMunicipio.get(key)
    const value = Number(row?.[metric]) || 0
    const ratio = maxValue > 0 ? value / maxValue : 0
    return {
      fillColor: value > 0 ? interpolateColor(FROM_COLOR, TO_COLOR, ratio) : '#E5E7EB',
      fillOpacity: value > 0 ? 0.88 : 0.3,
      color: '#1E3A5F',
      weight: 0.6,
      opacity: 0.8,
      className: 'cursor-pointer',
    }
  }

  const onEachFeature = (feature, layer) => {
    const props = feature?.properties || {}
    const key = normalizeMunicipio(props.municipio)
    const row = byMunicipio.get(key)
    const ejecutado = Number(row?.monto_ejecutado) || 0
    const adjudicado = Number(row?.monto_adjudicado) || 0
    const proyectos = row?.num_proyectos ?? '—'
    const tooltip = [
      `<strong>${props.municipio || 'Municipio'}</strong>`,
      props.departamento || '—',
      `Ejecutado: ${ejecutado > 0 ? formatMoney(ejecutado) : 'Sin datos'}`,
      `Adjudicado: ${adjudicado > 0 ? formatMoney(adjudicado) : 'Sin datos'}`,
      `Proyectos: ${typeof proyectos === 'number' ? formatNumber(proyectos) : '—'}`,
    ].join('<br/>')
    layer.bindTooltip(tooltip, { sticky: true, direction: 'auto', opacity: 0.97 })
    layer.on({
      mouseover: () => layer.setStyle({ weight: 1.8, color: '#0F172A', opacity: 1 }),
      mouseout: () => layer.setStyle({ weight: 0.6, color: '#1E3A5F', opacity: 0.8 }),
      click: () => {
        // Use the exact DB-side name so the detalle endpoint matches
        const dbName = byMunicipio.get(normalizeMunicipio(props.municipio))?.municipio ?? props.municipio
        onMunicipioClick?.({ municipio: dbName, departamento: props.departamento })
      },
    })
  }

  return (
    <div>
      <div className="rounded-lg border border-line dark:border-d-line overflow-hidden">
        <MapContainer
          bounds={mapBounds}
          boundsOptions={{ padding: [24, 24] }}
          maxBounds={mapBounds.pad(0.25)}
          maxBoundsViscosity={1}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          style={{ width: '100%', height: 560 }}
          className="bg-slate-100 dark:bg-slate-900"
          whenReady={(evt) => {
            setTimeout(() => {
              evt.target.invalidateSize()
              evt.target.fitBounds(mapBounds, { padding: [24, 24] })
            }, 0)
          }}
        >
          <GeoJSON
            key={`gasto-${metric}-${maxValue}-${rows.length}`}
            data={geoJson}
            style={styleFeature}
            onEachFeature={onEachFeature}
          />
        </MapContainer>
      </div>
      <div className="mt-3 px-1">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 rounded-full border border-slate-400/60 bg-slate-200 dark:bg-slate-700" />
          <div
            className="relative h-4 flex-1 rounded-full border border-slate-400/50 overflow-hidden"
            style={{ background: `linear-gradient(90deg, #E5E7EB 0%, ${FROM_COLOR} 20%, ${TO_COLOR} 100%)` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-500 dark:text-d-muted">
          <span>Sin datos / Q 0</span>
          <span>Gasto {metric === 'monto_ejecutado' ? 'ejecutado' : 'adjudicado'}</span>
          <span>{maxValue > 0 ? formatMoney(maxValue) : '—'}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main tab ──────────────────────────────────────────────────────────────────
export default function TabMapaGasto({ filters }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState([])
  const [totalEjecutado, setTotalEjecutado] = useState(0)
  const [totalAdjudicado, setTotalAdjudicado] = useState(0)
  const [geoJson, setGeoJson] = useState(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError] = useState(null)
  const [metric, setMetric] = useState('monto_ejecutado')
  const [selectedMunicipio, setSelectedMunicipio] = useState(null)

  useEffect(() => {
    fetch('/gua.json')
      .then((res) => {
        if (!res.ok) throw new Error(`No se pudo cargar gua.json (${res.status})`)
        return res.json()
      })
      .then((json) => { setGeoJson(json); setGeoLoading(false) })
      .catch((err) => { setGeoError(err.message); setGeoLoading(false) })
  }, [])

  useEffect(() => {
    setLoading(true)
    getMapaGasto(filters)
      .then((res) => {
        setData(res.data || [])
        setTotalEjecutado(res.total_ejecutado || 0)
        setTotalAdjudicado(res.total_adjudicado || 0)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [filters])

  const rankedMunicipios = useMemo(
    () => [...data].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).map((r, i) => ({ ...r, rank: i + 1 })),
    [data, metric]
  )

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line dark:border-d-line bg-white dark:bg-d-card p-4">
          <div className="text-xs text-ink-500 dark:text-d-muted uppercase tracking-wide mb-1">Total Ejecutado</div>
          <div className="text-2xl font-bold num text-blue-700 dark:text-blue-400">{formatMoney(totalEjecutado)}</div>
        </div>
        <div className="rounded-xl border border-line dark:border-d-line bg-white dark:bg-d-card p-4">
          <div className="text-xs text-ink-500 dark:text-d-muted uppercase tracking-wide mb-1">Total Adjudicado</div>
          <div className="text-2xl font-bold num text-ink-800 dark:text-d-text">{formatMoney(totalAdjudicado)}</div>
        </div>
        <div className="rounded-xl border border-line dark:border-d-line bg-white dark:bg-d-card p-4">
          <div className="text-xs text-ink-500 dark:text-d-muted uppercase tracking-wide mb-1">Municipios con gasto</div>
          <div className="text-2xl font-bold num text-ink-800 dark:text-d-text">
            {formatNumber(data.filter((r) => r.monto_ejecutado > 0).length)}
          </div>
        </div>
      </div>

      {/* Choropleth map */}
      <SectionCard
        title="Gasto por Municipio"
        subtitle="Haz clic en un municipio para ver sus proyectos"
        actions={
          <div className="flex gap-1 rounded-lg border border-line dark:border-d-line p-0.5 text-xs">
            {[
              { value: 'monto_ejecutado', label: 'Ejecutado' },
              { value: 'monto_adjudicado', label: 'Adjudicado' },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMetric(value)}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  metric === value
                    ? 'bg-accent text-white'
                    : 'text-ink-600 dark:text-d-muted hover:bg-canvas dark:hover:bg-d-canvas'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <LoadingSpinner label="Cargando datos de gasto…" />
        ) : (
          <GastoMap
            data={data}
            metric={metric}
            geoJson={geoJson}
            geoLoading={geoLoading}
            geoError={geoError}
            onMunicipioClick={setSelectedMunicipio}
          />
        )}
      </SectionCard>

      {/* Municipalities table */}
      <SectionCard title={`Municipios por ${metric === 'monto_ejecutado' ? 'gasto ejecutado' : 'monto adjudicado'}`}>
        {loading ? (
          <LoadingSpinner label="Cargando tabla…" />
        ) : rankedMunicipios.length === 0 ? (
          <EmptyState title="Sin datos" message="No hay registros para los filtros seleccionados." />
        ) : (
          <DataTable
            columns={MUN_COLS}
            data={rankedMunicipios}
            defaultSort={{ key: metric, direction: 'desc' }}
            searchPlaceholder="Buscar municipio o departamento…"
            pageSize={15}
            onRowClick={(row) => setSelectedMunicipio({ municipio: row.municipio, departamento: row.departamento })}
          />
        )}
      </SectionCard>

      {/* Municipality detail modal */}
      {selectedMunicipio && (
        <MunicipioModal
          municipio={selectedMunicipio.municipio}
          departamento={selectedMunicipio.departamento}
          filters={filters}
          onClose={() => setSelectedMunicipio(null)}
        />
      )}

    </div>
  )
}
