import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ListChecks,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import L from 'leaflet'
import { GeoJSON, MapContainer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getAlcaldeDetalle, getAlcaldesMunicipioDetalle, getAlcaldesProveedores } from '../../api/client.js'
import { formatMoney, formatNumber, formatPercent, nameFromLink } from '../../utils/format.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import InsightCard from '../common/InsightCard.jsx'
import InsightDetailModal from '../common/InsightDetailModal.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import SearchableSelect from '../common/SearchableSelect.jsx'
import KpiCard from '../common/KpiCard.jsx'
import ExternalLink from '../common/ExternalLink.jsx'

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

export default function TabAlcaldesProveedores({ filters }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [activeInsight, setActiveInsight] = useState(null)
  const [periodoFrom, setPeriodoFrom] = useState(null)
  const [periodoTo, setPeriodoTo] = useState(null)
  const [geoJson, setGeoJson] = useState(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError] = useState(null)
  const [mapMunicipioModal, setMapMunicipioModal] = useState(null)
  const [mapMunicipioLoading, setMapMunicipioLoading] = useState(false)
  const [mapMunicipioError, setMapMunicipioError] = useState(null)
  const [mapProjectModal, setMapProjectModal] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setSelected(null)
    setDetail(null)
    getAlcaldesProveedores(filters, { periodoFrom, periodoTo })
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err?.message || 'Error al cargar datos'))
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

  const loadDetail = useCallback(
    async (alc) => {
      if (!alc) return
      setDetailLoading(true)
      setDetailError(null)
      try {
        const d = await getAlcaldeDetalle(alc, filters)
        setDetail(d)
      } catch (err) {
        setDetailError(err?.response?.data?.detail || err?.message || 'Error al cargar detalle')
        setDetail(null)
      } finally {
        setDetailLoading(false)
      }
    },
    [filters]
  )

  useEffect(() => {
    if (selected) loadDetail(selected)
    else setDetail(null)
  }, [selected, loadDetail])

  const handleMapMunicipioClick = useCallback(
    async ({ municipio, departamento }) => {
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
        const res = await getAlcaldesMunicipioDetalle(municipio, filters, { periodoFrom, periodoTo })
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
    },
    [filters, periodoFrom, periodoTo]
  )

  if (loading) return <LoadingSpinner label="Cargando análisis…" />
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudo cargar la información" message={error} />
  if (!data) return null

  const insights = data.insights || {}
  const items = [
    insights.top_conc && {
      label: 'Mayor concentración con un proveedor',
      value: (
        <>
          <strong>{insights.top_conc.alcalde}</strong> ({insights.top_conc.partido}) — {formatPercent(insights.top_conc.share)} del adjudicado.
        </>
      ),
      explanation:
        'Un alcalde que concentra una proporción tan alta de su obra en un solo proveedor puede estar facilitando —conscientemente o no— un esquema de adjudicación dirigida. La falta de diversificación de proveedores elimina la competencia real y aumenta el riesgo de sobreprecio.',
    },
    {
      label: 'Alcaldes con proveedor único',
      value: (
        <>
          <strong className="num">{formatNumber(insights.count_unique_supplier)}</strong> alcaldes con &gt;2 proyectos concentrados en un solo proveedor.
        </>
      ),
      explanation:
        'Cuando múltiples alcaldes operan con el mismo patrón de proveedor único, el riesgo de coordinación entre actores políticos y empresariales aumenta significativamente. En sistemas de contratación sanos, distintos tipos de obra deberían atraer distintos oferentes.',
    },
    insights.top_monto && {
      label: 'Mayor monto en un solo proveedor',
      value: (
        <>
          <strong>{insights.top_monto.alcalde}</strong> ({insights.top_monto.partido}) — {formatMoney(insights.top_monto.monto_total)}.
        </>
      ),
      explanation:
        'Un alcalde que canaliza un volumen tan alto a una sola empresa crea una relación económica de gran magnitud. Eso genera incentivos estructurales para mantener la relación preferente, incluso si implica irregularidades en los procesos de contratación.',
    },
    insights.worst_ratio && {
      label: 'Peor cumplimiento de meta',
      value: (
        <>
          <strong>{insights.worst_ratio.alcalde}</strong> ({insights.worst_ratio.partido}) con {formatPercent(insights.worst_ratio.ratio)}.
        </>
      ),
      explanation:
        'Un alcalde con el peor cumplimiento de metas físicas promedio está ejecutando presupuesto sin entregar obra proporcional. Este patrón sostenido durante su gestión difícilmente es atribuible a circunstancias externas; sugiere que los pagos se realizaron sin verificar la entrega real.',
    },
    insights.top_sospechoso && {
      label: 'Mayor proporción de proyectos sospechosos',
      value: (
        <>
          <strong>{insights.top_sospechoso.alcalde}</strong> ({insights.top_sospechoso.partido}) — {formatPercent(insights.top_sospechoso.ratio)}.
        </>
      ),
      explanation:
        'Un alcalde con la mayor tasa de proyectos sospechosos concentra las alertas de riesgo más severas del sistema. Cada proyecto sospechoso representa dinero gastado por encima del 95 % con una meta física inferior al 50 %, lo que puede indicar pagos realizados sin entrega completa de obra.',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <InsightCard
        title="Hallazgos · Alcaldes y proveedores"
        subtitle="Relación entre alcaldes y la asignación de contratos. Haz clic en cada hallazgo para ver el análisis."
        items={items}
        onItemClick={setActiveInsight}
      />

      <SectionCard
        title="Mapa de proyectos por municipio"
        subtitle="Suma de proyectos por municipio según el rango de periodos electorales (4 años por periodo)."
        tooltip="Hover para ver alcalde, partido y obras relevantes del municipio."
        actions={
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
        }
      >
        <MunicipiosPeriodoMap
          geoJson={geoJson}
          geoLoading={geoLoading}
          geoError={geoError}
          data={data.map_municipios_proyectos || []}
          fromColor="#DBEAFE"
          toColor="#1D4ED8"
          onMunicipioClick={handleMapMunicipioClick}
        />
      </SectionCard>

      <SectionCard
        title="Alcaldes con proveedor único"
        subtitle="Alcaldes con más de 2 proyectos atribuidos a un solo proveedor."
      >
        {data.table?.length ? (
          <DataTable
            columns={[
              {
                key: 'alcalde_ganador',
                header: 'Alcalde',
                render: (r) =>
                  r.alcalde_link ? (
                    <ExternalLink href={r.alcalde_link}>{r.alcalde_ganador || nameFromLink(r.alcalde_link)}</ExternalLink>
                  ) : (
                    r.alcalde_ganador
                  ),
              },
              { key: 'municipio', header: 'Municipio' },
              { key: 'departamento', header: 'Departamento' },
              { key: 'periodo_alcalde', header: 'Periodo', align: 'right', render: (r) => formatNumber(r.periodo_alcalde) },
              {
                key: 'proveedor_principal',
                header: 'Proveedor',
                render: (r) =>
                  r.proveedor_link ? (
                    <ExternalLink href={r.proveedor_link}>{r.proveedor_principal || nameFromLink(r.proveedor_link)}</ExternalLink>
                  ) : (
                    r.proveedor_principal
                  ),
              },
              { key: 'proyectos', header: 'Proyectos', align: 'right', render: (r) => formatNumber(r.proyectos) },
              {
                key: 'monto_total_ejecutado',
                header: 'Monto ejecutado',
                align: 'right',
                render: (r) => formatMoney(r.monto_total_ejecutado),
              },
              {
                key: 'promedio_ratio_meta_ejecutada',
                header: 'Ratio meta %',
                align: 'right',
                render: (r) => formatPercent(r.promedio_ratio_meta_ejecutada),
              },
            ]}
            data={data.table}
            defaultSort={{ key: 'monto_total_ejecutado', direction: 'desc' }}
            searchPlaceholder="Buscar alcalde, proveedor, municipio…"
          />
        ) : (
          <EmptyState title="Sin hallazgos" message="No hay alcaldes con un único proveedor en la selección actual." />
        )}
      </SectionCard>

      <SectionCard
        title="Distribución de alcaldes por proyectos y monto"
        subtitle="Cada punto es un alcalde. Eje X: cantidad de proyectos. Eje Y: monto total ejecutado. Tamaño: monto promedio."
        tooltip="Visualiza qué alcaldes concentran muchos proyectos y/o mucho gasto."
      >
        <ScatterAlcaldes data={data.scatter_data || []} />
      </SectionCard>

      <SectionCard
        title="Buscar alcalde"
        subtitle="Análisis detallado de la gestión y proyectos de un alcalde específico."
      >
        <div className="max-w-md mb-5">
          <SearchableSelect
            label="Alcalde"
            placeholder="Buscar y seleccionar alcalde…"
            options={data.alcaldes_list || []}
            value={selected}
            onChange={setSelected}
          />
        </div>

        {!selected ? (
          <EmptyState
            icon={Building2}
            title="Selecciona un alcalde"
            message="Elige un alcalde para ver el detalle de su gestión."
          />
        ) : detailLoading ? (
          <LoadingSpinner label="Cargando detalle…" />
        ) : detailError ? (
          <EmptyState icon={AlertTriangle} title="No se encontraron datos" message={detailError} />
        ) : detail ? (
          <AlcaldeDetalle detail={detail} />
        ) : null}
      </SectionCard>

      {activeInsight && (
        <InsightDetailModal item={activeInsight} onClose={() => setActiveInsight(null)} />
      )}
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

function ScatterAlcaldes({ data }) {
  const { theme } = useTheme()
  const axisColor = theme === 'dark' ? '#94A3B8' : '#6B7280'
  const gridColor = theme === 'dark' ? '#243245' : '#E5E7EB'

  const rows = useMemo(
    () =>
      (data || [])
        .map((r) => ({
          name: r.alcalde_ganador,
          proyectos: r.proyectos,
          monto: r.monto_total_ejecutado,
          promedio: r.promedio_monto_ejecutado,
        }))
        .filter((r) => Number.isFinite(r.proyectos) && Number.isFinite(r.monto)),
    [data]
  )

  if (rows.length === 0) {
    return <EmptyState title="Sin datos suficientes" message="No hay alcaldes con monto y proyectos en la selección." />
  }

  return (
    <div className="h-80" style={{ minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="proyectos"
            name="Proyectos"
            tick={{ fill: axisColor, fontSize: 11 }}
            stroke={axisColor}
            label={{ value: 'Proyectos', position: 'insideBottom', offset: -10, fill: axisColor, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="monto"
            name="Monto ejecutado"
            tick={{ fill: axisColor, fontSize: 11 }}
            stroke={axisColor}
            tickFormatter={(v) => formatMoney(v, { compact: true, prefix: 'Q ' })}
            width={80}
          />
          <ZAxis type="number" dataKey="promedio" range={[40, 400]} name="Promedio" />
          <RTooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{
              backgroundColor: theme === 'dark' ? '#1A2535' : '#ffffff',
              border: `1px solid ${gridColor}`,
              borderRadius: 8,
              color: theme === 'dark' ? '#F1F5F9' : '#1F2937',
              fontSize: 12,
            }}
            formatter={(value, key) => {
              if (key === 'monto' || key === 'promedio') return formatMoney(value)
              return formatNumber(value)
            }}
            labelFormatter={() => ''}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null
              const p = payload[0].payload
              return (
                <div
                  style={{
                    backgroundColor: theme === 'dark' ? '#1A2535' : '#ffffff',
                    border: `1px solid ${gridColor}`,
                    borderRadius: 8,
                    color: theme === 'dark' ? '#F1F5F9' : '#1F2937',
                    fontSize: 12,
                    padding: '8px 10px',
                    boxShadow: '0 4px 10px rgba(15,23,42,0.08)',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
                  <div>Proyectos: <span className="num">{formatNumber(p.proyectos)}</span></div>
                  <div>Monto: <span className="num">{formatMoney(p.monto)}</span></div>
                  <div>Promedio: <span className="num">{formatMoney(p.promedio)}</span></div>
                </div>
              )
            }}
          />
          <Scatter data={rows} fill="#2563EB" fillOpacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

function MunicipiosPeriodoMap({ geoJson, geoLoading, geoError, data, fromColor, toColor, onMunicipioClick }) {
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

  const maxValue = useMemo(() => {
    const values = rows.map((r) => r.total_proyectos).filter((v) => Number.isFinite(v) && v > 0)
    return values.length ? Math.max(...values) : 0
  }, [rows])
  const minValue = useMemo(() => {
    const values = rows.map((r) => r.total_proyectos).filter((v) => Number.isFinite(v) && v > 0)
    return values.length ? Math.min(...values) : 0
  }, [rows])

  const mapBounds = useMemo(() => (geoJson ? L.geoJSON(geoJson).getBounds() : null), [geoJson])

  if (rows.length === 0) {
    return <EmptyState title="Sin datos" message="No hay municipios para el rango de periodos seleccionado." />
  }
  if (geoLoading) return <LoadingSpinner label="Cargando mapa…" />
  if (geoError || !geoJson || !mapBounds) {
    return <EmptyState title="Mapa no disponible" message={geoError || 'No se pudo preparar la geometría de municipios.'} />
  }

  const styleFeature = (feature) => {
    const muniKey = normalizeMunicipio(feature?.properties?.municipio)
    const stat = statsByMunicipio.get(muniKey)
    const value = Number(stat?.total_proyectos) || 0
    const ratio = maxValue > 0 ? value / maxValue : 0
    return {
      fillColor: value > 0 ? interpolateColor(fromColor, toColor, ratio) : '#E5E7EB',
      fillOpacity: value > 0 ? 0.9 : 0.35,
      color: '#334155',
      weight: 0.7,
      opacity: 0.8,
      className: onMunicipioClick ? 'cursor-pointer' : undefined,
    }
  }

  const onEachFeature = (feature, layer) => {
    const props = feature?.properties || {}
    const muniKey = normalizeMunicipio(props.municipio)
    const stat = statsByMunicipio.get(muniKey)
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
      `Proyectos: ${formatNumber(stat?.total_proyectos || 0)}`,
      `Monto ejecutado: ${formatMoney(stat?.monto_total_ejecutado || 0)}`,
      `Alcalde(s) por periodo:<br/>${alcaldesHtml}`,
      `Diputado del departamento: ${stat?.diputado_nombre || 'N/D'} (${stat?.diputado_partido || 'N/D'})`,
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
        if (!onMunicipioClick) return
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
            key={`map-periodo-${maxValue}-${rows.length}`}
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
          <span>Bajo: {formatNumber(minValue)}</span>
          <span>Termómetro de proyectos</span>
          <span>Alto: {formatNumber(maxValue)}</span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500 dark:text-d-muted">
        <span>Sin datos</span>
        <span>Escala: {formatNumber(minValue)} → {maxValue > 0 ? formatNumber(maxValue) : '0'} proyectos</span>
      </div>
    </div>
  )
}

function AlcaldeDetalle({ detail }) {
  const k = detail.kpis || {}
  const cols = [
    { key: 'snip', header: 'SNIP' },
    { key: 'proyecto', header: 'Proyecto' },
    { key: 'proveedor', header: 'Proveedor' },
    { key: 'ejercicio', header: 'Año', align: 'right' },
    { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
    { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
    {
      key: 'brecha_adjudicado_ejecutado',
      header: 'Brecha',
      align: 'right',
      render: (r) => formatMoney(r.brecha_adjudicado_ejecutado),
    },
    {
      key: 'ratio_meta_ejecucion',
      header: 'Ratio meta',
      align: 'right',
      render: (r) => formatPercent(r.ratio_meta_ejecucion),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard label="Municipio" value={k.municipio || '—'} icon={Building2} description={k.departamento || ''} />
        <KpiCard label="Periodo electo" value={k.anio_electo || '—'} icon={CalendarDays} description="Año de elección" />
        <KpiCard label="Proyectos" value={formatNumber(k.total_proyectos)} icon={ListChecks} description="Total de proyectos." />
        <KpiCard
          label="Monto ejecutado"
          value={formatMoney(k.monto_total_ejecutado, { compact: true })}
          icon={Wallet}
          accent="accent"
          description="Suma del gasto."
        />
        <KpiCard
          label="Ratio meta"
          value={formatPercent(k.ratio_promedio)}
          icon={Target}
          accent="success"
          description="Cumplimiento promedio."
        />
        <KpiCard
          label="% Sospechosos"
          value={formatPercent(k.pct_sospechosos)}
          icon={AlertTriangle}
          accent="danger"
          description="Proyectos sospechosos."
        />
        <KpiCard
          label="% Sin meta con gasto"
          value={formatPercent(k.pct_sin_meta_ejecutada)}
          icon={TrendingDown}
          accent="warn"
          description="Con gasto sin meta."
        />
        <KpiCard
          label="Sobreejecución"
          value={formatNumber(k.proyectos_sobreejecucion)}
          icon={TrendingUp}
          accent="warn"
          description="Gasto > meta."
        />
      </div>

      <DataTable
        columns={cols}
        data={(detail.proyectos || []).map((r) => ({
          ...r,
          _risk:
            r.sin_meta_ejecutada_con_gasto === 1
              ? 'sin_meta'
              : r.sospechoso === 1
                ? 'sospechoso'
                : r.sobreejecucion_financiera === 1
                  ? 'sobreejecucion'
                  : undefined,
        }))}
        defaultSort={{ key: 'monto_ejecutado', direction: 'desc' }}
        searchPlaceholder="Buscar proyecto, SNIP, proveedor…"
      />
    </div>
  )
}
