import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ListChecks,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import L from 'leaflet'
import { GeoJSON, MapContainer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getMunicipioDetalle, getMunicipiosProveedorDetalle, getMunicipiosProveedores } from '../../api/client.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import { formatMoney, formatNumber, formatPercent, nameFromLink } from '../../utils/format.js'
import LoadingSpinner from '../common/LoadingSpinner.jsx'
import EmptyState from '../common/EmptyState.jsx'
import InsightCard from '../common/InsightCard.jsx'
import InsightDetailModal from '../common/InsightDetailModal.jsx'
import SectionCard from '../common/SectionCard.jsx'
import DataTable from '../common/DataTable.jsx'
import SearchableSelect from '../common/SearchableSelect.jsx'
import KpiCard from '../common/KpiCard.jsx'
import ExternalLink from '../common/ExternalLink.jsx'

// ─── Normalize municipality names for GeoJSON matching ────────────────────────
function normalizeMunicipio(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
}

function scaleColor(hex, ratio) {
  const clean = hex.replace('#', '')
  const num = Number.parseInt(clean, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  const f = Math.max(0.35, Math.min(1, ratio))
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`
}

function electionBands(minYear, maxYear) {
  const safeMin = Number.isFinite(minYear) ? Number(minYear) : null
  const safeMax = Number.isFinite(maxYear) ? Number(maxYear) : null
  if (safeMin == null || safeMax == null) return []
  const raw = [
    { label: '2016-2019', from: 2016, to: 2019, color: '#DBEAFE' },
    { label: '2020-2023', from: 2020, to: 2023, color: '#DCFCE7' },
    { label: '2024-Actual', from: 2024, to: Math.max(2024, safeMax), color: '#FEE2E2' },
  ]
  return raw
    .map((b) => ({ ...b, from: Math.max(b.from, safeMin), to: Math.min(b.to, safeMax) }))
    .filter((b) => b.from <= b.to)
}

function YearlyMontoBars({ rows, title, subtitle, height = 240, totalMonto = 0, totalProyectos = 0 }) {
  const { theme } = useTheme()
  const axisColor = theme === 'dark' ? '#94A3B8' : '#6B7280'
  const gridColor = theme === 'dark' ? '#243245' : '#E5E7EB'
  const bars = (rows || [])
    .filter((r) => Number.isFinite(Number(r.ejercicio)))
    .map((r) => ({
      ejercicio: Number(r.ejercicio),
      monto_ejecutado: Number(r.monto_ejecutado) || 0,
      total_proyectos: Number(r.total_proyectos) || 0,
    }))
    .sort((a, b) => a.ejercicio - b.ejercicio)

  if (!bars.length) return <EmptyState title="Sin datos" message="No hay series anuales para este segmento." />
  if (bars.every((r) => r.monto_ejecutado === 0)) {
    const firstYear = bars[0].ejercicio
    const lastYear = bars[bars.length - 1].ejercicio
    const yearsLabel = firstYear === lastYear ? `${firstYear}` : `${firstYear}–${lastYear}`
    const msg =
      totalMonto > 0
        ? 'Gasto ejecutado no disponible para el período con año registrado.'
        : totalProyectos > 0
        ? `${formatNumber(totalProyectos)} proyectos adjudicados sin monto ejecutado registrado (${yearsLabel}).`
        : `Sin monto ejecutado registrado (${yearsLabel}).`
    return (
      <div className="rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card p-3">
        <div className="text-sm font-semibold text-ink-800 dark:text-d-text">{title}</div>
        {subtitle ? <div className="text-xs text-ink-500 dark:text-d-muted mt-0.5">{subtitle}</div> : null}
        <div className="mt-3 text-xs text-ink-400 dark:text-d-muted italic">{msg}</div>
      </div>
    )
  }

  const years = bars.map((r) => r.ejercicio)
  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const maxMonto = Math.max(...bars.map((r) => r.monto_ejecutado), 1)
  const bands = electionBands(minYear, maxYear)

  return (
    <div className="rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card p-3">
      <div className="mb-2">
        <div className="text-sm font-semibold text-ink-800 dark:text-d-text">{title}</div>
        {subtitle ? <div className="text-xs text-ink-500 dark:text-d-muted mt-0.5">{subtitle}</div> : null}
      </div>
      <div style={{ height }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            {bands.map((b) => (
              <ReferenceArea
                key={`${b.label}-${b.from}-${b.to}`}
                x1={b.from - 0.5}
                x2={b.to + 0.5}
                y1={0}
                y2={maxMonto * 1.15}
                fill={b.color}
                fillOpacity={0.25}
                ifOverflow="extendDomain"
              />
            ))}
            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="ejercicio"
              domain={[minYear - 0.5, maxYear + 0.5]}
              ticks={years}
              allowDecimals={false}
              tick={{ fill: axisColor, fontSize: 11 }}
              stroke={axisColor}
            />
            <YAxis
              tick={{ fill: axisColor, fontSize: 11 }}
              stroke={axisColor}
              tickFormatter={(v) => formatMoney(v, { compact: true })}
              width={72}
            />
            <RTooltip
              contentStyle={{
                backgroundColor: theme === 'dark' ? '#1A2535' : '#ffffff',
                border: `1px solid ${gridColor}`,
                borderRadius: 8,
                color: theme === 'dark' ? '#F1F5F9' : '#1F2937',
                fontSize: 12,
              }}
              formatter={(value, name, item) => {
                if (name === 'monto_ejecutado') return [formatMoney(value), 'Monto ejecutado']
                return [value, name]
              }}
              labelFormatter={(label) => `Año ${label}`}
            />
            <Bar dataKey="monto_ejecutado" fill="#EA580C" radius={[4, 4, 0, 0]} barSize={bars.length <= 2 ? 48 : bars.length <= 5 ? 32 : undefined} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-500 dark:text-d-muted">
        {bands.map((b) => (
          <span key={`legend-${b.label}`} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Provider mini-map modal ───────────────────────────────────────────────────
function ProveedorModal({
  proveedor,
  geoJson,
  detail,
  loading,
  error,
  selectedMunicipios,
  maxMunicipios,
  onToggleMunicipio,
  onClose,
  onRetry,
  selectionMessage,
}) {
  const [localMessage, setLocalMessage] = useState(null)
  const [snipsOpen, setSnipsOpen] = useState(new Set())
  const mapRef = useRef(null)
  useEffect(() => setSnipsOpen(new Set()), [detail])
  const toggleSnipsOpen = (municipio) =>
    setSnipsOpen((prev) => {
      const next = new Set(prev)
      next.has(municipio) ? next.delete(municipio) : next.add(municipio)
      return next
    })
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (!selectionMessage) return
    setLocalMessage(selectionMessage)
    const t = setTimeout(() => setLocalMessage(null), 2400)
    return () => clearTimeout(t)
  }, [selectionMessage])

  const mapRows = detail?.map_municipios || []
  const summary = detail?.kpis || {}
  const municipioSet = useMemo(
    () => new Set((mapRows || []).map((r) => normalizeMunicipio(r.municipio))),
    [mapRows]
  )
  const selectedSet = useMemo(() => new Set((selectedMunicipios || []).map(normalizeMunicipio)), [selectedMunicipios])
  const municipioStats = useMemo(() => {
    const m = new Map()
    for (const row of mapRows) m.set(normalizeMunicipio(row.municipio), row)
    return m
  }, [mapRows])

  const mapBounds = useMemo(() => (geoJson ? L.geoJSON(geoJson).getBounds() : null), [geoJson])
  const activeBounds = useMemo(() => {
    if (!geoJson || !municipioSet.size) return null
    const activeFeats = geoJson.features.filter(
      (f) => municipioSet.has(normalizeMunicipio(f?.properties?.municipio))
    )
    if (!activeFeats.length) return null
    try {
      return L.geoJSON({ type: 'FeatureCollection', features: activeFeats }).getBounds()
    } catch {
      return null
    }
  }, [geoJson, municipioSet])
  const maxMonto = useMemo(() => {
    const values = mapRows.map((r) => Number(r.monto_total_ejecutado) || 0)
    return values.length ? Math.max(...values) : 0
  }, [mapRows])
  const byMunicipioYear = useMemo(() => {
    const out = new Map()
    for (const row of detail?.series_anual_municipio || []) {
      const key = normalizeMunicipio(row.municipio)
      if (!out.has(key)) out.set(key, [])
      out.get(key).push({
        ejercicio: Number(row.ejercicio),
        monto_ejecutado: Number(row.monto_ejecutado) || 0,
        total_proyectos: Number(row.total_proyectos) || 0,
      })
    }
    for (const [k, rows] of out.entries()) {
      rows.sort((a, b) => a.ejercicio - b.ejercicio)
      out.set(k, rows)
    }
    return out
  }, [detail?.series_anual_municipio])

  const styleFeature = (feature) => {
    const muniKey = normalizeMunicipio(feature?.properties?.municipio)
    const stat = municipioStats.get(muniKey)
    const value = Number(stat?.monto_total_ejecutado) || 0
    const ratio = maxMonto > 0 ? value / maxMonto : 0
    const active = municipioSet.has(muniKey)
    const selected = selectedSet.has(muniKey)
    return {
      fillColor: selected ? '#3B82F6' : active ? scaleColor('#EA580C', 0.45 + ratio * 0.55) : '#E5E7EB',
      fillOpacity: selected ? 0.85 : active ? 0.9 : 0.25,
      color: selected ? '#1D4ED8' : active ? '#9A3412' : '#94A3B8',
      weight: selected ? 2.5 : active ? 1 : 0.5,
      opacity: 0.9,
      className: active ? 'cursor-pointer' : undefined,
    }
  }

  const onEachFeature = (feature, layer) => {
    const props = feature?.properties || {}
    const muniKey = normalizeMunicipio(props.municipio)
    if (!municipioSet.has(muniKey)) return
    const stat = municipioStats.get(muniKey)
    layer.bindTooltip(
      [
        `<strong>${props.municipio}</strong>`,
        `${props.departamento || '—'}`,
        `Monto ejecutado: ${formatMoney(stat?.monto_total_ejecutado || 0)}`,
        `Proyectos: ${formatNumber(stat?.total_proyectos || 0)}`,
      ].join('<br/>'),
      { sticky: true, direction: 'auto', opacity: 0.97 }
    )
    layer.on({
      mouseover: () => layer.setStyle({ weight: 2.5, color: '#1E3A5F', opacity: 1 }),
      mouseout: () => {
        const isSel = selectedSet.has(muniKey)
        const v = Number(municipioStats.get(muniKey)?.monto_total_ejecutado) || 0
        const r = maxMonto > 0 ? v / maxMonto : 0
        layer.setStyle({
          fillColor: isSel ? '#3B82F6' : scaleColor('#EA580C', 0.45 + r * 0.55),
          fillOpacity: isSel ? 0.85 : 0.9,
          color: isSel ? '#1D4ED8' : '#9A3412',
          weight: isSel ? 2.5 : 1,
          opacity: 0.9,
        })
      },
      click: () => {
        onToggleMunicipio?.(props.municipio)
        if (mapRef.current) {
          const bounds = layer.getBounds()
          const nextZoom = Math.min(mapRef.current.getZoom() + 1, mapRef.current.getMaxZoom())
          mapRef.current.flyToBounds(bounds, { padding: [30, 30], maxZoom: nextZoom, duration: 0.4 })
        }
      },
    })
  }

  const rowsCentral = detail?.series_anual_total || []
  const municipiosOrdenados = mapRows
  const rightCharts = (selectedMunicipios || [])
    .map((name) => {
      const key = normalizeMunicipio(name)
      const stat = municipioStats.get(key)
      return {
        municipio: name,
        stat,
        rows: byMunicipioYear.get(key) || [],
        snips: detail?.snips_por_municipio?.[name] || [],
      }
    })
    .filter((x) => x.rows.length > 0 || x.snips.length > 0)

  const subtitle = [
    `${formatNumber(summary.total_municipios ?? proveedor?.num_municipios ?? 0)} municipios`,
    `${formatNumber(summary.total_proyectos ?? proveedor?.num_proyectos ?? 0)} proyectos`,
    formatMoney(summary.monto_total_ejecutado ?? proveedor?.monto_ejecutado ?? 0),
  ].join(' · ')

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-d-card shadow-2xl border border-line dark:border-d-line w-screen h-screen flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line dark:border-d-line shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-800 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
              {proveedor?.proveedor || summary.proveedor}
            </h2>
            <p className="text-xs text-ink-500 dark:text-d-muted mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-lg hover:bg-canvas dark:hover:bg-d-canvas text-ink-400 hover:text-ink-700 dark:text-d-muted dark:hover:text-d-text transition-colors"
          >
            <X size={16} />
          </button>
        </header>
        <div className="overflow-hidden flex-1">
          {loading ? (
            <div className="h-full p-6">
              <LoadingSpinner label="Cargando detalle del proveedor…" />
            </div>
          ) : error ? (
            <div className="h-full p-6 flex items-center justify-center">
              <div className="space-y-3">
                <EmptyState icon={AlertTriangle} title="No se pudo cargar el detalle" message={error} />
                <div className="text-center">
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex px-3 py-1.5 rounded-md text-xs font-medium bg-accent hover:bg-accent-hover text-white"
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full grid grid-cols-1 xl:grid-cols-12 gap-3 p-3">
              <section className="xl:col-span-4 rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card p-2 flex flex-col min-h-0">
                <div className="px-1 pb-2 text-xs text-ink-500 dark:text-d-muted">Mapa de municipios con proyectos</div>
                <div className="flex-1 min-h-0 rounded-md border border-line dark:border-d-line overflow-hidden">
                  {geoJson && mapBounds ? (
                    <MapContainer
                      bounds={activeBounds || mapBounds}
                      boundsOptions={{ padding: [24, 24] }}
                      maxBounds={mapBounds.pad(0.2)}
                      maxBoundsViscosity={1}
                      scrollWheelZoom={false}
                      zoomControl
                      attributionControl={false}
                      style={{ width: '100%', height: '100%' }}
                      className="bg-slate-100 dark:bg-slate-900"
                      whenReady={(evt) => {
                        mapRef.current = evt.target
                        setTimeout(() => {
                          evt.target.invalidateSize()
                          evt.target.fitBounds(activeBounds || mapBounds, { padding: [24, 24] })
                        }, 0)
                      }}
                    >
                      <GeoJSON
                        key={`prov-${proveedor?.proveedor}-${municipioSet.size}-${selectedMunicipios?.length || 0}`}
                        data={geoJson}
                        style={styleFeature}
                        onEachFeature={onEachFeature}
                      />
                    </MapContainer>
                  ) : (
                    <EmptyState title="Mapa no disponible" message="No se pudo cargar la geometría." />
                  )}
                </div>
                <div className="pt-2 text-[11px] text-ink-500 dark:text-d-muted">
                  Click en municipio para agregar/quitar su gráfica comparativa (máx. {maxMunicipios}).
                </div>
              </section>

              <section className="xl:col-span-4 rounded-lg border border-line dark:border-d-line bg-canvas/40 dark:bg-d-canvas/30 p-2 flex flex-col gap-2 min-h-0 overflow-hidden">
                <YearlyMontoBars
                  rows={rowsCentral}
                  title="Total por año (proveedor)"
                  subtitle="Eje X: año · Eje Y: monto ejecutado"
                  height={260}
                />
                <div className="rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card flex-1 min-h-0 overflow-hidden">
                  <div className="px-3 py-2 border-b border-line dark:border-d-line text-xs font-semibold uppercase tracking-wide text-ink-600 dark:text-d-muted">
                    Municipios (ordenados por monto)
                  </div>
                  <div className="overflow-y-auto h-full">
                    {municipiosOrdenados.map((m) => {
                      const active = selectedSet.has(normalizeMunicipio(m.municipio))
                      const muniYears = byMunicipioYear.get(normalizeMunicipio(m.municipio)) || []
                      const yearRange =
                        muniYears.length === 0
                          ? null
                          : muniYears.length === 1
                          ? `${muniYears[0].ejercicio}`
                          : `${muniYears[0].ejercicio}–${muniYears[muniYears.length - 1].ejercicio}`
                      return (
                        <button
                          key={`mun-list-${m.municipio}`}
                          type="button"
                          onClick={() => onToggleMunicipio?.(m.municipio)}
                          className={`w-full text-left px-3 py-2 border-b border-line/50 dark:border-d-line/60 hover:bg-canvas dark:hover:bg-d-canvas transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-ink-800 dark:text-d-text truncate">{m.municipio}</span>
                            <span className="text-xs num text-ink-600 dark:text-d-muted">{formatNumber(m.total_proyectos)} proj.</span>
                          </div>
                          <div className="text-xs text-ink-500 dark:text-d-muted mt-0.5">
                            {m.departamento || '—'} · {formatMoney(m.monto_total_ejecutado)}
                            {yearRange ? <span className="ml-1 text-ink-400 dark:text-d-muted">· {yearRange}</span> : null}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </section>

              <section className="xl:col-span-4 rounded-lg border border-line dark:border-d-line bg-canvas/40 dark:bg-d-canvas/30 p-2 flex flex-col min-h-0 overflow-hidden">
                <div className="px-1 pb-2 text-xs text-ink-500 dark:text-d-muted">
                  Comparativo por municipio (hasta {maxMunicipios})
                </div>
                {localMessage ? (
                  <div className="mx-1 mb-2 rounded-md border border-amber-300/70 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-2 py-1 text-xs">
                    {localMessage}
                  </div>
                ) : null}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                  {rightCharts.map((entry) => (
                    <div key={`chart-wrap-${entry.municipio}`} className="space-y-1">
                      {entry.rows.length > 0 ? (
                        <YearlyMontoBars
                          rows={entry.rows}
                          title={entry.municipio}
                          subtitle={`${formatNumber(entry.stat?.total_proyectos || 0)} proyectos · ${formatMoney(entry.stat?.monto_total_ejecutado || 0)}`}
                          totalMonto={Number(entry.stat?.monto_total_ejecutado) || 0}
                          totalProyectos={Number(entry.stat?.total_proyectos) || 0}
                          height={190}
                        />
                      ) : (
                        <div className="rounded-lg border border-line dark:border-d-line bg-white dark:bg-d-card p-3">
                          <div className="text-sm font-semibold text-ink-800 dark:text-d-text">{entry.municipio}</div>
                          <div className="text-xs text-ink-500 dark:text-d-muted mt-0.5">
                            {formatNumber(entry.stat?.total_proyectos || 0)} proyectos · {formatMoney(entry.stat?.monto_total_ejecutado || 0)}
                          </div>
                          <div className="mt-2 text-xs text-ink-400 dark:text-d-muted italic">Sin series anuales registradas.</div>
                        </div>
                      )}
                      {entry.snips.length > 0 && (
                        <div className="rounded-lg border border-line/70 dark:border-d-line/70 bg-white dark:bg-d-card overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleSnipsOpen(entry.municipio)}
                            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-ink-600 dark:text-d-muted hover:bg-canvas dark:hover:bg-d-canvas transition-colors"
                          >
                            <span>Ver proyectos ({entry.snips.length})</span>
                            <ChevronDown
                              size={12}
                              className={`transition-transform ${snipsOpen.has(entry.municipio) ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {snipsOpen.has(entry.municipio) && (
                            <div className="divide-y divide-line/50 dark:divide-d-line/50 border-t border-line dark:border-d-line">
                              {entry.snips.map((s, i) => (
                                <div key={s.snip ?? i} className="px-3 py-2 text-xs">
                                  <div className="flex items-center gap-1.5">
                                    {s.link ? (
                                      <ExternalLink href={s.link} className="font-medium text-ink-700 dark:text-d-text">
                                        SNIP {s.snip ?? '—'}
                                      </ExternalLink>
                                    ) : (
                                      <span className="font-medium text-ink-700 dark:text-d-text">SNIP {s.snip ?? '—'}</span>
                                    )}
                                  </div>
                                  {s.proyecto ? (
                                    <div className="text-ink-500 dark:text-d-muted mt-0.5 line-clamp-2">{s.proyecto}</div>
                                  ) : null}
                                  <div className="text-ink-400 dark:text-d-muted mt-0.5 flex gap-2 flex-wrap">
                                    {s.ejercicio != null ? <span>{s.ejercicio}</span> : null}
                                    <span>{formatMoney(s.monto_ejecutado)}</span>
                                    {s.etapa_actual ? <span className="truncate">{s.etapa_actual}</span> : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {rightCharts.length === 0 ? (
                    <EmptyState
                      title="Sin municipios seleccionados"
                      message="Selecciona municipios en el mapa o en la lista central para ver sus gráficas."
                    />
                  ) : null}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TabMunicipiosProveedores({ filters }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [activeInsight, setActiveInsight] = useState(null)
  const [selectedProveedor, setSelectedProveedor] = useState(null)
  const [provDetail, setProvDetail] = useState(null)
  const [provDetailLoading, setProvDetailLoading] = useState(false)
  const [provDetailError, setProvDetailError] = useState(null)
  const [selectedMunicipiosProv, setSelectedMunicipiosProv] = useState([])
  const [selectionMessage, setSelectionMessage] = useState(null)
  const MAX_MUNI_COMPARE = 3

  useEffect(() => {
    if (!selectionMessage) return
    const t = setTimeout(() => setSelectionMessage(null), 2000)
    return () => clearTimeout(t)
  }, [selectionMessage])

  // GeoJSON for provider mini-map
  const [geoJson, setGeoJson] = useState(null)
  useEffect(() => {
    fetch('/gua.json')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setGeoJson)
      .catch(() => {})
  }, [])

  // Detail state
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setDetail(null)
    setSelected(null)
    setSelectedProveedor(null)
    setProvDetail(null)
    setProvDetailError(null)
    setSelectedMunicipiosProv([])
    getMunicipiosProveedores(filters)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err?.message || 'Error al cargar datos'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filters])

  const loadDetail = useCallback(
    async (muni) => {
      if (!muni) return
      setDetailLoading(true)
      setDetailError(null)
      try {
        const d = await getMunicipioDetalle(muni, filters)
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

  const loadProveedorDetail = useCallback(
    async (provName) => {
      if (!provName) return
      setProvDetailLoading(true)
      setProvDetailError(null)
      try {
        const d = await getMunicipiosProveedorDetalle(provName, filters)
        setProvDetail(d)
        const defaults = (d?.top_municipios_default || []).slice(0, MAX_MUNI_COMPARE)
        setSelectedMunicipiosProv(defaults)
      } catch (err) {
        setProvDetailError(err?.response?.data?.detail || err?.message || 'Error al cargar detalle de proveedor')
        setProvDetail(null)
        setSelectedMunicipiosProv([])
      } finally {
        setProvDetailLoading(false)
      }
    },
    [filters]
  )

  const openProveedorModal = useCallback(
    (row) => {
      setSelectedProveedor(row)
      setProvDetail(null)
      setSelectionMessage(null)
      setSelectedMunicipiosProv([])
      loadProveedorDetail(row?.proveedor)
    },
    [loadProveedorDetail]
  )

  const toggleProveedorMunicipio = useCallback((municipio) => {
    if (!municipio) return
    setSelectedMunicipiosProv((prev) => {
      const exists = prev.some((m) => normalizeMunicipio(m) === normalizeMunicipio(municipio))
      if (exists) {
        return prev.filter((m) => normalizeMunicipio(m) !== normalizeMunicipio(municipio))
      }
      if (prev.length >= MAX_MUNI_COMPARE) {
        setSelectionMessage(`Solo puedes comparar hasta ${MAX_MUNI_COMPARE} municipios.`)
        return prev
      }
      return [...prev, municipio]
    })
  }, [])

  if (loading) return <LoadingSpinner label="Cargando análisis…" />
  if (error)
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No se pudo cargar la información"
        message={error}
      />
    )
  if (!data) return null

  const insights = data.insights || {}
  const items = [
    insights.top_conc && {
      label: 'Mayor concentración con un proveedor',
      value: (
        <>
          <strong>{insights.top_conc.municipio}</strong> — {formatPercent(insights.top_conc.share)} del monto adjudicado en un solo proveedor.
        </>
      ),
      explanation:
        'Una concentración tan alta del gasto en un solo proveedor elimina la competencia real. En licitaciones transparentes, ningún proveedor debería dominar más del 30–40 % del gasto total de un municipio. Una concentración superior puede indicar acuerdo previo, especificaciones técnicas dirigidas o favoritismo.',
    },
    {
      label: 'Municipios con un único proveedor',
      value: (
        <>
          <strong className="num">{formatNumber(insights.count_unique_supplier)}</strong> municipios con &gt; 2 proyectos canalizan toda su contratación a un mismo proveedor.
        </>
      ),
      explanation:
        'Cuando todos los contratos de un municipio van al mismo proveedor —sin importar el tipo de obra— es señal de que el proceso de selección no es competitivo. La diversificación de proveedores es un indicador básico de salud en la contratación pública.',
    },
    insights.top_monto && {
      label: 'Municipio con mayor monto en un solo proveedor',
      value: (
        <>
          <strong>{insights.top_monto.municipio}</strong> — {formatMoney(insights.top_monto.monto_total)} ejecutados.
        </>
      ),
      explanation:
        'Un monto elevado concentrado en una sola empresa amplifica el riesgo financiero y de corrupción. Si el proveedor no cumple con la entrega, el municipio pierde una suma mayor sin opciones inmediatas de recuperación ni de recurso contractual efectivo.',
    },
    insights.worst_ratio && {
      label: 'Peor ratio de meta ejecutada',
      value: (
        <>
          <strong>{insights.worst_ratio.municipio}</strong> con {formatPercent(insights.worst_ratio.ratio)} de cumplimiento promedio.
        </>
      ),
      explanation:
        'Un municipio con bajo cumplimiento de metas físicas promedio puede estar reportando gastos superiores a la obra realmente ejecutada. Cada quetzal gastado que no se refleja en obra construida representa un perjuicio directo al Estado y a los ciudadanos del municipio.',
    },
    insights.top_sospechoso && {
      label: 'Mayor proporción de proyectos sospechosos',
      value: (
        <>
          <strong>{insights.top_sospechoso.municipio}</strong> — {formatPercent(insights.top_sospechoso.ratio)} de sus proyectos están marcados como sospechosos.
        </>
      ),
      explanation:
        'Un municipio con alta proporción de proyectos sospechosos puede indicar un patrón sistemático de irregularidades, no casos aislados. Cuando la concentración de alertas se repite en el mismo lugar y periodo, la investigación debe ser prioritaria.',
    },
  ].filter(Boolean)

  const columns = [
    { key: 'municipio', header: 'Municipio' },
    { key: 'departamento', header: 'Departamento' },
    {
      key: 'proveedor_principal',
      header: 'Proveedor principal',
      render: (r) =>
        r.proveedor_link ? (
          <ExternalLink href={r.proveedor_link}>{r.proveedor_principal || nameFromLink(r.proveedor_link)}</ExternalLink>
        ) : (
          r.proveedor_principal || '—'
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
      key: 'promedio_monto_ejecutado',
      header: 'Promedio',
      align: 'right',
      render: (r) => formatMoney(r.promedio_monto_ejecutado),
    },
    {
      key: 'promedio_ratio_meta_ejecutada',
      header: 'Ratio meta %',
      align: 'right',
      render: (r) => formatPercent(r.promedio_ratio_meta_ejecutada),
    },
  ]
  const providerColumns = [
    { key: 'rank', header: '#', align: 'right' },
    { key: 'proveedor', header: 'Proveedor' },
    {
      key: 'num_municipios',
      header: 'Municipios',
      align: 'right',
      render: (r) => (
        <span className="font-semibold text-orange-700 dark:text-orange-400 num">
          {formatNumber(r.num_municipios)}
        </span>
      ),
    },
    {
      key: 'num_proyectos',
      header: 'Proyectos',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openProveedorModal(r)
          }}
          className="font-semibold num text-accent hover:underline"
          title="Abrir análisis completo del proveedor"
        >
          {formatNumber(r.num_proyectos)}
        </button>
      ),
    },
    { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
  ]

  return (
    <div className="space-y-6">
      <InsightCard
        title="Hallazgos · Municipios y proveedores"
        subtitle="Concentración de contratos y desempeño en cumplimiento de metas. Haz clic en cada hallazgo para ver el análisis."
        tooltip="Resumen automático de patrones detectados en los datos filtrados."
        items={items}
        onItemClick={setActiveInsight}
      />

      <SectionCard
        title="Top 50 proveedores por presencia municipal"
        subtitle="Proveedores con proyectos en mayor número de municipios distintos · Haz clic para ver su mapa"
      >
        {(data.top_proveedores || []).length === 0 ? (
          <EmptyState title="Sin datos" message="No hay proveedores para los filtros seleccionados." />
        ) : (
          <DataTable
            columns={providerColumns}
            data={(data.top_proveedores || []).map((r, i) => ({ ...r, rank: i + 1 }))}
            defaultSort={{ key: 'num_municipios', direction: 'desc' }}
            searchPlaceholder="Buscar proveedor…"
            pageSize={15}
            onRowClick={openProveedorModal}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Municipios con un único proveedor"
        subtitle="Municipalidades cuyos proyectos (más de 2) se concentraron en un solo proveedor."
        tooltip="Listado de municipios con alta concentración de contratos en un solo proveedor."
      >
        {data.table?.length ? (
          <DataTable
            columns={columns}
            data={data.table}
            defaultSort={{ key: 'monto_total_ejecutado', direction: 'desc' }}
            searchPlaceholder="Buscar municipio, proveedor…"
          />
        ) : (
          <EmptyState title="Sin hallazgos" message="No hay municipios con un único proveedor en la selección actual." />
        )}
      </SectionCard>

      <SectionCard
        title="Buscar municipio"
        subtitle="Selecciona un municipio para ver el detalle de sus proyectos, alertas y métricas."
        tooltip="Análisis profundo de un municipio específico."
      >
        <div className="max-w-md mb-5">
          <SearchableSelect
            label="Municipio"
            placeholder="Buscar y seleccionar municipio…"
            options={data.municipios_list || []}
            value={selected}
            onChange={setSelected}
          />
        </div>

        {!selected ? (
          <EmptyState
            icon={Building2}
            title="Selecciona un municipio"
            message="Elige un municipio para visualizar los KPIs y proyectos asociados."
          />
        ) : detailLoading ? (
          <LoadingSpinner label="Cargando detalle…" />
        ) : detailError ? (
          <EmptyState icon={AlertTriangle} title="No se encontraron datos" message={detailError} />
        ) : detail ? (
          <MunicipioDetalle detail={detail} />
        ) : null}
      </SectionCard>

      {activeInsight && (
        <InsightDetailModal item={activeInsight} onClose={() => setActiveInsight(null)} />
      )}

      {selectedProveedor && (
        <ProveedorModal
          proveedor={selectedProveedor}
          geoJson={geoJson}
          detail={provDetail}
          loading={provDetailLoading}
          error={provDetailError}
          selectedMunicipios={selectedMunicipiosProv}
          maxMunicipios={MAX_MUNI_COMPARE}
          onToggleMunicipio={toggleProveedorMunicipio}
          onRetry={() => loadProveedorDetail(selectedProveedor?.proveedor)}
          selectionMessage={selectionMessage}
          onClose={() => {
            setSelectedProveedor(null)
            setProvDetail(null)
            setProvDetailError(null)
            setSelectedMunicipiosProv([])
            setSelectionMessage(null)
          }}
        />
      )}
    </div>
  )
}

function MunicipioDetalle({ detail }) {
  const k = detail.kpis || {}
  const cols = [
    { key: 'snip', header: 'SNIP' },
    { key: 'proyecto', header: 'Proyecto' },
    { key: 'proveedor', header: 'Proveedor' },
    { key: 'alcalde_ganador', header: 'Alcalde' },
    { key: 'monto_adjudicado', header: 'Adjudicado', align: 'right', render: (r) => formatMoney(r.monto_adjudicado) },
    { key: 'monto_ejecutado', header: 'Ejecutado', align: 'right', render: (r) => formatMoney(r.monto_ejecutado) },
    {
      key: 'brecha_adjudicado_ejecutado',
      header: 'Brecha',
      align: 'right',
      render: (r) => formatMoney(r.brecha_adjudicado_ejecutado),
    },
    { key: 'meta_ejecutada', header: 'Meta ej.', align: 'right', render: (r) => formatNumber(r.meta_ejecutada, 2) },
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
        <KpiCard label="Proveedores" value={formatNumber(k.total_proveedores)} icon={Building2} description="Únicos en el municipio." />
        <KpiCard label="Proyectos" value={formatNumber(k.total_proyectos)} icon={ListChecks} description="Total de proyectos." />
        <KpiCard
          label="Monto ejecutado"
          value={formatMoney(k.monto_total_ejecutado, { compact: true })}
          accent="accent"
          icon={Wallet}
          description="Suma del gasto efectivo."
        />
        <KpiCard
          label="Ratio meta"
          value={formatPercent(k.ratio_promedio)}
          icon={Target}
          accent="success"
          description="Cumplimiento promedio de la meta."
        />
        <KpiCard
          label="% Sospechosos"
          value={formatPercent(k.pct_sospechosos)}
          icon={AlertTriangle}
          accent="danger"
          description="Proyectos marcados como sospechosos."
        />
        <KpiCard
          label="% Sin meta con gasto"
          value={formatPercent(k.pct_sin_meta_ejecutada)}
          icon={TrendingDown}
          accent="warn"
          description="Proyectos con gasto pero sin meta."
        />
        <KpiCard
          label="Sobreejecución"
          value={formatNumber(k.proyectos_sobreejecucion)}
          icon={TrendingUp}
          accent="warn"
          description="Proyectos con gasto > meta."
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
        searchPlaceholder="Buscar SNIP, proyecto, proveedor…"
      />
    </div>
  )
}
