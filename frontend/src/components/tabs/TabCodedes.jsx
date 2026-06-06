import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, ListChecks, Wallet, X } from 'lucide-react'
import L from 'leaflet'
import { GeoJSON, MapContainer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getCodedes, getCodedesMunicipioDetalle } from '../../api/client.js'
import { formatMoney, formatNumber, formatPercent } from '../../utils/format.js'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import KpiCard from '../common/KpiCard.jsx'

function normalizeMunicipio(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

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
  const r = Math.round(from.r + (to.r - from.r) * clamped)
  const g = Math.round(from.g + (to.g - from.g) * clamped)
  const b = Math.round(from.b + (to.b - from.b) * clamped)
  return `rgb(${r}, ${g}, ${b})`
}

export default function TabCodedes({ filters }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [periodoFrom, setPeriodoFrom] = useState(null)
  const [periodoTo, setPeriodoTo] = useState(null)
  const [geoJson, setGeoJson] = useState(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError] = useState(null)
  const [mapMunicipioModal, setMapMunicipioModal] = useState(null)
  const [mapMunicipioLoading, setMapMunicipioLoading] = useState(false)
  const [mapMunicipioError, setMapMunicipioError] = useState(null)
  const [mapProjectModal, setMapProjectModal] = useState(null)
  const [mapMetric, setMapMetric] = useState('proyectos')
  const [tableView, setTableView] = useState('departamento')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getCodedes(filters, { periodoFrom, periodoTo })
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err?.message || 'Error al cargar datos de Codedes'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filters, periodoFrom, periodoTo])

  useEffect(() => {
    let active = true
    fetch('/gua.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`No se pudo cargar gua.json (${res.status})`)
        return res.json()
      })
      .then((json) => {
        if (active) setGeoJson(json)
      })
      .catch((err) => {
        if (active) setGeoError(err?.message || 'Error al cargar el mapa de municipios')
      })
      .finally(() => {
        if (active) setGeoLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const periodos = data?.periodos_disponibles || []
    if (!periodos.length) return
    setPeriodoFrom((prev) => (prev == null ? periodos[0] : prev))
    setPeriodoTo((prev) => (prev == null ? periodos[periodos.length - 1] : prev))
  }, [data?.periodos_disponibles])

  const handleMapMunicipioClick = async ({ municipio, departamento }) => {
    if (!municipio) return
    setMapMunicipioLoading(true)
    setMapMunicipioError(null)
    setMapMunicipioModal({
      municipio,
      departamento: departamento || null,
      kpis: null,
      proyectos: [],
    })
    try {
      const res = await getCodedesMunicipioDetalle(municipio, filters, { periodoFrom, periodoTo })
      setMapMunicipioModal({
        municipio,
        departamento: departamento || res?.kpis?.departamento || null,
        kpis: res?.kpis || null,
        proyectos: res?.proyectos || [],
      })
    } catch (err) {
      setMapMunicipioError(err?.response?.data?.detail || err?.message || 'Error al cargar proyectos del municipio')
    } finally {
      setMapMunicipioLoading(false)
    }
  }

  const municipiosTableData = useMemo(
    () =>
      (data?.map_municipios || []).map((r) => ({
        ...r,
        alcalde_principal: r.alcaldes_periodo?.[0]?.alcalde_ganador || '—',
        partido_principal: r.alcaldes_periodo?.[0]?.siglas_ganadora || '—',
      })),
    [data?.map_municipios]
  )

  if (loading) return <LoadingSpinner label="Cargando análisis de Codedes…" />
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar la información" message={error} />
  if (!data) return null

  const k = data.kpis || {}
  const insights = data.insights || {}

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Codedes" value={formatNumber(k.total_codedes)} icon={Building2} description="Consejos departamentales activos." />
        <KpiCard label="Proyectos" value={formatNumber(k.total_proyectos)} icon={ListChecks} description="Total de proyectos en Codedes." />
        <KpiCard label="Monto ejecutado" value={formatMoney(k.monto_total_ejecutado, { compact: true })} icon={Wallet} accent="accent" description="Gasto total ejecutado." />
        <KpiCard
          label="Codede top por monto"
          value={insights.top_monto?.codede || '—'}
          icon={Wallet}
          description={insights.top_monto ? formatMoney(insights.top_monto.monto_total_ejecutado) : 'Sin datos'}
        />
      </div>

      <SectionCard
        title="Mapa de proyectos CODEDES por municipio"
        subtitle="Municipios financiados por Consejos de Desarrollo."
        tooltip="Hover para ver codede, alcalde, partido y obras destacadas."
        actions={
          <div className="flex items-center gap-3">
            <div className="flex rounded-md border border-line dark:border-d-line overflow-hidden text-xs">
              <button
                type="button"
                className={`px-3 py-1.5 transition-colors ${mapMetric === 'proyectos' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-d-card text-ink-600 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'}`}
                onClick={() => setMapMetric('proyectos')}
              >
                Proyectos
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 border-l border-line dark:border-d-line transition-colors ${mapMetric === 'monto' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-d-card text-ink-600 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'}`}
                onClick={() => setMapMetric('monto')}
              >
                Monto
              </button>
            </div>
            <div className="flex items-center gap-2">
            <label className="text-xs text-ink-500 dark:text-d-muted">
              Desde
              <select
                className="ml-1 rounded-md border border-line dark:border-d-line bg-white dark:bg-d-card px-2 py-1 text-xs text-ink-700 dark:text-d-text"
                value={periodoFrom ?? ''}
                onChange={(e) => setPeriodoFrom(e.target.value ? Number(e.target.value) : null)}
              >
                {(data.periodos_disponibles || []).map((p) => (
                  <option key={`from-${p}`} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-500 dark:text-d-muted">
              Hasta
              <select
                className="ml-1 rounded-md border border-line dark:border-d-line bg-white dark:bg-d-card px-2 py-1 text-xs text-ink-700 dark:text-d-text"
                value={periodoTo ?? ''}
                onChange={(e) => setPeriodoTo(e.target.value ? Number(e.target.value) : null)}
              >
                {(data.periodos_disponibles || []).map((p) => (
                  <option key={`to-${p}`} value={p}>{p}</option>
                ))}
              </select>
            </label>
            </div>
          </div>
        }
      >
        <CodedesMap
          geoJson={geoJson}
          geoLoading={geoLoading}
          geoError={geoError}
          data={data.map_municipios || []}
          fromColor="#DCFCE7"
          toColor="#15803D"
          onMunicipioClick={handleMapMunicipioClick}
          metric={mapMetric}
        />
      </SectionCard>

      <SectionCard
        title={tableView === 'departamento' ? 'Estadísticas por CODEDE' : 'Estadísticas por Municipio'}
        subtitle={tableView === 'departamento' ? 'Resumen por departamento (CODEDE).' : 'Resumen por municipio con proyectos CODEDE.'}
        actions={
          <div className="flex rounded-md border border-line dark:border-d-line overflow-hidden text-xs">
            <button
              type="button"
              className={`px-3 py-1.5 transition-colors ${tableView === 'departamento' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-d-card text-ink-600 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'}`}
              onClick={() => setTableView('departamento')}
            >
              Por Departamento
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 border-l border-line dark:border-d-line transition-colors ${tableView === 'municipio' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-d-card text-ink-600 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas'}`}
              onClick={() => setTableView('municipio')}
            >
              Por Municipio
            </button>
          </div>
        }
      >
        {tableView === 'departamento' ? (
          data.table?.length ? (
            <DataTable
              columns={[
                { key: 'codede', header: 'CODEDE' },
                { key: 'departamento', header: 'Departamento' },
                { key: 'periodo_principal', header: 'Periodo', align: 'right' },
                { key: 'alcalde_principal', header: 'Alcalde principal' },
                { key: 'partido_principal', header: 'Partido' },
                { key: 'total_proyectos', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.total_proyectos) },
                {
                  key: 'monto_total_ejecutado',
                  header: 'Monto ejecutado',
                  align: 'right',
                  render: (r) => formatMoney(r.monto_total_ejecutado),
                },
                {
                  key: 'pct_sospechosos',
                  header: '% Sospechosos',
                  align: 'right',
                  render: (r) => formatPercent(r.pct_sospechosos),
                },
              ]}
              data={data.table}
              defaultSort={{ key: 'monto_total_ejecutado', direction: 'desc' }}
              searchPlaceholder="Buscar codede, departamento, alcalde…"
            />
          ) : (
            <EmptyState title="Sin datos" message="No hay datos CODEDES para la selección actual." />
          )
        ) : (
          municipiosTableData?.length ? (
            <DataTable
              columns={[
                { key: 'municipio', header: 'Municipio' },
                { key: 'codede', header: 'CODEDE' },
                { key: 'alcalde_principal', header: 'Alcalde principal' },
                { key: 'partido_principal', header: 'Partido' },
                { key: 'total_proyectos', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.total_proyectos) },
                {
                  key: 'monto_total_ejecutado',
                  header: 'Monto ejecutado',
                  align: 'right',
                  render: (r) => formatMoney(r.monto_total_ejecutado),
                },
              ]}
              data={municipiosTableData}
              defaultSort={{ key: 'monto_total_ejecutado', direction: 'desc' }}
              searchPlaceholder="Buscar municipio, codede, alcalde…"
            />
          ) : (
            <EmptyState title="Sin datos" message="No hay municipios CODEDE para la selección actual." />
          )
        )}
      </SectionCard>

      {mapMunicipioModal && (
        <MunicipioProyectosModal
          municipio={mapMunicipioModal.municipio}
          departamento={mapMunicipioModal.departamento}
          kpis={mapMunicipioModal.kpis}
          proyectos={mapMunicipioModal.proyectos}
          loading={mapMunicipioLoading}
          error={mapMunicipioError}
          onClose={() => {
            setMapMunicipioModal(null)
            setMapMunicipioError(null)
          }}
          onRowClick={(row) => setMapProjectModal(row)}
        />
      )}
      {mapProjectModal && <ProyectoInfoModal row={mapProjectModal} onClose={() => setMapProjectModal(null)} />}
    </div>
  )
}

function BaseModal({ title, subtitle, onClose, children, wide = false }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`relative bg-white dark:bg-d-card rounded-xl2 shadow-2xl border border-line dark:border-d-line flex flex-col max-h-[90vh] ${wide ? 'w-full max-w-6xl' : 'w-full max-w-lg'}`}
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

function MunicipioProyectosModal({ municipio, departamento, kpis, proyectos, loading, error, onClose, onRowClick }) {
  const cols = [
    { key: 'score_riesgo', header: 'Score', align: 'right' },
    { key: 'snip', header: 'SNIP' },
    { key: 'proyecto', header: 'Proyecto' },
    { key: 'alcalde_ganador', header: 'Alcalde' },
    { key: 'siglas_ganadora', header: 'Partido' },
    { key: 'proveedor', header: 'Proveedor' },
    { key: 'ejercicio', header: 'Año', align: 'right' },
    { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
    { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
    { key: 'ratio_meta_ejecucion', header: 'Ratio meta', align: 'right', render: (r) => formatPercent(r.ratio_meta_ejecucion) },
  ]

  return (
    <BaseModal
      wide
      title={`Proyectos del municipio · ${municipio}`}
      subtitle={[
        departamento || kpis?.departamento,
        kpis?.total_proyectos != null ? `${formatNumber(kpis.total_proyectos)} proyectos` : null,
        kpis?.monto_total_ejecutado != null ? formatMoney(kpis.monto_total_ejecutado) : null,
      ].filter(Boolean).join(' · ')}
      onClose={onClose}
    >
      <div className="p-4">
        {loading ? (
          <LoadingSpinner label="Cargando proyectos…" />
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="No se pudo cargar" message={error} />
        ) : proyectos?.length ? (
          <DataTable
            columns={cols}
            data={proyectos}
            defaultSort={{ key: 'monto_ejecutado', direction: 'desc' }}
            searchPlaceholder="Buscar SNIP, proyecto, alcalde, proveedor…"
            onRowClick={onRowClick}
          />
        ) : (
          <EmptyState title="Sin proyectos" message="No se encontraron proyectos para este municipio y rango de periodos." />
        )}
      </div>
    </BaseModal>
  )
}

function ProyectoInfoModal({ row, onClose }) {
  const flag = (v) => (v === 1 ? 'Si' : 'No')
  return (
    <BaseModal
      title={row.proyecto || 'Detalle de proyecto'}
      subtitle={[row.snip && `SNIP ${row.snip}`, row.ejercicio, row.departamento].filter(Boolean).join(' · ')}
      onClose={onClose}
    >
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            ['Alcalde', row.alcalde_ganador || '—'],
            ['Partido', row.siglas_ganadora || '—'],
            ['Proveedor', row.proveedor || '—'],
            ['Monto adjudicado', formatMoney(row.monto_adjudicado)],
            ['Monto ejecutado', formatMoney(row.monto_ejecutado)],
            ['Brecha', formatMoney(row.brecha_adjudicado_ejecutado)],
            ['Ratio meta', formatPercent(row.ratio_meta_ejecucion)],
            ['Score riesgo', row.score_riesgo ?? '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-canvas dark:bg-d-canvas p-3">
              <div className="text-xs text-ink-500 dark:text-d-muted uppercase tracking-wide">{label}</div>
              <div className="font-semibold num text-ink-800 dark:text-d-text mt-0.5">{value}</div>
            </div>
          ))}
        </div>

        <div className="border-t border-line dark:border-d-line pt-4 text-xs text-ink-600 dark:text-d-muted">
          <div className="font-semibold text-ink-800 dark:text-d-text mb-2">Alertas</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>Sospechoso: {flag(row.sospechoso)}</div>
            <div>Sin meta con gasto: {flag(row.sin_meta_ejecutada_con_gasto)}</div>
            <div>Meta baja con gasto: {flag(row.meta_baja_con_gasto)}</div>
            <div>Sobreejecución: {flag(row.sobreejecucion_financiera)}</div>
            <div>Fraccionamiento: {flag(row.fraccionamiento)}</div>
            <div>Modificación excesiva: {flag(row.modificacion_excesiva)}</div>
            <div>Adjudicación directa: {flag(row.adjudicacion_directa)}</div>
            <div>Oferente único: {flag(row.oferente_unico)}</div>
          </div>
        </div>
      </div>
    </BaseModal>
  )
}

function CodedesMap({ geoJson, geoLoading, geoError, data, fromColor, toColor, onMunicipioClick, metric = 'proyectos' }) {
  const rows = useMemo(
    () =>
      (data || []).map((r) => ({
        ...r,
        total_proyectos: Number(r.total_proyectos) || 0,
        monto_total_ejecutado: Number(r.monto_total_ejecutado) || 0,
      })),
    [data]
  )

  const statsByMunicipio = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      map.set(normalizeMunicipio(row.municipio), row)
    }
    return map
  }, [rows])

  const metricKey = metric === 'monto' ? 'monto_total_ejecutado' : 'total_proyectos'

  const maxValue = useMemo(() => {
    const values = rows.map((r) => r[metricKey]).filter((v) => Number.isFinite(v) && v > 0)
    return values.length ? Math.max(...values) : 0
  }, [rows, metricKey])
  const minValue = useMemo(() => {
    const values = rows.map((r) => r[metricKey]).filter((v) => Number.isFinite(v) && v > 0)
    return values.length ? Math.min(...values) : 0
  }, [rows, metricKey])
  const mapBounds = useMemo(() => (geoJson ? L.geoJSON(geoJson).getBounds() : null), [geoJson])

  if (rows.length === 0) return <EmptyState title="Sin datos" message="No hay municipios CODEDE en esta selección." />
  if (geoLoading) return <LoadingSpinner label="Cargando mapa…" />
  if (geoError || !geoJson || !mapBounds) {
    return <EmptyState title="Mapa no disponible" message={geoError || 'No se pudo preparar la geometría de municipios.'} />
  }

  const styleFeature = (feature) => {
    const muniKey = normalizeMunicipio(feature?.properties?.municipio)
    const stat = statsByMunicipio.get(muniKey)
    const value = Number(stat?.[metricKey]) || 0
    const ratio = maxValue > 0 ? value / maxValue : 0
    const interactive = Boolean(onMunicipioClick && Number(stat?.total_proyectos) > 0)
    return {
      fillColor: value > 0 ? interpolateColor(fromColor, toColor, ratio) : '#E5E7EB',
      fillOpacity: value > 0 ? 0.9 : 0.35,
      color: '#334155',
      weight: 0.7,
      opacity: 0.8,
      className: interactive ? 'cursor-pointer' : undefined,
    }
  }

  const onEachFeature = (feature, layer) => {
    const props = feature?.properties || {}
    const stat = statsByMunicipio.get(normalizeMunicipio(props.municipio))
    const alcaldes = (stat?.alcaldes_periodo || []).slice(0, 3)
    const obras = (stat?.obras || []).slice(0, 3)
    const alcaldesHtml = alcaldes.length
      ? alcaldes
          .map((a) => `${a.periodo_alcalde || 'N/D'}: ${a.alcalde_ganador || 'N/D'} (${a.siglas_ganadora || 'N/D'})`)
          .join('<br/>')
      : 'Sin datos de alcalde'
    const obrasHtml = obras.length
      ? obras.map((o) => `- ${o.proyecto} (${formatNumber(o.proyectos)} proj.)`).join('<br/>')
      : 'Sin obras destacadas'

    const tooltip = [
      `<strong>${props.municipio || 'Municipio'}</strong>`,
      `Departamento: ${props.departamento || '—'}`,
      `CODEDE: ${stat?.codede || (props.departamento ? `CODEDE ${props.departamento}` : '—')}`,
      `Proyectos: ${formatNumber(stat?.total_proyectos || 0)}`,
      `Monto ejecutado: ${formatMoney(stat?.monto_total_ejecutado || 0)}`,
      `Alcalde(s) por periodo:<br/>${alcaldesHtml}`,
      `Obras destacadas:<br/>${obrasHtml}`,
    ].join('<br/>')

    layer.bindTooltip(tooltip, {
      sticky: true,
      direction: 'auto',
      opacity: 0.95,
      className: 'text-xs',
    })
    layer.on({
      mouseover: () => {
        layer.setStyle({ weight: 1.8, color: '#0F172A', opacity: 1 })
        layer.openTooltip()
      },
      mouseout: () => {
        layer.setStyle({ weight: 0.7, color: '#334155', opacity: 0.8 })
      },
      click: () => {
        if (!onMunicipioClick || !stat || Number(stat.total_proyectos) <= 0) return
        onMunicipioClick({ municipio: props.municipio, departamento: props.departamento })
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
          zoomControl
          attributionControl={false}
          style={{ width: '100%', height: 540 }}
          className="bg-slate-100 dark:bg-slate-900"
          whenReady={(evt) => {
            setTimeout(() => {
              evt.target.invalidateSize()
              evt.target.fitBounds(mapBounds, { padding: [24, 24] })
            }, 0)
          }}
        >
          <GeoJSON
            key={`map-codedes-${metric}-${maxValue}-${rows.length}`}
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
            style={{ background: `linear-gradient(90deg, #E5E7EB 0%, ${fromColor} 25%, ${toColor} 100%)` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-500 dark:text-d-muted">
          <span>Bajo: {metric === 'monto' ? formatMoney(minValue, { compact: true }) : formatNumber(minValue)}</span>
          <span>{metric === 'monto' ? 'Termómetro de monto ejecutado' : 'Termómetro de proyectos'}</span>
          <span>Alto: {metric === 'monto' ? formatMoney(maxValue, { compact: true }) : formatNumber(maxValue)}</span>
        </div>
      </div>
    </div>
  )
}
